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

import type { ReactNode } from 'react'
import type { SessionMetadataSummary } from '@/core/data/api/types'
import { isObject } from '@mobi/shared'
import {
    CodeOutlined,
    SearchOutlined,
    EyeOutlined,
    EditOutlined,
    GlobalOutlined,
    BulbOutlined,
    RocketOutlined,
    ToolOutlined,
    QuestionCircleOutlined,
    TeamOutlined,
    MessageOutlined,
    AppstoreOutlined,
    FileTextOutlined,
    PlayCircleOutlined
} from '@ant-design/icons'
import type { ChecklistItem } from './checklist'
import { extractTodoChecklist, extractUpdatePlanChecklist } from './checklist'
import { basename, resolveDisplayPath } from '@/core/utils/path'
import { getInputStringAny, truncate } from '@/core/lib/toolInputUtils'

const DEFAULT_ICON_STYLE: React.CSSProperties = { fontSize: 14 }

/** 终端工具名称列表 */
export const TERMINAL_TOOL_NAMES = ['Bash', 'shell_command'] as const

/** 判断是否为终端工具 */
export function isTerminalTool(toolName: string): boolean {
    return TERMINAL_TOOL_NAMES.includes(toolName as typeof TERMINAL_TOOL_NAMES[number])
}

// Tool presentation 类型
export type ToolPresentation = {
    icon: ReactNode
    title: string
    subtitle: string | null
    minimal: boolean
    /** 是否需要宽 Drawer（代码类工具） */
    wideDrawer?: boolean
    /** title 是否为文件路径（启用中间省略） */
    isFilePath?: boolean
}

function countLines(text: string): number {
    return text.split('\n').length
}

function formatChecklistCount(items: ChecklistItem[], noun: string): string | null {
    if (items.length === 0) return null
    return `${items.length} ${noun}${items.length === 1 ? '' : 's'}`
}

function snakeToTitleWithSpaces(value: string): string {
    return value
        .split('_')
        .filter((part) => part.length > 0)
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
        .join(' ')
}

function formatMCPTitle(toolName: string): string {
    const withoutPrefix = toolName.replace(/^mcp__/, '')
    const parts = withoutPrefix.split('__')
    if (parts.length >= 2) {
        const serverName = parts[0]
        const toolPart = parts.slice(1).join('_')
        return `(MCP) ${serverName}:${toolPart}`
    }
    return `(MCP) ${withoutPrefix}`
}

type ToolOpts = {
    toolName: string
    input: unknown
    result: unknown
    childrenCount: number
    description: string | null
    metadata: SessionMetadataSummary | null
}

// 通用终端工具配置（Bash / shell_command 共用）
const terminalToolConfig = {
    icon: () => <CodeOutlined style={DEFAULT_ICON_STYLE} />,
    title: (opts: ToolOpts) => opts.description ?? 'Terminal',
    subtitle: (opts: ToolOpts) => getInputStringAny(opts.input, ['command', 'cmd']),
    minimal: true
}

// 退出计划模式工具配置（ExitPlanMode / exit_plan_mode 共用）
const exitPlanModeConfig = {
    icon: () => <FileTextOutlined style={DEFAULT_ICON_STYLE} />,
    title: () => 'Plan proposal',
    minimal: false
}

// 用户提问工具标题生成（AskUserQuestion / ask_user_question / request_user_input 共用）
function askUserQuestionTitle(opts: ToolOpts, titleField: 'header' | 'id' = 'header'): string {
    const questions = isObject(opts.input) && Array.isArray(opts.input.questions)
        ? opts.input.questions : []
    const count = questions.length
    const first = questions[0] ?? null
    const titleValue = isObject(first) && typeof first[titleField] === 'string'
        ? (first[titleField] as string).trim() : ''

    if (count > 1) {
        return `${count} Questions`
    }
    return titleValue.length > 0 ? titleValue : 'Question'
}

