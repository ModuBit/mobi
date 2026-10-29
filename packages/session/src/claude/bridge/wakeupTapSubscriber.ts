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

// wakeup 订阅者（bridge 通道第二个消费者，wakeup-source spec mods 路线）：
// 收到 prompt 信号（mods 事件层无 wakeupSource——session.append 是落盘序列化前的
// 输入，形状 {message,door,origin,uuid}，唤醒行事件与人工 prompt 元数据完全同形，
// 故生产端只能宽触发）→ 尾部窗口扫读落盘行 → 按 row 匹配器权威判定（行顶层
// wakeupSource，人工 prompt 行无该字段天然排除）→ 解析枚举值交给回调
// （票 01 上报链路：runtimeState.lastWakeup + session event 落库）。
// 与 goal 订阅者的关键差异：**不透传原始行**——SDK 流本就不透传唤醒注入的 user
// 消息，消息流不该凭空多 user 行；唤醒只作为事实（divider 系统行）呈现。
// 认行规则来自 shared 契约单源（与 mod 生产端 config.mjs 等值，cli 测试锁定）。
// 回读竞态退避 / 补偿扫描 / uuid 去重与 goalTapSubscriber 同型（信号在落盘前触发）。

import {
    TRANSCRIPT_TAP_GOAL_ENVELOPE_TYPE,
    TRANSCRIPT_TAP_SESSION_APPEND_RULES,
    TRANSCRIPT_TAP_WAKEUP_ENVELOPE_TYPE,
    WakeupSourceSchema,
    matchesTranscriptTapRule,
    transcriptTapRowMatcher,
    type TranscriptTapMatcher,
    type WakeupSource,
} from '@mobi/shared';
import { logger } from '@mobi/node-core/logger';
import type { BridgeListener } from './bridgeListener';
import { BoundedUuidSet } from './boundedUuidSet';
import { scanTailLines } from './tailReader';

export interface WakeupTapSubscriberOptions {
    /** 当前会话 transcript 路径解析（sessionId 未就绪返回 null，信号丢弃并 warn） */
    resolveTranscriptPath: () => string | null;
    /** 解析出的唤醒来源出口（调用方接票 01 上报链路） */
    onWakeup: (source: WakeupSource) => void;
}

/**
 * 落盘竞态退避（session.append 在落盘**前**触发，读不到目标行属正常）。
 * 窗口耗尽仍找不到 → 放弃 + warn（带 uuid），不扩散重试。
 */
const RETRY_DELAYS_MS = [100, 150, 200];

/** 补偿扫描延迟（信号防抖窗口）：mod 出口 fire-and-forget 在行洪峰下可能丢个别信号，
 * 信号过后延迟扫一次尾窗（seenUuids 去重幂等）把晚落盘/丢信号的唤醒行补出来。 */
const COMPENSATE_DELAY_MS = 1500;

/** 补偿扫描信号 uuid 前缀（无对应 transcript 行，仅作「扫一遍尾窗」的触发器） */
const COMPENSATE_UUID_PREFIX = 'compensate-';

/** 去重集合容量上限（唤醒行低频，防 rewind/compact 重写极端场景无界增长） */
const MAX_SEEN_UUIDS = 500;

/** 唤醒订阅者认的规则（shared 单源中本信封的子集）——hitTest 与解析共用 */
const WAKEUP_RULES = TRANSCRIPT_TAP_SESSION_APPEND_RULES.filter(
    (rule) => (rule.envelope ?? TRANSCRIPT_TAP_GOAL_ENVELOPE_TYPE) === TRANSCRIPT_TAP_WAKEUP_ENVELOPE_TYPE,
);

/** 廉价子串门卫（parse 前预筛）：行匹配器的判定字段名直接出现在行文本里 */
function mayMatchAnyRule(line: string): boolean {
    return WAKEUP_RULES.some((rule) => {
        const matcher: TranscriptTapMatcher = transcriptTapRowMatcher(rule);
        return (matcher.name !== undefined && line.includes(matcher.name)) || (matcher.field !== undefined && line.includes(matcher.field));
    });
}

/**
 * 注册订阅者，返回停用函数（会话清理时调用：停收新信号 + 清补偿定时器，
 * 否则闭包持有 opts/seenUuids 多驻留一个防抖周期）。
 */
