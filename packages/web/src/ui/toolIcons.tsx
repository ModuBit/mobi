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
 * 工具图标映射 + 状态图标组件（StatusStateIcon / StatusIcon / StatusToolIcon）。
 * 状态色板与状态映射（STATUS_DOT_COLORS / toStatusDotState / statusColorOf）已下沉
 * core/utils/statusColor（分层治理票 01），本文件只留图标载体与样式组装。
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
import type { AgentStatus } from '@/core/utils/agentStatus'
import { STATUS_DOT_COLORS, statusColorOf, toStatusDotState, type StatusDotState, type ToolCallState } from '@/core/utils/statusColor'

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

/**
 * 状态 → icon 强调样式（颜色 + 动画）：由图标本身承载状态时的统一样式来源，
 * 色板走 statusColorOf（去色语义单点，core/utils/statusColor），动画用 icon 专用呼吸。
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
