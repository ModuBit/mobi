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
// 收到 goal_status 信号 → 尾部窗口扫读出原始行 → 逐字节透传进与
// claude query 消息同一条管道。session 对 goal 零语义转换、不合成消息、
// 不报专用 RPC。订阅机制（退避/补偿/去重/串行化）在 transcriptTapSubscriber
// 统一收口；本文件只剩信封配置 + 行消费（schema 校验 + 透传）。

import { TRANSCRIPT_TAP_GOAL_ENVELOPE_TYPE } from '@mobi/shared';
import { logger } from '@mobi/node-core/logger';
import type { BridgeListener } from './bridgeListener';
import { registerTranscriptTapSubscriber } from './transcriptTapSubscriber';
import { RawJSONLinesSchema, type RawJSONLines } from '../types';

export interface GoalTapSubscriberOptions {
    /** 当前会话 transcript 路径解析（sessionId 未就绪返回 null，信号丢弃并 warn） */
    resolveTranscriptPath: () => string | null;
    /** 原始行透传出口：与 claude query 消息同一落库广播路径 */
    sendMessage: (message: RawJSONLines) => void;
}

/**
 * 注册订阅者，返回停用函数（透传自通用机制）。
 */
export function registerGoalTapSubscriber(bridge: BridgeListener, opts: GoalTapSubscriberOptions): () => void {
    return registerTranscriptTapSubscriber(bridge, {
        envelope: TRANSCRIPT_TAP_GOAL_ENVELOPE_TYPE,
        tag: 'BRIDGE_GOAL',
        // goal 行每 turn 一条，容量给宽（rewind/compact 重写极端场景兜底）
        maxSeenUuids: 2000,
        resolveTranscriptPath: opts.resolveTranscriptPath,
        handleRow: (row) => {
            // schema 校验兜底：hitTest 误命中的普通行 / 形状漂移行——失败 warn 带 uuid
            // 跳过，与管道既有静默跳过语义一致，不中断
            const result = RawJSONLinesSchema.safeParse(row);
            if (!result.success) {
                logger.warn(
                    `[BRIDGE_GOAL] goal_status line failed schema validation, skipped: uuid=${String(row.uuid)} `,
                    result.error.message,
                );
                return false;
            }
            // 原始行逐字节透传：无字段转换、无合成、无专用出口
            opts.sendMessage(result.data);
            return true;
        },
        // 窗口耗尽仍未见目标行：warn 带 uuid 供与 transcript 行对账
        onMissed: (signalUuid, filePath) =>
            logger.warn(
                `[BRIDGE_GOAL] goal_status line not found within tail window after retries, giving up: uuid=${signalUuid} file=${filePath}`,
            ),
    });
}
