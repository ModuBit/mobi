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
import { joinQuestionHeaders } from '@/domain/tool/askUserQuestion'
import { ToolOutlined } from '@ant-design/icons'
import { LineSquiggle } from 'lucide-react'
import type { ChecklistItem } from './checklist'
import { extractTodoChecklist, extractUpdatePlanChecklist } from './checklist'
import { resolveDisplayPath } from '@/core/utils/path'
import { getInputStringAny, truncate, parseMCPToolName, formatMCPServerDisplay } from '@/core/lib/toolInputUtils'
import { TOOL_ICON_MAP, LUCIDE_TOOL_NAMES } from './toolIcons'

const DEFAULT_ICON_STYLE: React.CSSProperties = { fontSize: 14 }

/** 从共享 TOOL_ICON_MAP 渲染图标，保持与内联气泡图标一致 */
function renderToolIcon(name: string): ReactNode {
    const Comp = TOOL_ICON_MAP[name]
    if (!Comp) return <ToolOutlined style={DEFAULT_ICON_STYLE} />
    if (LUCIDE_TOOL_NAMES.has(name)) return <Comp size={14} />
    return <Comp style={DEFAULT_ICON_STYLE} />
}

const HIDDEN_TOOL_STUB = { icon: () => null, title: () => '', subtitle: () => null, minimal: () => true as const }

/** 判断是否为 Agent/Task 类工具 */
export function isAgentTool(name: string): boolean {
    return name === 'Task' || name === 'Agent'
}

/** 构建 Agent 工具标题：subagent_type · description */
export function getAgentTitle(input: unknown, fallback = 'Agent'): string {
    if (!isObject(input)) return fallback
    const subagentType = getInputStringAny(input, ['subagent_type'])
    const description = getInputStringAny(input, ['description'])
    if (subagentType && description) return `${subagentType} · ${description}`
    if (description) return description
    if (subagentType) return subagentType
    return fallback
}

/** Agent 工具 subtitle：截断 prompt */
const agentSubtitle = (opts: ToolOpts) => {
    const prompt = getInputStringAny(opts.input, ['prompt'])
    return prompt ? truncate(prompt, 120) : null
}

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
    /** 预览卡片最大高度（px） */
    previewMaxHeight?: number
}

/** 代码/文件操作工具的内联预览最大高度 */
const CODE_PREVIEW_MAX_HEIGHT = 320

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
    const { server, tool } = parseMCPToolName(toolName)!
    const display = formatMCPServerDisplay(server)
    return tool ? `(MCP) ${display}:${tool}` : `(MCP) ${display}`
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
    icon: () => renderToolIcon('Bash'),
    title: (opts: ToolOpts) => opts.description ?? 'Terminal',
    minimal: false
}

// 退出计划模式工具配置（ExitPlanMode / exit_plan_mode 共用）
const exitPlanModeConfig = {
    icon: () => renderToolIcon('ExitPlanMode'),
    title: () => 'Plan proposal',
    minimal: false
}

