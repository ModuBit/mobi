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

/** goal 达成后,延迟多久清空 hub 侧 goalStatus(避免吊顶瞬间消失) */
const MET_AUTOCLEAR_DELAY = 10_000

/**
 * session 级 goal 状态处理器(local / remote 两模式共用)。
 *
 * 收到 scanner 提取的 goal_status attachment 后双发:
 *   1. reportGoalStatus RPC → hub runtimeState.goalStatus(吊顶 / 徽标)
 *   2. goal_progress 消息    → 聊天流(stream 标注)
 *
 * met=true 时启动 10s 定时器,到期清空 goalStatus;新 status 到达时取消挂起定时器,
 * 避免上一个达成态的自动清空误覆盖新状态。
 */
export class GoalStatusHandler {
    private metTimer: ReturnType<typeof setTimeout> | null = null

    constructor(
        private readonly client: ApiSessionClient,
        private readonly sendMessage: (body: RawJSONLines) => void,
    ) {}

    handle(status: GoalStatusAttachment): void {
        this.clearMetTimer()

        const goalStatus: GoalStatus = {
            met: status.met,
            condition: status.condition,
            ...(status.reason !== undefined && { reason: status.reason }),
            ...(status.iterations !== undefined && { iterations: status.iterations }),
            ...(status.durationMs !== undefined && { durationMs: status.durationMs }),
            ...(status.tokens !== undefined && { tokens: status.tokens }),
        }

        // 1. RPC 上报 → hub 落库 + SSE 推 web(失败静默,不阻塞聊天流)
        try {
            this.client.reportGoalStatus(goalStatus)
        } catch {
            /* 静默:goal 状态非关键路径 */
        }

        // 2. goal_progress 消息进聊天流(stream 标注)
        this.sendMessage({
            type: 'goal_progress',
            uuid: randomUUID(),
            timestamp: new Date().toISOString(),
            ...goalStatus,
        })

        // 3. 达成后启动自动清空定时器(到期发 null 清 hub goalStatus)
        if (status.met) {
            this.metTimer = setTimeout(() => {
                try {
                    this.client.reportGoalStatus(null)
                } catch {
                    /* 静默 */
                }
                this.metTimer = null
            }, MET_AUTOCLEAR_DELAY)
        }
    }

    /** 释放资源:取消挂起的自动清空定时器 */
    dispose(): void {
        this.clearMetTimer()
    }

    private clearMetTimer(): void {
        if (this.metTimer) {
            clearTimeout(this.metTimer)
            this.metTimer = null
        }
    }
}
