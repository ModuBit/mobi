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
 * 工具图标映射 + 全 app 状态视觉基座（状态点/状态图标）。
 * 状态色唯一来源 STATUS_DOT_COLORS；状态承载组件 StatusStateIcon（点）、
 * StatusIcon/StatusToolIcon（图标本体）。供 chat blocks、tool-card、layout 等多域消费。
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

/**
 * 状态图标组件的属性
 */
type StatusStateIconProps = {
    /** 工具侧 ToolCallState 或 session 侧 AgentStatus，内部映射到统一 StatusDotState */
    state: ToolCallState | AgentStatus
    style?: CSSProperties
}

/**
 * 各状态图标本体呼吸节奏（icon 载体的动画单点来源）；未列出的状态为静态。
 * dot 载体已不含动画——running（旋转弧）/idle（sonar 扩散环）由形状承载，
 * pending/awaiting_auth 为静态橙点（见 StatusStateIcon）
 */
const STATUS_ANIMATIONS: Partial<Record<StatusDotState, string>> = {
    running: 'status-icon-breathe 1.1s ease-in-out infinite',
    pending: 'status-icon-breathe 1.5s ease-in-out infinite',
    awaiting_auth: 'status-icon-breathe 0.45s ease-in-out infinite',
    idle: 'status-icon-breathe 3s ease-in-out infinite',
}

/**
 * 状态小圆点：形状承载状态（弧=运行中 / sonar 点=空闲 / 橙点微光=待审批），
 * pending/inactive/error/completed 静态纯色。
 * 颜色与状态映射全 app 统一，由 STATUS_DOT_COLORS + toStatusDotState 承载。
 */
export function StatusStateIcon({ state, style }: StatusStateIconProps): ReactNode {
    const dotState = toStatusDotState(state)
    const base: CSSProperties = { display: 'inline-block', flexShrink: 0, ...style }
    // 形状承载状态（会话列表等仪表盘场景需跨行一眼区分）：
    // 弧=运行中（忙，不用管）· sonar 点=空闲待命（到你）· 橙点微光=待审批（要行动）· 极淡点=关闭
    // 颜色只留语义例外（审批橙/错误红/完成绿），运行与空闲均用默认色
    if (dotState === 'running') {
        return <span className="status-dot-arc" style={{ width: 10, height: 10, borderRadius: '50%', ...base }} />
    }
    if (dotState === 'idle') {
        return (
            <span
                className="status-dot-sonar"
                style={{ width: 9, height: 9, borderRadius: '50%', background: 'currentColor', ...base }}
            />
        )
    }
    const dotStyle: CSSProperties = {
        width: 8,
        height: 8,
        borderRadius: '50%',
        background: STATUS_DOT_COLORS[dotState],
        ...base,
    }
    // 微光 alpha 0.55（hex8 尾字节 8c）从唯一色源派生，改审批橙时辉光自动跟随
    if (dotState === 'awaiting_auth') dotStyle.boxShadow = `0 0 6px ${STATUS_DOT_COLORS.awaiting_auth}8c`
    return <span style={dotStyle} />
}

/** 不染状态色的状态集合：动 = 活、静 = 落定，颜色只留给语义例外（错误红/审批橙）——running 靠动效表达活跃 */
const UNCOLORED_DOT_STATES: ReadonlySet<StatusDotState> = new Set(['running', 'completed'])

/** 状态 → 显示色：UNCOLORED_DOT_STATES 内的状态返回 undefined（继承默认色）。状态显示色的统一取色口 */
export function statusColorOf(dotState: StatusDotState): string | undefined {
    return UNCOLORED_DOT_STATES.has(dotState) ? undefined : STATUS_DOT_COLORS[dotState]
}

/**
 * 状态 → icon 强调样式（颜色 + 动画）：由图标本身承载状态时的统一样式来源，
 * 色板走 statusColorOf（去色语义单点），动画用 icon 专用呼吸。
 */
export function statusIconStyle(state: ToolCallState | AgentStatus): CSSProperties {
    const dotState = toStatusDotState(state)
    return { color: statusColorOf(dotState), animation: STATUS_ANIMATIONS[dotState] }
}

type StatusIconProps = {
    /** 工具侧 ToolCallState 或 session 侧 AgentStatus */
    state: ToolCallState | AgentStatus
    style?: CSSProperties
    /** 任意图标节点（ThinkIcon/Layers/antd icon…）；要按工具名取图标用 StatusToolIcon */
    children: ReactNode
}

/**
 * 状态图标：「图标本体承载状态」的统一载体——图标染状态色，running/pending 呼吸，
 * completed/error 静态。取代「状态点 + 图标」双元素。
 */
export function StatusIcon({ state, style, children }: StatusIconProps): ReactNode {
    return (
        <span style={{ display: 'inline-flex', flexShrink: 0, ...statusIconStyle(state), ...style }}>
            {children}
        </span>
    )
}

/** 状态工具图标的属性 */
type StatusToolIconProps = {
    /** 工具名（经 getToolIcon 映射图标） */
    name: string
    /** 工具侧 ToolCallState 或 session 侧 AgentStatus */
    state: ToolCallState | AgentStatus
    style?: CSSProperties
}

/** 状态工具图标：StatusIcon 的按名取图便捷入口 */
export function StatusToolIcon({ name, state, style }: StatusToolIconProps): ReactNode {
    return (
        <StatusIcon state={state} style={style}>
            {getToolIcon(name)}
        </StatusIcon>
    )
}