// 用户提问工具标题生成（AskUserQuestion / ask_user_question / request_user_input 共用）
function askUserQuestionTitle(opts: ToolOpts, titleField: 'header' | 'question' = 'header'): string {
    return joinQuestionHeaders(opts.input, titleField) ?? 'Question'
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
    icon: () => renderToolIcon('AskUserQuestion'),
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
    /** 预览卡片最大高度（px） */
    previewMaxHeight?: number
}> = {
    Task: {
        icon: () => renderToolIcon('Task'),
        title: (opts) => {
            const name = getInputStringAny(opts.input, ['name'])
            const teamName = getInputStringAny(opts.input, ['team_name'])
            if (name && teamName) return `Agent: ${name}`
            return getAgentTitle(opts.input, 'Task')
        },
        subtitle: agentSubtitle,
        minimal: false
    },
    Agent: {
        icon: () => renderToolIcon('Agent'),
        title: (opts) => getAgentTitle(opts.input),
        subtitle: agentSubtitle,
        minimal: false
    },
    TeamCreate: {
        icon: () => renderToolIcon('TeamCreate'),
        title: (opts) => {
            const teamName = getInputStringAny(opts.input, ['team_name'])
            return teamName ? `Team: ${teamName}` : 'Create Team'
        },
        subtitle: (opts) => getInputStringAny(opts.input, ['description']) ?? null,
        minimal: false
    },
    TeamDelete: {
        icon: () => renderToolIcon('TeamDelete'),
        title: () => 'Delete Team',
        minimal: true
    },
    SendMessage: {
        icon: () => renderToolIcon('SendMessage'),
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
        icon: () => renderToolIcon('Glob'),
        title: (opts) => {
            const pattern = getInputStringAny(opts.input, ['pattern'])
            return pattern ? `Glob(${pattern})` : 'Glob'
        },
        minimal: true,
        previewMaxHeight: CODE_PREVIEW_MAX_HEIGHT
    },
    Grep: {
        icon: () => renderToolIcon('Grep'),
        title: (opts) => {
            const pattern = getInputStringAny(opts.input, ['pattern'])
            return pattern ? `Grep(${pattern})` : 'Grep'
        },
        minimal: true
    },
    LS: {
        icon: () => renderToolIcon('LS'),
        title: (opts) => {
            const path = getInputStringAny(opts.input, ['path'])
            return path ? `LS(${resolveDisplayPath(path, opts.metadata)})` : 'LS'
        },
        minimal: true
    },
    shell_command: terminalToolConfig,
    Read: {
        icon: () => renderToolIcon('Read'),
        title: (opts) => {
            const file = getInputStringAny(opts.input, ['file_path', 'path', 'file'])
            if (!file) return 'Read'
            const basePath = resolveDisplayPath(file, opts.metadata)

            const limit = isObject(opts.input) && typeof opts.input.limit === 'number' ? opts.input.limit : null
            const offset = isObject(opts.input) && typeof opts.input.offset === 'number' ? opts.input.offset : null

            let resultLineCount: number | null = null
            if (typeof opts.result === 'string') {
                resultLineCount = opts.result.split('\n').filter(line => line.trim().length > 0).length
            }

            if (offset !== null && resultLineCount !== null) {
                return `Read(${basePath}, L${offset + 1}-${offset + resultLineCount})`
            }
            if (offset !== null && limit !== null) {
                return `Read(${basePath}, L${offset + 1}-${offset + limit})`
            }

            return `Read(${basePath})`
        },
        minimal: true,
        wideDrawer: true,
        previewMaxHeight: CODE_PREVIEW_MAX_HEIGHT
    },
    Edit: {
        icon: () => renderToolIcon('Edit'),
        title: (opts) => {
            const file = getInputStringAny(opts.input, ['file_path', 'path'])
            return file ? `Edit(${resolveDisplayPath(file, opts.metadata)})` : 'Edit'
        },
        minimal: true,
        wideDrawer: true,
        isFilePath: false,
        previewMaxHeight: CODE_PREVIEW_MAX_HEIGHT
    },
    MultiEdit: {
        icon: () => renderToolIcon('MultiEdit'),
        title: (opts) => {
            const file = getInputStringAny(opts.input, ['file_path', 'path'])
            if (!file) return 'MultiEdit'
            const edits = isObject(opts.input) && Array.isArray(opts.input.edits) ? opts.input.edits : null
            const count = edits ? edits.length : 0
            const path = resolveDisplayPath(file, opts.metadata)
            return count > 1 ? `MultiEdit(${path}, ${count} edits)` : `MultiEdit(${path})`
        },
        minimal: true,
        wideDrawer: true,
        isFilePath: false,
        previewMaxHeight: CODE_PREVIEW_MAX_HEIGHT
    },
    Write: {
        icon: () => renderToolIcon('Write'),
        title: (opts) => {
            const file = getInputStringAny(opts.input, ['file_path', 'path'])
            return file ? `Write(${resolveDisplayPath(file, opts.metadata)})` : 'Write'
        },
        subtitle: (opts) => {
            const content = getInputStringAny(opts.input, ['content', 'text'])
            if (!content) return null
            const lines = countLines(content)
            return lines > 1 ? `${lines} lines` : `${content.length} chars`
        },
        minimal: true,
        wideDrawer: true,
        isFilePath: false,
        previewMaxHeight: CODE_PREVIEW_MAX_HEIGHT
    },
    WebFetch: {
        icon: () => renderToolIcon('WebFetch'),
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
        icon: () => renderToolIcon('WebSearch'),
        title: (opts) => getInputStringAny(opts.input, ['query']) ?? 'Web search',
        subtitle: (opts) => {
            const query = getInputStringAny(opts.input, ['query'])
            return query ? truncate(query, 80) : null
        },
        minimal: true
    },
    NotebookRead: {
        icon: () => renderToolIcon('NotebookRead'),
        title: (opts) => {
            const path = getInputStringAny(opts.input, ['notebook_path'])
            return path ? `NotebookRead(${resolveDisplayPath(path, opts.metadata)})` : 'NotebookRead'
        },
        minimal: true,
        wideDrawer: true
    },
    NotebookEdit: {
        icon: () => renderToolIcon('NotebookEdit'),
        title: (opts) => {
            const path = getInputStringAny(opts.input, ['notebook_path'])
            return path ? `NotebookEdit(${resolveDisplayPath(path, opts.metadata)})` : 'NotebookEdit'
        },
        subtitle: (opts) => {
            const mode = getInputStringAny(opts.input, ['edit_mode'])
            return mode ? `mode: ${mode}` : null
        },
        minimal: false
    },
    TodoWrite: {
        icon: () => renderToolIcon('TodoWrite'),
        title: () => 'Todo list',
        subtitle: (opts) => formatChecklistCount(extractTodoChecklist(opts.input, opts.result), 'item'),
        minimal: () => true
    },
    TaskCreate: HIDDEN_TOOL_STUB,
    TaskUpdate: HIDDEN_TOOL_STUB,
    TaskList: { icon: () => renderToolIcon('TaskList'), title: () => 'Task list', subtitle: () => null, minimal: () => true },
    TaskGet: { icon: () => renderToolIcon('TaskGet'), title: () => 'Get task', subtitle: () => null, minimal: () => true },
    TaskOutput: {
        icon: () => renderToolIcon('TaskOutput'),
        title: () => 'Task output',
        subtitle: (opts) => {
            const input = opts.input as { task_id?: string } | undefined
            return input?.task_id ? `#${input.task_id.slice(0, 8)}` : null
        },
        minimal: () => true
    },
    TaskStop: { icon: () => renderToolIcon('TaskStop'), title: () => 'Stop task', subtitle: () => null, minimal: () => true },
    update_plan: {
        icon: () => renderToolIcon('update_plan'),
        title: () => 'Plan',
        subtitle: (opts) => formatChecklistCount(extractUpdatePlanChecklist(opts.input, opts.result), 'step'),
        minimal: (opts) => extractUpdatePlanChecklist(opts.input, opts.result).length === 0
    },
    ExitPlanMode: exitPlanModeConfig,
    exit_plan_mode: exitPlanModeConfig,
    AskUserQuestion: askUserQuestionConfig,
    ask_user_question: askUserQuestionConfig,
    request_user_input: {
        icon: () => renderToolIcon('request_user_input'),
        title: (opts) => askUserQuestionTitle(opts, 'question'),
        subtitle: (opts) => askUserQuestionSubtitle(opts),
        minimal: true
    },
    Skill: {
        icon: () => renderToolIcon('Skill'),
        title: (opts) => {
            const skill = getInputStringAny(opts.input, ['skill'])
            return skill ? `Skill(${skill})` : 'Skill'
        },
        minimal: true
    },
    CronCreate: {
        icon: () => renderToolIcon('CronCreate'),
        title: (opts) => {
            const cron = getInputStringAny(opts.input, ['cron'])
            const prompt = getInputStringAny(opts.input, ['prompt'])
            if (cron && prompt) return `CronCreate(${cron} ${truncate(prompt, 40)})`
            if (cron) return `CronCreate(${cron})`
            return 'CronCreate'
        },
        subtitle: (opts) => {
            const recurring = isObject(opts.input) && opts.input.recurring === true
            return recurring ? 'Recurring' : 'One-shot'
        },
        minimal: true
    },
    CronDelete: {
        icon: () => renderToolIcon('CronDelete'),
        title: (opts) => {
            const id = getInputStringAny(opts.input, ['id'])
            return id ? `CronDelete(${id})` : 'CronDelete'
        },
        minimal: true
    },
    ScheduleWakeup: {
        icon: () => renderToolIcon('ScheduleWakeup'),
        title: (opts) => {
            const delaySeconds = isObject(opts.input) && typeof opts.input.delaySeconds === 'number'
                ? opts.input.delaySeconds as number : null
            const reason = getInputStringAny(opts.input, ['reason'])

            let formattedDelay = ''
            if (delaySeconds !== null) {
                if (delaySeconds >= 60) {
                    const mins = Math.floor(delaySeconds / 60)
                    const secs = Math.round(delaySeconds % 60)
                    formattedDelay = secs > 0 ? `${mins}m ${secs}s` : `${mins}m`
                } else {
                    formattedDelay = `${delaySeconds}s`
                }
            }

            if (formattedDelay && reason) return `ScheduleWakeup(${formattedDelay} ${truncate(reason, 40)})`
            if (formattedDelay) return `ScheduleWakeup(${formattedDelay})`
            return 'ScheduleWakeup'
        },
        minimal: true
    }
}

export function getToolPresentation(opts: Omit<ToolOpts, 'metadata'> & { metadata: SessionMetadataSummary | null }): ToolPresentation {
    if (opts.toolName.startsWith('mcp__')) {
        return {
            icon: <LineSquiggle size={14} />,
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
            isFilePath: known.isFilePath ?? false,
            previewMaxHeight: known.previewMaxHeight
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
