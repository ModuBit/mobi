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

// goal 订阅者（bridge 通道第一个消费者，spec mods-goal-channel）：
// 收到 goal_status 信号 → 尾部窗口反向分块扫读出原始行 → 逐字节透传进与
// claude query 消息同一条管道。session 对 goal 零语义转换、不合成消息、
// 不报专用 RPC；uuid 只作去重（重扫/重写后重复出现的行由此兜住）。
// 认行规则来自 shared 契约单源（与 mod 生产端 config.mjs 等值，cli 测试锁定），
// 规则演进只改 shared——此处与生产端的字面量双写已收口。

import { TRANSCRIPT_TAP_SESSION_APPEND_RULES } from '@mobi/shared';
import { logger } from '@mobi/node-core/logger';
import type { BridgeListener } from './bridgeListener';
import { scanTailLines } from './tailReader';
import { RawJSONLinesSchema, type RawJSONLines } from '../types';

/** 信号载荷形状（mod 生产端约定：仅元数据，无内容） */
export interface SessionAppendSignal {
    door?: string;
    name?: string;
    uuid?: string;
}

export interface GoalTapSubscriberOptions {
    /** 当前会话 transcript 路径解析（sessionId 未就绪返回 null，信号丢弃并 warn） */
    resolveTranscriptPath: () => string | null;
    /** 原始行透传出口：与 claude query 消息同一落库广播路径 */
    sendMessage: (message: RawJSONLines) => void;
}

/**
 * 落盘竞态退避（session.append 在落盘**前**触发，读不到目标行属正常）。
 * 窗口耗尽仍找不到 → 放弃 + warn（带 uuid），不扩散重试。
 */
const RETRY_DELAYS_MS = [100, 150, 200];

/** 补偿扫描延迟（信号防抖窗口）：mod 出口 fire-and-forget 在行洪峰下可能丢个别
 * 信号（达成行丢失 = 吊顶永挂），且信号本身在落盘前触发——信号过后延迟扫一次
 * 尾窗（seenUuids 去重幂等），把晚落盘/丢信号的 goal 行补出来。 */
const COMPENSATE_DELAY_MS = 1500;

/** 补偿扫描信号 uuid 前缀（无对应 transcript 行，仅作「扫一遍尾窗」的触发器） */
const COMPENSATE_UUID_PREFIX = 'compensate-';

/** 去重集合容量上限（goal 行每 turn 一条，防 rewind/compact 重写极端场景无界增长） */
const MAX_SEEN_UUIDS = 2000;

/**
 * 注册订阅者，返回停用函数（会话清理时调用：停收新信号 + 清补偿定时器，
 * 否则闭包持有 opts/seenUuids 多驻留一个防抖周期，并对已关闭通道触发扫描/透传）。
 */