// 用户提问工具副标题生成（共用）
function askUserQuestionSubtitle(opts: ToolOpts): string | null {
    const questions = isObject(opts.input) && Array.isArray(opts.input.questions)
        ? opts.input.questions : []
    const count = questions.length
    const first = questions[0] ?? null
    const question = isObject(first) && typeof first.question === 'string'
        ? first.question.trim() : ''

    if (count > 1 && question.length > 0) {
        return truncate(question, 100) + ` (+${count - 1} more)`
    }
    return question.length > 0 ? truncate(question, 120) : null
}

// AskUserQuestion 和 ask_user_question 共用配置（基于 header 字段）
const askUserQuestionConfig = {
    icon: () => <QuestionCircleOutlined style={DEFAULT_ICON_STYLE} />,
    title: (opts: ToolOpts) => askUserQuestionTitle(opts, 'header'),
    subtitle: (opts: ToolOpts) => askUserQuestionSubtitle(opts),
    minimal: true
}

export const knownTools: Record<string, {
    icon: (opts: ToolOpts) => ReactNode
    title: (opts: ToolOpts) => string
    subtitle?: (opts: ToolOpts) => string | null
    minimal?: boolean | ((opts: ToolOpts) => boolean)
    /** 是否需要宽 Drawer（代码类工具） */
    wideDrawer?: boolean
    /** title 是否为文件路径（启用中间省略） */
    isFilePath?: boolean
}> = {
    Task: {
        icon: () => <RocketOutlined style={DEFAULT_ICON_STYLE} />,
        title: (opts) => {
            const name = getInputStringAny(opts.input, ['name'])
            const teamName = getInputStringAny(opts.input, ['team_name'])
            if (name && teamName) return `Agent: ${name}`
            const description = getInputStringAny(opts.input, ['description'])
            return description ?? 'Task'
        },
        subtitle: (opts) => {
            const prompt = getInputStringAny(opts.input, ['prompt'])
            return prompt ? truncate(prompt, 120) : null
        },
        minimal: (opts) => opts.childrenCount === 0
    },
    TeamCreate: {
        icon: () => <TeamOutlined style={DEFAULT_ICON_STYLE} />,
        title: (opts) => {
            const teamName = getInputStringAny(opts.input, ['team_name'])
            return teamName ? `Team: ${teamName}` : 'Create Team'
        },
        subtitle: (opts) => getInputStringAny(opts.input, ['description']) ?? null,
        minimal: false
    },
    TeamDelete: {
        icon: () => <TeamOutlined style={DEFAULT_ICON_STYLE} />,
        title: () => 'Delete Team',
        minimal: true
    },
    SendMessage: {
        icon: () => <MessageOutlined style={DEFAULT_ICON_STYLE} />,
        title: (opts) => {
            const recipient = getInputStringAny(opts.input, ['recipient'])
            const msgType = getInputStringAny(opts.input, ['type'])
            if (msgType === 'broadcast') return 'Broadcast'
            if (msgType === 'shutdown_request') return `Shutdown: ${recipient ?? 'agent'}`
            if (msgType === 'shutdown_response') return 'Shutdown Response'
            return recipient ? `Message: ${recipient}` : 'Send Message'
        },
        subtitle: (opts) => {
            const summary = getInputStringAny(opts.input, ['summary'])
            return summary ? truncate(summary, 120) : null
        },
        minimal: true
    },
    Bash: { ...terminalToolConfig, wideDrawer: true },
    Glob: {
        icon: () => <SearchOutlined style={DEFAULT_ICON_STYLE} />,
        title: (opts) => getInputStringAny(opts.input, ['pattern']) ?? 'Search files',
        minimal: true
    },
    Grep: {
        icon: () => <EyeOutlined style={DEFAULT_ICON_STYLE} />,
        title: (opts) => {
            const pattern = getInputStringAny(opts.input, ['pattern'])
            return pattern ? `grep(pattern: ${pattern})` : 'Search content'
        },
        minimal: true
    },
    LS: {
        icon: () => <SearchOutlined style={DEFAULT_ICON_STYLE} />,
        title: (opts) => {
            const path = getInputStringAny(opts.input, ['path'])
            return path ? resolveDisplayPath(path, opts.metadata) : 'List files'
        },
        minimal: true
    },
    shell_command: terminalToolConfig,
    Read: {
        icon: () => <EyeOutlined style={DEFAULT_ICON_STYLE} />,
        title: (opts) => {
            const file = getInputStringAny(opts.input, ['file_path', 'path', 'file'])
            const basePath = file ? resolveDisplayPath(file, opts.metadata) : 'Read file'

            // 从 input 提取 limit 和 offset
            const limit = isObject(opts.input) && typeof opts.input.limit === 'number' ? opts.input.limit : null
            const offset = isObject(opts.input) && typeof opts.input.offset === 'number' ? opts.input.offset : null

            // 从 result 提取实际读取的行数
            let resultLineCount: number | null = null
            if (typeof opts.result === 'string') {
                resultLineCount = opts.result.split('\n').filter(line => line.trim().length > 0).length
            }

            // 构建行范围信息
            if (offset !== null && resultLineCount !== null) {
                const startLine = offset + 1
                const endLine = offset + resultLineCount
                return `${basePath} (L${startLine}-${endLine})`
            }
            if (offset !== null && limit !== null) {
                const startLine = offset + 1
                const endLine = offset + limit
                return `${basePath} (L${startLine}-${endLine})`
            }
            if (resultLineCount !== null) {
                return `${basePath} (${resultLineCount} lines)`
            }
            if (limit !== null) {
                return `${basePath} (${limit} lines)`
            }

            return basePath
        },
        minimal: true,
        wideDrawer: true
    },
    Edit: {
        icon: () => <EditOutlined style={DEFAULT_ICON_STYLE} />,
        title: (opts) => {
            const file = getInputStringAny(opts.input, ['file_path', 'path'])
            if (!file) return 'Edit file'
            return resolveDisplayPath(file, opts.metadata)
        },
        minimal: true,
        wideDrawer: true,
        isFilePath: true
    },
    MultiEdit: {
        icon: () => <EditOutlined style={DEFAULT_ICON_STYLE} />,
        title: (opts) => {
            const file = getInputStringAny(opts.input, ['file_path', 'path'])
            if (!file) return 'Edit file'
            const edits = isObject(opts.input) && Array.isArray(opts.input.edits) ? opts.input.edits : null
            const count = edits ? edits.length : 0
            const path = resolveDisplayPath(file, opts.metadata)
            return count > 1 ? `${path} (${count} edits)` : path
        },
        minimal: true,
        wideDrawer: true,
        isFilePath: true
    },
    Write: {
        icon: () => <EditOutlined style={DEFAULT_ICON_STYLE} />,
        title: (opts) => {
            const file = getInputStringAny(opts.input, ['file_path', 'path'])
            if (!file) return 'Write file'
            return resolveDisplayPath(file, opts.metadata)
        },
        subtitle: (opts) => {
            const content = getInputStringAny(opts.input, ['content', 'text'])
            if (!content) return null
            const lines = countLines(content)
            return lines > 1 ? `${lines} lines` : `${content.length} chars`
        },
        minimal: true,
        wideDrawer: true,
        isFilePath: true
    },
    WebFetch: {
        icon: () => <GlobalOutlined style={DEFAULT_ICON_STYLE} />,
        title: (opts) => {
            const url = getInputStringAny(opts.input, ['url'])
            if (!url) return 'Web fetch'
            try {
                return new URL(url).hostname
            } catch {
                return url
            }
        },
        subtitle: (opts) => {
            const url = getInputStringAny(opts.input, ['url'])
            if (!url) return null
            return url
        },
        minimal: true
    },
    WebSearch: {
        icon: () => <GlobalOutlined style={DEFAULT_ICON_STYLE} />,
        title: (opts) => getInputStringAny(opts.input, ['query']) ?? 'Web search',
        subtitle: (opts) => {
            const query = getInputStringAny(opts.input, ['query'])
            return query ? truncate(query, 80) : null
        },
        minimal: true
    },
    NotebookRead: {
        icon: () => <EyeOutlined style={DEFAULT_ICON_STYLE} />,
        title: (opts) => {
            const path = getInputStringAny(opts.input, ['notebook_path'])
            return path ? resolveDisplayPath(path, opts.metadata) : 'Read notebook'
        },
        minimal: true,
        wideDrawer: true
    },
    NotebookEdit: {
        icon: () => <EditOutlined style={DEFAULT_ICON_STYLE} />,
        title: (opts) => {
            const path = getInputStringAny(opts.input, ['notebook_path'])
            return path ? resolveDisplayPath(path, opts.metadata) : 'Edit notebook'
        },
        subtitle: (opts) => {
            const mode = getInputStringAny(opts.input, ['edit_mode'])
            return mode ? `mode: ${mode}` : null
        },
        minimal: false
    },
    TodoWrite: {
        icon: () => <BulbOutlined style={DEFAULT_ICON_STYLE} />,
        title: () => 'Todo list',
        subtitle: (opts) => formatChecklistCount(extractTodoChecklist(opts.input, opts.result), 'item'),
        minimal: (opts) => extractTodoChecklist(opts.input, opts.result).length === 0
    },
    update_plan: {
        icon: () => <FileTextOutlined style={DEFAULT_ICON_STYLE} />,
        title: () => 'Plan',
        subtitle: (opts) => formatChecklistCount(extractUpdatePlanChecklist(opts.input, opts.result), 'step'),
        minimal: (opts) => extractUpdatePlanChecklist(opts.input, opts.result).length === 0
    },
    ExitPlanMode: exitPlanModeConfig,
    exit_plan_mode: exitPlanModeConfig,
    AskUserQuestion: askUserQuestionConfig,
    ask_user_question: askUserQuestionConfig,
    request_user_input: {
        icon: () => <QuestionCircleOutlined style={DEFAULT_ICON_STYLE} />,
        title: (opts) => askUserQuestionTitle(opts, 'id'),
        subtitle: (opts) => askUserQuestionSubtitle(opts),
        minimal: true
    }
}

