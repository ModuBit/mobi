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

import { randomUUID } from 'node:crypto'
import type { GoalStatus } from '@mobi/shared'
import type { ApiSessionClient } from '@/lib'
import type { GoalStatusAttachment, RawJSONLines } from './types'
import { logger } from '@/ui/logger'

/**
 * session 级 goal 状态处理器(local / remote 两模式共用)。
 *
 * 收到 scanner 提取的 goal_status attachment 后双发:
 *   1. goal_progress 消息    → 聊天流(stream 标注:达成那轮仍渲染 ✓ 达成 绿)
 *   2. reportGoalStatus RPC → hub runtimeState.goalStatus(吊顶 / 徽标)
 *
 * met=true 时立即上报 null 让 UI 立即清空(达成态不再驻留吊顶);
 * goal_progress 消息照发 met:true,stream 标注仍标绿。
 */
export class GoalStatusHandler {
    constructor(
        private readonly client: ApiSessionClient,
        private readonly sendMessage: (body: RawJSONLines) => void,
    ) {}

    handle(status: GoalStatusAttachment): void {
        const goalStatus: GoalStatus = {
            met: status.met,
            condition: status.condition,
            ...(status.reason !== undefined && { reason: status.reason }),
            ...(status.iterations !== undefined && { iterations: status.iterations }),
            ...(status.durationMs !== undefined && { durationMs: status.durationMs }),
            ...(status.tokens !== undefined && { tokens: status.tokens }),
        }

        // 1. goal_progress 消息进聊天流(stream 标注:met:true 那轮仍渲染 ✓ 达成 绿)
        this.sendMessage({
            type: 'goal_progress',
            uuid: randomUUID(),
            timestamp: new Date().toISOString(),
            ...goalStatus,
        })

        // 2. RPC 上报 → hub runtimeState.goalStatus(吊顶 / 徽标)
        //    active(met:false) 上报 goalStatus 供 UI 显示;达成(met:true) 立即上报 null 让 UI 清空
        try {
            this.client.reportGoalStatus(status.met ? null : goalStatus)
        } catch (e) {
            logger.debug('[GoalStatusHandler] reportGoalStatus failed', e)
        }
    }

    /**
     * 释放资源。
     * 历史曾在此取消挂起的自动清空定时器(达成 10s 后清空),现已改为达成立即上报 null,
     * 无定时器需清;保留方法签名避免改动 launcher 调用点。
     */
    dispose(): void {
        // no-op
    }
}