export function registerGoalTapSubscriber(bridge: BridgeListener, opts: GoalTapSubscriberOptions): () => void {
    const seenUuids = new Set<string>();
    let compensateTimer: ReturnType<typeof setTimeout> | null = null;
    // 信号串行化：重扫共享 seenUuids 与文件窗口，并发穿插会让「目标行已透传」判定失真
    let queue: Promise<void> = Promise.resolve();
    let stopped = false;

    bridge.subscribe('session.append', (payload) => {
        if (stopped) return;
        const signal = payload as SessionAppendSignal;
        if (!signal?.uuid) {
            logger.debug('[BRIDGE_GOAL] signal without uuid, ignored');
            return;
        }
        queue = queue.then(() => (stopped ? undefined : handleSignal(signal, opts, seenUuids))).catch(() => {});
        // 信号后置补偿：同一波信号只排一次（防抖），扫到未见 goal 行即透传
        if (compensateTimer) clearTimeout(compensateTimer);
        compensateTimer = setTimeout(() => {
            compensateTimer = null;
            if (stopped) return;
            queue = queue
                .then(() => (stopped ? undefined : handleSignal({ uuid: `${COMPENSATE_UUID_PREFIX}${Date.now()}` }, opts, seenUuids, true)))
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
    signal: SessionAppendSignal,
    opts: GoalTapSubscriberOptions,
    seenUuids: Set<string>,
    quiet = false,
): Promise<void> {
    const signalUuid = signal.uuid;
    if (!signalUuid) return; // 注册侧已过滤无 uuid 的信号，此处防御兜底
    const filePath = opts.resolveTranscriptPath();
    if (!filePath) {
        if (!quiet) logger.warn(`[BRIDGE_GOAL] transcript path unavailable, dropping signal uuid=${signalUuid}`);
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
            // 读取失败（权限/非常规文件等）：持久性错误，重试无意义，放弃并 warn
            logger.warn(`[BRIDGE_GOAL] tail scan failed, giving up: uuid=${signalUuid} file=${filePath}`, e);
            return;
        }
        const forwarded = forwardGoalLines(scan.lines, opts, seenUuids);
        // 终止判定：补偿信号扫不到新行即稳态；真实信号以「目标行已透传」为准——
        // 信号 uuid 即 transcript 行 uuid（mods 契约）。误透传别的未见行不算达成，
        // 否则落盘慢的目标行被跳过后只能靠补偿兜底，聊天流可能达成/进行中倒序
        if (isCompensate ? forwarded === 0 : seenUuids.has(signalUuid)) {
            return;
        }
    }

    // 窗口耗尽仍找不到：放弃并 warn（带 uuid 供与 transcript 行对账）。
    // 补偿扫描是尽力而为，找不到未见行属常态，静默
    if (!quiet) {
        logger.warn(`[BRIDGE_GOAL] goal_status line not found within tail window after retries, giving up: uuid=${signalUuid} file=${filePath}`);
    }
}

/** 廉价子串门卫（parse 前预筛）：hitTest 与透传循环共用的唯一实现（防两处判别式漂移） */
function mayMatchAnyRule(line: string): boolean {
    return TRANSCRIPT_TAP_SESSION_APPEND_RULES.some((rule) => rule.name === undefined || line.includes(rule.name));
}

/** attachment 行变体（uuid 必有，供匹配后收窄） */
type AttachmentRow = Extract<RawJSONLines, { type: 'attachment' }>;

/**
 * 行匹配（由 shared tap 契约单源推导）：door 与 transcript 行 type 同名
 * （票 06 实锤形状），attachment door 的类型名在 attachment.type。
 */
function matchesTapRules(row: RawJSONLines): row is AttachmentRow {
    return TRANSCRIPT_TAP_SESSION_APPEND_RULES.some((rule) => {
        if (rule.door !== undefined && row.type !== rule.door) return false;
        if (rule.name === undefined) return true;
        const payloadType = row.attachment ? (row.attachment as { type?: unknown }).type : undefined;
        return payloadType === rule.name;
    });
}

/**
 * 解析窗口行并透传 goal_status 原始行，返回透传条数。
 * 坏行（JSON/ schema 不过）warn 带 uuid 后跳过——与管道既有静默跳过语义一致，不中断。
 */
function forwardGoalLines(lines: string[], opts: GoalTapSubscriberOptions, seenUuids: Set<string>): number {
    let forwarded = 0;
    for (const line of lines) {
        if (!mayMatchAnyRule(line)) continue; // 廉价门卫：非候选行免 parse + Zod
        let parsed: unknown;
        try {
            parsed = JSON.parse(line);
        } catch {
            continue; // 非 JSON 行（半行兜底已由读取器丢弃，此处理论不可达）
        }
        const result = RawJSONLinesSchema.safeParse(parsed);
        if (!result.success) {
            const uuid = (parsed as { uuid?: string }).uuid ?? 'unknown';
            logger.warn(`[BRIDGE_GOAL] goal_status line failed schema validation, skipped: uuid=${uuid}`, result.error.message);
            continue;
        }
        if (!matchesTapRules(result.data)) {
            // hitTest 误命中的普通行（如 assistant 文本提到 goal_status）：非目标，静默跳过
            continue;
        }
        const message = result.data;
        if (seenUuids.has(message.uuid)) {
            continue;
        }
        rememberUuid(seenUuids, message.uuid);
        // 原始行逐字节透传：无字段转换、无合成、无专用出口
        opts.sendMessage(message);
        forwarded += 1;
    }
    return forwarded;
}

function rememberUuid(seenUuids: Set<string>, uuid: string): void {
    seenUuids.add(uuid);
    if (seenUuids.size > MAX_SEEN_UUIDS) {
        const oldest = seenUuids.values().next().value;
        if (oldest !== undefined) {
            seenUuids.delete(oldest);
        }
    }
}
