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
    SearchOutlined,
    GlobalOutlined,
    QuestionCircleOutlined,
    FileTextOutlined,
    BulbOutlined,
    AppstoreOutlined,
    ToolOutlined,
    CheckCircleOutlined,
    CloseCircleOutlined,
    PlayCircleOutlined,
    LoadingOutlined,
} from '@ant-design/icons'
import { theme as antTheme } from 'antd'

/** 小尺寸图标样式（14px） */
export const ICON_STYLE: CSSProperties = { fontSize: 14 }

/** 大尺寸图标样式（16px） */
export const ICON_STYLE_LG: CSSProperties = { fontSize: 16 }

/**
 * 工具名称到图标组件的映射表
 */
const TOOL_ICON_MAP: Record<string, typeof ToolOutlined> = {
    Task: RocketOutlined,
    TeamCreate: TeamOutlined,
    TeamDelete: TeamOutlined,
    SendMessage: MessageOutlined,
    Bash: CodeOutlined,
    shell_command: CodeOutlined,
    Read: EyeOutlined,
    Edit: EditOutlined,
    MultiEdit: EditOutlined,
    Write: EditOutlined,
    Glob: SearchOutlined,
    Grep: SearchOutlined,
    LS: SearchOutlined,
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

/**
 * 根据工具名返回对应的图标
 * @param name 工具名称
 * @param style 图标样式，默认使用 ICON_STYLE
 */
export function getToolIcon(name: string, style: CSSProperties = ICON_STYLE): ReactNode {
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

/**
 * 根据工具状态渲染对应的状态图标
 * - completed: 绿色勾选
 * - error: 红色叉号
 * - pending: 播放图标
 * - running: 旋转加载图标
 */
export function StatusStateIcon({ state, style }: StatusStateIconProps): ReactNode {
    const { token } = antTheme.useToken()

    const mergedStyle: CSSProperties = { ...ICON_STYLE, ...style }

    switch (state) {
        case 'completed':
            return <CheckCircleOutlined style={{ ...mergedStyle, color: token.colorSuccess }} />
        case 'error':
            return <CloseCircleOutlined style={{ ...mergedStyle, color: token.colorError }} />
        case 'pending':
            return <PlayCircleOutlined style={{ ...mergedStyle, color: token.colorWarning }} />
        case 'running':
            return <LoadingOutlined style={{ ...mergedStyle, color: token.colorPrimary }} spin />
    }
}