export function registerWakeupTapSubscriber(bridge: BridgeListener, opts: WakeupTapSubscriberOptions): () => void {
    const seenUuids = new BoundedUuidSet(MAX_SEEN_UUIDS);
    let compensateTimer: ReturnType<typeof setTimeout> | null = null;
    // 信号串行化：重扫共享 seenUuids 与文件窗口，并发穿插会让「目标行已消费」判定失真
    let queue: Promise<void> = Promise.resolve();
    let stopped = false;

    bridge.subscribe(TRANSCRIPT_TAP_WAKEUP_ENVELOPE_TYPE, (payload) => {
        if (stopped) return;
        const signal = payload as { uuid?: string };
        if (!signal?.uuid) {
            logger.debug('[BRIDGE_WAKEUP] signal without uuid, ignored');
            return;
        }
        queue = queue.then(() => (stopped ? undefined : handleSignal(signal.uuid!, opts, seenUuids))).catch(() => {});
        // 信号后置补偿：同一波信号只排一次（防抖），扫到未见唤醒行即消费
        if (compensateTimer) clearTimeout(compensateTimer);
        compensateTimer = setTimeout(() => {
            compensateTimer = null;
            if (stopped) return;
            queue = queue
                .then(() => (stopped ? undefined : handleSignal(`${COMPENSATE_UUID_PREFIX}${Date.now()}`, opts, seenUuids, true)))
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
    opts: WakeupTapSubscriberOptions,
    seenUuids: BoundedUuidSet,
    quiet = false,
): Promise<void> {
    const filePath = opts.resolveTranscriptPath();
    if (!filePath) {
        if (!quiet) logger.warn(`[BRIDGE_WAKEUP] transcript path unavailable, dropping signal uuid=${signalUuid}`);
        return;
    }

    const isCompensate = signalUuid.startsWith(COMPENSATE_UUID_PREFIX);
    for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt += 1) {
        if (attempt > 0) {
            await new Promise((resolve) => setTimeout(resolve, RETRY_DELAYS_MS[attempt - 1]));
        }
        let scan;
        try {
            scan = await scanTailLines(filePath, { hitTest: mayMatchAnyRule });
        } catch (e) {
            logger.warn(`[BRIDGE_WAKEUP] tail scan failed, giving up: uuid=${signalUuid} file=${filePath}`, e);
            return;
        }
        const consumed = consumeWakeupLines(scan.lines, opts, seenUuids);
        // 终止判定：补偿信号扫不到新行即稳态；唤醒行信号以「目标行已消费」为准——
        // 信号 uuid 即落盘行 uuid（mods 契约，CC 2.1.312 实测）。人工 prompt 的信号
        // 目标行永远不会进 seenUuids（无 wakeupSource，不消费），窗口耗尽属**常态**：
        // 静默收场（debug 记录即可），不 warn。
        if (isCompensate ? consumed === 0 : seenUuids.has(signalUuid)) {
            return;
        }
    }

    // 窗口耗尽：人工 prompt 信号为主（扫不到唤醒行是预期稳态），debug 记录供对账。
    // 真唤醒行的兜底在信号后置补偿扫描（1.5s 后再扫一遍尾窗）。
    logger.debug(`[BRIDGE_WAKEUP] no wakeup row consumed within tail window: uuid=${signalUuid} file=${filePath}`);
}

/**
 * 解析窗口行并消费 wakeupSource，返回消费条数。
 * 枚举外的取值（CC 未来扩展）safeParse 失败静默跳过——daemon 不认识的不报。
 */
function consumeWakeupLines(lines: string[], opts: WakeupTapSubscriberOptions, seenUuids: BoundedUuidSet): number {
    let consumed = 0;
    for (const line of lines) {
        if (!mayMatchAnyRule(line)) continue; // 廉价门卫：非候选行免 parse
        let parsed: unknown;
        try {
            parsed = JSON.parse(line);
        } catch {
            continue; // 非 JSON 行（半行兜底已由读取器丢弃，此处理论不可达）
        }
        const row = parsed as Record<string, unknown>;
        const isWakeupRow = WAKEUP_RULES.some((rule) => matchesTranscriptTapRule(row, transcriptTapRowMatcher(rule)));
        if (!isWakeupRow) continue;
        const uuid = typeof row.uuid === 'string' ? row.uuid : undefined;
        if (uuid === undefined || seenUuids.has(uuid)) continue;
        const source = WakeupSourceSchema.safeParse(row.wakeupSource);
        if (!source.success) continue;
        seenUuids.add(uuid);
        opts.onWakeup(source.data);
        consumed += 1;
    }
    return consumed;
}
