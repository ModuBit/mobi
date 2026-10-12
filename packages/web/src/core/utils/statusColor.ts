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

/**
 * 全 app 状态视觉基座（src 分层治理票 01 自 tool-card/toolIcons 下沉）：
 * 统一状态空间（StatusDotState）、唯一状态色板（STATUS_DOT_COLORS）、
 * 两侧状态（session AgentStatus / 工具 ToolCallState）到统一空间的映射与取色口。
 * 纯数据零 React——core 不再反向依赖工具卡/像素头像实现。
 */

import type { AgentStatus } from './agentStatus'

/** 工具调用状态类型 */
export type ToolCallState = 'pending' | 'running' | 'completed' | 'error'

/** StatusDot 统一状态空间（session 侧 AgentStatus 与工具侧 ToolCallState 共同映射目标） */
export type StatusDotState = 'running' | 'pending' | 'awaiting_auth' | 'idle' | 'completed' | 'inactive' | 'error'

/** 统一状态色板 —— 全 app 唯一状态色来源 */
export const STATUS_DOT_COLORS: Record<StatusDotState, string> = {
    running: '#4dabf7',
    pending: '#ffa726',
    awaiting_auth: '#ffa726',
    idle: '#66bb6a',
    completed: '#66bb6a',
    inactive: '#d9d9d9',
    error: '#ef5350',
}

/**
 * 将 session 侧 AgentStatus 或工具侧 ToolCallState 映射到统一 StatusDotState。
 * - outputting / running → running（旋转弧，忙）
 * - pending → pending（橙点静态，工具排队）
 * - awaiting_auth → awaiting_auth（橙点微光，session 等审批）
 * - idle → idle（sonar 扩散环，session 等输入）
 * - completed → completed（绿静态，工具执行成功）
 * - inactive → inactive（灰静态，session 未激活）
 * - error → error（红静态）
 */
export function toStatusDotState(state: AgentStatus | ToolCallState): StatusDotState {
    switch (state) {
        case 'outputting':
        case 'running': return 'running'
        case 'pending': return 'pending'
        case 'awaiting_auth': return 'awaiting_auth'
        case 'idle': return 'idle'
        case 'completed': return 'completed'
        case 'inactive': return 'inactive'
        case 'error': return 'error'
        default: return 'inactive'
    }
}

/** 不染状态色的状态集合：动 = 活、静 = 落定，颜色只留给语义例外（错误红/审批橙）——running 靠动效表达活跃 */
const UNCOLORED_DOT_STATES: ReadonlySet<StatusDotState> = new Set(['running', 'completed'])

/** 状态 → 显示色：UNCOLORED_DOT_STATES 内的状态返回 undefined（继承默认色）。状态显示色的统一取色口 */
export function statusColorOf(dotState: StatusDotState): string | undefined {
    return UNCOLORED_DOT_STATES.has(dotState) ? undefined : STATUS_DOT_COLORS[dotState]
}
