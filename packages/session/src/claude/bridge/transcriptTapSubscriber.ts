/*
 * Copyright Maner·Fan
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     https://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

// transcript tap 订阅者通用机制（goal / wakeup 共用，新信封配置即接入）：
// mods 信号 → 尾部窗口扫读落盘行 → 规则匹配 → uuid 去重 → 行处理回调。
// 机制单点收口：落盘竞态退避 / 补偿扫描（波级防抖，兜底 mod 出口 fire-and-forget
// 丢信号）/ 信号串行化 / 停用清理——goal 与 wakeup 曾各自手抄一份 ~100 行同构骨架，
// 机制修重必须双处同步（goal 行漏透传 = 吊顶永挂，wakeup 判据漂移 = 行丢失/重复）。
// 终止判据利用「事件 uuid == 落盘行 uuid」契约（CC 实测）：**目标行出现在窗口即终止**，
// 无论该行是否被消费——人工 prompt 行对 wakeup 订阅者是「已落盘且非唤醒」的终态，
// 不必跑满重试窗口（door:'prompt' 宽触发下人工信号是最高频信号，每次省 3 次重试）。
// hitTest = 规则字段名 + 信号 uuid：前者认候选行，后者保证目标行所在块命中
// （否则无唤醒历史的会话每次扫满 256KB 扩窗上限）。

import {
    TRANSCRIPT_TAP_SESSION_APPEND_RULES,
    matchesTranscriptTapRule,
    transcriptTapRowMatcher,
    transcriptTapRulesForEnvelope,
    type TranscriptTapMatcher,
    type TranscriptTapSessionAppendRule,
} from '@mobi/shared'
import { logger } from '@mobi/node-core/logger'
import type { BridgeListener } from './bridgeListener'
import { BoundedUuidSet } from './boundedUuidSet'
import { scanTailLines } from './tailReader'

/**
 * 落盘竞态退避（session.append 在落盘**前**触发，读不到目标行属正常）。
 * 窗口耗尽仍找不到目标行 → onMissed 收场，不扩散重试。
 */
const RETRY_DELAYS_MS = [100, 150, 200]

/** 补偿扫描延迟（信号防抖窗口）：mod 出口 fire-and-forget 在行洪峰下可能丢个别信号，
 * 信号过后延迟扫一次尾窗（seenUuids 去重幂等）把晚落盘/丢信号的行补出来。
 * **波级兜底**：无论单信号是否提前终止都排（防抖），丢失信号的行靠下一波的补偿扫出。 */
const COMPENSATE_DELAY_MS = 1500

/** 补偿扫描信号 uuid 前缀（无对应 transcript 行，仅作「扫一遍尾窗」的触发器） */
const COMPENSATE_UUID_PREFIX = 'compensate-'

export interface TranscriptTapSubscriberConfig {
    /** 本订阅者认的 bridge 信封 type（规则子集按它筛，shared 单源） */
    envelope: string
    /** 日志 tag（如 BRIDGE_GOAL / BRIDGE_WAKEUP） */
    tag: string
    /** 去重集合容量上限（防 rewind/compact 重写极端场景无界增长） */
    maxSeenUuids: number
    /** 当前会话 transcript 路径解析（sessionId 未就绪返回 null，信号丢弃并 warn） */
    resolveTranscriptPath: () => string | null
    /** 规则命中且未见的行：处理内容；返回 true = 已消费（信号终止判定计入）。
     * 返回 false = 放弃该行（如枚举外取值），不进去重集合（行不变可重入）。 */
    handleRow: (row: Record<string, unknown>, uuid: string) => boolean
    /** 真实信号重试窗口耗尽仍未见目标行（落盘慢/信号目标丢失）：goal=warn 供对账，
     * wakeup=debug（人工信号高频、多数为低价值场景）——档位由调用方定 */
    onMissed: (signalUuid: string, filePath: string) => void
}

/**
 * 注册订阅者，返回停用函数（会话清理时调用：停收新信号 + 清补偿定时器，
 * 否则闭包持有 config/seenUuids 多驻留一个防抖周期）。
 */
