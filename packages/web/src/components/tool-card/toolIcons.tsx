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

import type { CSSProperties, ReactNode } from 'react'
import {
    RocketOutlined,
    TeamOutlined,
    MessageOutlined,
    CodeOutlined,
    EyeOutlined,
    EditOutlined,
    SignatureOutlined,
    SearchOutlined,
    FileSearchOutlined,
    GlobalOutlined,
    QuestionCircleOutlined,
    FileTextOutlined,
    BulbOutlined,
    AppstoreOutlined,
    ToolOutlined,
} from '@ant-design/icons'
import { PixelAvatar } from '@/components/pixel-avatar/PixelAvatar'
import type { AgentStatus } from '@/components/pixel-avatar/types'

/** 小尺寸图标样式（14px） */
export const ICON_STYLE: CSSProperties = { fontSize: 14 }

/** 大尺寸图标样式（16px） */
export const ICON_STYLE_LG: CSSProperties = { fontSize: 16 }

/**
 * 工具名称到图标组件的映射表
 */
const TOOL_ICON_MAP: Record<string, typeof ToolOutlined> = {
    Agent: RocketOutlined,
    Task: RocketOutlined,
    TeamCreate: TeamOutlined,
    TeamDelete: TeamOutlined,
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
    update_plan: BulbOutlined,
    TodoWrite: BulbOutlined,
    NotebookRead: EyeOutlined,
    NotebookEdit: EditOutlined,
}

/** Agent/Task 工具名 */
const AGENT_TOOL_NAMES = new Set(['Task', 'Agent'])

/** 将工具状态映射为 PixelAvatar 状态 */
function toolStateToAvatarStatus(state: ToolCallState): AgentStatus {
    if (state === 'running') return 'outputting'
    if (state === 'pending') return 'awaiting_auth'
    return 'inactive'
}

type ToolIconOpts = {
    style?: CSSProperties
    /** Agent 工具的 tool_use_id，用于生成头像 */
    id?: string
    /** 工具状态，Agent 工具用于控制动态/静态头像 */
    state?: ToolCallState
}

/**
 * 根据工具名返回对应的图标
 * Agent/Task 工具在提供 id + state 时返回 PixelAvatar 动态头像
 */
export function getToolIcon(name: string, opts: CSSProperties | ToolIconOpts = ICON_STYLE): ReactNode {
    // CSSProperties 直接传入时没有 id/state 字段，转为 ToolIconOpts
    const hasOptsFields = typeof opts === 'object' && opts !== null && ('id' in opts || 'state' in opts || 'style' in opts)
        && !('fontSize' in opts && !('id' in opts) && !('state' in opts) && !('style' in opts))
    const resolved: ToolIconOpts = hasOptsFields ? opts as ToolIconOpts : { style: opts as CSSProperties }
    const style = resolved.style ?? ICON_STYLE

    // Agent/Task 工具：有 id 和 state 时使用 PixelAvatar
    if (AGENT_TOOL_NAMES.has(name) && resolved.id && resolved.state) {
        return <PixelAvatar name={resolved.id} status={toolStateToAvatarStatus(resolved.state)} size={typeof style.fontSize === 'number' ? style.fontSize + 4 : 18} />
    }

    // mcp__ 前缀的工具使用方块图标
    if (name.startsWith('mcp__')) {
        return <AppstoreOutlined style={style} />
    }

    const IconComponent = TOOL_ICON_MAP[name]
    if (IconComponent) {
        return <IconComponent style={style} />
    }

    // 默认使用扳手图标
    return <ToolOutlined style={style} />
}

/**
 * 工具调用状态类型
 */
type ToolCallState = 'pending' | 'running' | 'completed' | 'error'

/**
 * 状态图标组件的属性
 */
type StatusStateIconProps = {
    state: ToolCallState
    style?: CSSProperties
}

const STATUS_DOT_COLORS: Record<ToolCallState, string> = {
    running: 'var(--ant-color-primary)',
    pending: 'var(--ant-color-warning)',
    completed: 'var(--ant-color-success)',
    error: 'var(--ant-color-error)',
}

/**
 * 状态小圆点：running/pending 时有呼吸动画
 */
export function StatusStateIcon({ state, style }: StatusStateIconProps): ReactNode {
    const isActive = state === 'running' || state === 'pending'
    const dotStyle: CSSProperties = {
        width: 6,
        height: 6,
        borderRadius: '50%',
        background: STATUS_DOT_COLORS[state],
        display: 'inline-block',
        flexShrink: 0,
        animation: isActive ? 'status-dot-breathe 1.5s ease-in-out infinite' : undefined,
        ...style,
    }
    return <span style={dotStyle} />
}
