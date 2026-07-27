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
 * 共享的工具图标映射和状态图标组件
 * 用于 ToolInlinePreview 和 ToolDetailDrawer
 */

import type { CSSProperties, ComponentType, ReactNode } from 'react'
import { CalendarClock, CheckCheck, FolderGit2, LineSquiggle, UserRoundX } from 'lucide-react'
import {
    RocketOutlined,
    TeamOutlined,
    MessageOutlined,
    CodeOutlined,
    EyeOutlined,
    SignatureOutlined,
    FileSearchOutlined,
    GlobalOutlined,
    QuestionCircleOutlined,
    FileTextOutlined,
    BulbOutlined,
    ApiOutlined,
    ToolOutlined,
} from '@ant-design/icons'
import type { AgentStatus } from '@/components/pixel-avatar/types'

/** 小尺寸图标样式（14px） */
export const ICON_STYLE: CSSProperties = { fontSize: 14 }

/** 大尺寸图标样式（16px） */
export const ICON_STYLE_LG: CSSProperties = { fontSize: 16 }

/**
 * 工具名称到图标组件的映射表
 */
export const TOOL_ICON_MAP: Record<string, ComponentType<{ style?: CSSProperties; size?: number }>> = {
    Agent: RocketOutlined,
    Task: RocketOutlined,
    TeamCreate: TeamOutlined,
    TeamDelete: UserRoundX,
    SendMessage: MessageOutlined,
    Bash: CodeOutlined,
    shell_command: CodeOutlined,
    Read: EyeOutlined,
    Edit: SignatureOutlined,
    MultiEdit: SignatureOutlined,
    Write: SignatureOutlined,
    Glob: FileSearchOutlined,
    Grep: FileSearchOutlined,
    LS: FileSearchOutlined,
    WebFetch: GlobalOutlined,
    WebSearch: GlobalOutlined,
    AskUserQuestion: QuestionCircleOutlined,
    ask_user_question: QuestionCircleOutlined,
    request_user_input: QuestionCircleOutlined,
    ExitPlanMode: FileTextOutlined,
    exit_plan_mode: FileTextOutlined,
    update_plan: FileTextOutlined,
    TodoWrite: BulbOutlined,
    TaskList: CheckCheck,
    TaskGet: CheckCheck,
    TaskOutput: CheckCheck,
    TaskStop: CheckCheck,
    NotebookRead: EyeOutlined,
    NotebookEdit: SignatureOutlined,
    CronCreate: CalendarClock,
    CronDelete: CalendarClock,
    CronList: CalendarClock,
    ScheduleWakeup: CalendarClock,
    Skill: ApiOutlined,
    EnterWorktree: FolderGit2,
    ExitWorktree: FolderGit2,
}

/** Lucide 图标工具名 */
export const LUCIDE_TOOL_NAMES = new Set(['TaskList', 'TaskGet', 'TaskOutput', 'TaskStop', 'CronCreate', 'CronDelete', 'CronList', 'ScheduleWakeup', 'EnterWorktree', 'ExitWorktree', 'TeamDelete'])

/**
 * 根据工具名返回对应的图标。
 * Agent/Task 工具统一用 RocketOutlined（不再用 PixelAvatar，状态指示由调用处的 StatusStateIcon 承担）。
 */
export function getToolIcon(name: string, style: CSSProperties = ICON_STYLE): ReactNode {
    // mcp__ 前缀的工具使用 LineSquiggle 图标
    if (name.startsWith('mcp__')) {
        const iconSize = typeof style.fontSize === 'number' ? style.fontSize : 14
        return <LineSquiggle size={iconSize} />
    }

    const IconComponent = TOOL_ICON_MAP[name]
    if (IconComponent) {
        // Lucide 图标使用 size prop，Ant Design 图标使用 style.fontSize
        if (LUCIDE_TOOL_NAMES.has(name)) {
            const iconSize = typeof style.fontSize === 'number' ? style.fontSize : 14
            return <IconComponent size={iconSize} />
        }
        return <IconComponent style={style} />
    }

    // 默认使用扳手图标
    return <ToolOutlined style={style} />
}

/**
 * 工具调用状态类型
 */
type ToolCallState = 'pending' | 'running' | 'completed' | 'error'

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
 * - outputting / running → running（蓝呼吸）
 * - pending → pending（橙呼吸，工具排队，沿用原工具行为）
 * - awaiting_auth → awaiting_auth（橙颤动，session 等审批）
 * - idle → idle（绿舒缓呼吸，session 等输入）
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

/**
 * 状态图标组件的属性
 */
type StatusStateIconProps = {
    /** 工具侧 ToolCallState 或 session 侧 AgentStatus，内部映射到统一 StatusDotState */
    state: ToolCallState | AgentStatus
    style?: CSSProperties
}

/** 各 StatusDotState 对应的动画；未列出的状态（completed/inactive/error）为静态 */
const STATUS_DOT_ANIMATION: Partial<Record<StatusDotState, string>> = {
    running: 'status-dot-breathe 1.1s ease-in-out infinite',
    pending: 'status-dot-breathe 1.5s ease-in-out infinite',
    awaiting_auth: 'status-dot-shake 0.45s ease-in-out infinite',
    idle: 'status-dot-breathe-slow 3s ease-in-out infinite',
}

/**
 * 状态小圆点：running/awaiting_auth/idle 各带对应节奏动画，inactive/error 静态。
 * 颜色与状态映射全 app 统一，由 STATUS_DOT_COLORS + toStatusDotState 承载。
 */
export function StatusStateIcon({ state, style }: StatusStateIconProps): ReactNode {
    const dotState = toStatusDotState(state)
    const dotStyle: CSSProperties = {
        width: 6,
        height: 6,
        borderRadius: '50%',
        background: STATUS_DOT_COLORS[dotState],
        display: 'inline-block',
        flexShrink: 0,
        animation: STATUS_DOT_ANIMATION[dotState],
        ...style,
    }
    return <span className="status-state-dot" style={dotStyle} />
}