export function getToolPresentation(opts: Omit<ToolOpts, 'metadata'> & { metadata: SessionMetadataSummary | null }): ToolPresentation {
    if (opts.toolName.startsWith('mcp__')) {
        return {
            icon: <AppstoreOutlined style={DEFAULT_ICON_STYLE} />,
            title: formatMCPTitle(opts.toolName),
            subtitle: null,
            minimal: true
        }
    }

    const known = knownTools[opts.toolName]
    if (known) {
        const minimal = typeof known.minimal === 'function' ? known.minimal(opts) : (known.minimal ?? false)
        return {
            icon: known.icon(opts),
            title: known.title(opts),
            subtitle: known.subtitle ? known.subtitle(opts) : null,
            minimal,
            wideDrawer: known.wideDrawer ?? false,
            isFilePath: known.isFilePath ?? false
        }
    }

    const filePath = getInputStringAny(opts.input, ['file_path', 'path', 'filePath', 'file'])
    const command = getInputStringAny(opts.input, ['command', 'cmd'])
    const pattern = getInputStringAny(opts.input, ['pattern'])
    const url = getInputStringAny(opts.input, ['url'])
    const query = getInputStringAny(opts.input, ['query'])

    const subtitle = filePath ?? command ?? pattern ?? url ?? query

    return {
        icon: <ToolOutlined style={DEFAULT_ICON_STYLE} />,
        title: opts.toolName,
        subtitle: subtitle ? truncate(subtitle, 80) : null,
        minimal: true
    }
}