export function registerTranscriptTapSubscriber(bridge: BridgeListener, config: TranscriptTapSubscriberConfig): () => void {
    const rules = transcriptTapRulesForEnvelope(TRANSCRIPT_TAP_SESSION_APPEND_RULES, config.envelope);
    const seenUuids = new BoundedUuidSet(config.maxSeenUuids);
    let compensateTimer: ReturnType<typeof setTimeout> | null = null;
    // 信号串行化：重扫共享 seenUuids 与文件窗口，并发穿插会让「目标行已落盘」判定失真
    let queue: Promise<void> = Promise.resolve();
    let stopped = false;

    /** 廉价子串门卫（parse 前预筛）：规则匹配器的字段名或目标 uuid 直接出现在行文本里 */
    const mayMatchLine = (line: string, signalUuid?: string): boolean =>
        rules.some((rule) => {
            const matcher: TranscriptTapMatcher = transcriptTapRowMatcher(rule);
            return (
                (matcher.name !== undefined && line.includes(matcher.name)) ||
                (matcher.field !== undefined && line.includes(matcher.field)) ||
                (signalUuid !== undefined && line.includes(signalUuid))
            );
        });

    bridge.subscribe(config.envelope, (payload) => {
        if (stopped) return;
        const signal = payload as { uuid?: string };
        if (!signal?.uuid) {
            logger.debug(`[${config.tag}] signal without uuid, ignored`);
            return;
        }
        queue = queue.then(() => (stopped ? undefined : handleSignal(signal.uuid!, config, rules, seenUuids, mayMatchLine))).catch(() => {});
        // 信号后置补偿：同一波信号只排一次（防抖），扫到未见行即处理
        if (compensateTimer) clearTimeout(compensateTimer);
        compensateTimer = setTimeout(() => {
            compensateTimer = null;
            if (stopped) return;
            queue = queue
                .then(() =>
                    (stopped ? undefined : handleSignal(`${COMPENSATE_UUID_PREFIX}${Date.now()}`, config, rules, seenUuids, mayMatchLine, true)),
                )
                .catch(() => {});
        }, COMPENSATE_DELAY_MS);
    });

    return () => {
        stopped = true;
        if (compensateTimer) {
            clearTimeout(compensateTimer);
            compensateTimer = null;
        }
    };
}

async function handleSignal(
    signalUuid: string,
    config: TranscriptTapSubscriberConfig,
    rules: readonly TranscriptTapSessionAppendRule[],
    seenUuids: BoundedUuidSet,
    mayMatchLine: (line: string, signalUuid?: string) => boolean,
    quiet = false,
): Promise<void> {
    const filePath = config.resolveTranscriptPath();
    if (!filePath) {
        if (!quiet) logger.warn(`[${config.tag}] transcript path unavailable, dropping signal uuid=${signalUuid}`);
        return;
    }

    const isCompensate = signalUuid.startsWith(COMPENSATE_UUID_PREFIX);
    for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt += 1) {
        if (attempt > 0) {
            await new Promise((resolve) => setTimeout(resolve, RETRY_DELAYS_MS[attempt - 1]));
        }
        let scan;
        try {
            scan = await scanTailLines(filePath, { hitTest: (line) => mayMatchLine(line, signalUuid) });
        } catch (e) {
            // 读取失败（权限/非常规文件等）：持久性错误，重试无意义，放弃并 warn
            logger.warn(`[${config.tag}] tail scan failed, giving up: uuid=${signalUuid} file=${filePath}`, e);
            return;
        }
        const { consumed, targetSeen } = consumeLines(scan.lines, signalUuid, rules, seenUuids, mayMatchLine, config);
        // 终止判定：补偿信号扫不到新行即稳态；真实信号以「目标行已在窗口」为准——
        // 事件 uuid == 落盘行 uuid（mods 契约），行已落盘即终态，消费与否不改判
        if (isCompensate ? consumed === 0 : targetSeen) {
            return;
        }
    }

    // 窗口耗尽仍未见目标行：档位化收场（goal warn 对账 / wakeup debug），不扩散重试
    config.onMissed(signalUuid, filePath);
}

/** 解析窗口行并交给行处理回调，返回 { 消费条数, 目标行是否已在窗口 } */
function consumeLines(
    lines: string[],
    signalUuid: string,
    rules: readonly TranscriptTapSessionAppendRule[],
    seenUuids: BoundedUuidSet,
    mayMatchLine: (line: string, signalUuid?: string) => boolean,
    config: TranscriptTapSubscriberConfig,
): { consumed: number; targetSeen: boolean } {
    let consumed = 0;
    let targetSeen = false;
    for (const line of lines) {
        if (!mayMatchLine(line, signalUuid)) continue; // 廉价门卫：非候选行免 parse
        let parsed: unknown;
        try {
            parsed = JSON.parse(line);
        } catch {
            continue; // 非 JSON 行（半行兜底已由读取器丢弃，此处理论不可达）
        }
        const row = parsed as Record<string, unknown>;
        if (row.uuid === signalUuid) targetSeen = true;
        const matched = rules.some((rule) => matchesTranscriptTapRule(row, transcriptTapRowMatcher(rule)));
        if (!matched) continue;
        const uuid = typeof row.uuid === 'string' ? row.uuid : undefined;
        if (uuid === undefined || seenUuids.has(uuid)) continue;
        if (config.handleRow(row, uuid)) {
            seenUuids.add(uuid);
            consumed += 1;
        }
    }
    return { consumed, targetSeen };
}
