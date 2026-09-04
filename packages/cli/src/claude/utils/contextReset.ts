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

import type { ContextUsageBreakdown } from '@mobi/shared'
import type { AssistantUsage } from './contextUsageCalc'

/** 上次真实 turn 的水位记忆（窗口/成本/瞬时 usage/类目细分），上下文重置时整体归零。
 *  集中成对象：多份记忆总是同生共死（上报时一起读、重置时一起清），单值散落会漏 */
export type ContextUsageMemory = {
    lastMaxTokens: number
    lastCostUsd: number
    lastAssistantUsage: AssistantUsage | undefined
    /** 最近一次类目细分（result 时拉取缓存）：实时上报附带，防流式期间细分被无 breakdown 的上报覆盖丢失 */
    lastBreakdown: ContextUsageBreakdown | undefined
}

/** 上下文重置所需的 client 能力面（结构化子集，测试无需拉起真实 ApiSessionClient） */
export type ContextResetClient = {
    /** SSE 边界事件：web 渲染「上下文已重置」分隔线（与 /clear 一致） */
    sendSessionEvent: (event: { type: 'context-cleared' }) => void
    /** hub 落 runtimeState.contextUsage = null：水位线隐藏，直到下个真实 turn 的 result */
    clearContextUsage: () => void
}

/**
 * 上下文重置副作用统一收口（/clear 检测与 output style 切换共用）。
 *
 * 两者同为「清空上下文重启」语义（/clear 走 specialCommand 检测、切换走哨兵退轮），
 * 重启后的干净状态要求一致：发边界事件 + 清水位上报 + 归零成本/窗口/瞬时 usage 记忆
 * （记忆不清会把上个会话的累计成本带给下个 compact_boundary）。
 * @see packages/cli/src/claude/utils/outputStyleSwitch.ts（切换受理侧）
 */
export function applyContextReset(client: ContextResetClient, memory: ContextUsageMemory): void {
    client.sendSessionEvent({ type: 'context-cleared' })
    client.clearContextUsage()
    memory.lastMaxTokens = 0
    memory.lastCostUsd = 0
    memory.lastAssistantUsage = undefined
    memory.lastBreakdown = undefined
}
