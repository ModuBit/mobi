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

/** 去重集合容量上限（goal 行每 turn 一条，防 rewind/compact 重写极端场景无界增长） */
const MAX_SEEN_UUIDS = 2000;

export function registerGoalTapSubscriber(bridge: BridgeListener, opts: GoalTapSubscriberOptions): void {
    const seenUuids = new Set<string>();
    bridge.subscribe('session.append', (payload) => {
        const signal = payload as SessionAppendSignal;
        if (!signal?.uuid) {
            logger.debug('[BRIDGE_GOAL] signal without uuid, ignored');
            return;
        }
        void handleSignal(signal, opts, seenUuids);
    });
}

async function handleSignal(signal: SessionAppendSignal, opts: GoalTapSubscriberOptions, seenUuids: Set<string>): Promise<void> {
    const filePath = opts.resolveTranscriptPath();
    if (!filePath) {
        logger.warn(`[BRIDGE_GOAL] transcript path unavailable, dropping signal uuid=${signal.uuid}`);
        return;
    }

    for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt += 1) {
        if (attempt > 0) {
            await new Promise((resolve) => setTimeout(resolve, RETRY_DELAYS_MS[attempt - 1]));
        }
        let scan;
        try {
            scan = await scanTailLines(filePath, {
                hitTest: (line) => line.includes('"goal_status"'),
            });
        } catch (e) {
            // 读取失败（权限/非常规文件等）：持久性错误，重试无意义，放弃并 warn
            logger.warn(`[BRIDGE_GOAL] tail scan failed, giving up: uuid=${signal.uuid} file=${filePath}`, e);
            return;
        }
        const forwarded = forwardGoalLines(scan.lines, opts, seenUuids);
        if (forwarded > 0) {
            return;
        }
    }

    // 窗口耗尽仍找不到：放弃并 warn（带 uuid 供与 transcript 行对账）
    logger.warn(`[BRIDGE_GOAL] goal_status line not found within tail window after retries, giving up: uuid=${signal.uuid} file=${filePath}`);
}

/**
 * 解析窗口行并透传 goal_status 原始行，返回透传条数。
 * 坏行（JSON/ schema 不过）warn 带 uuid 后跳过——与管道既有静默跳过语义一致，不中断。
 */
function forwardGoalLines(lines: string[], opts: GoalTapSubscriberOptions, seenUuids: Set<string>): number {
    let forwarded = 0;
    for (const line of lines) {
        let parsed: unknown;
        try {
            parsed = JSON.parse(line);
        } catch {
            continue; // 非 JSON 行（半行兜底已由读取器丢弃，此处理论不可达）
        }
        const result = RawJSONLinesSchema.safeParse(parsed);
        if (!result.success || result.data.type !== 'attachment') {
            const uuid = (parsed as { uuid?: string }).uuid ?? 'unknown';
            logger.warn(`[BRIDGE_GOAL] goal_status line failed schema validation, skipped: uuid=${uuid}`, result.success ? undefined : result.error.message);
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
