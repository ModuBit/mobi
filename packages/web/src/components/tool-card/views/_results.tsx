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

import type { ToolViewComponent, ToolViewProps } from '@/components/tool-card/views/_all'
import { useMemo } from 'react'
import { BashView } from '@/components/tool-card/views/BashView'
import { GlobView } from '@/components/tool-card/views/GlobView'
import { isObject, safeStringify } from '@mobi/shared'
import { getInputStringAny } from '@/core/lib/toolInputUtils'
import { theme as antTheme, Typography } from 'antd'
import { formatLineRangeStats } from '@/components/tool-card/views/lineNumberUtils'
import { basename, resolveDisplayPath } from '@/core/utils/path'
import { Markdown } from '@/components/ui/Markdown'
import { DiffView } from '@/components/tool-card/views/DiffView'
import { ToolViewPanel } from '@/components/tool-card/views/ToolViewPanel'

import type { ToolPermission } from '@/domain/tool/types'

import type { SessionMetadataSummary } from '@/core/data/api/types'

const { Text } = Typography
const { useToken } = antTheme

function parseToolUseError(message: string): { isToolUseError: boolean; errorMessage: string | null } {
    const regex = /<tool_use_error>(.*?)<\/tool_use_error>/s
    const match = message.match(regex)

    if (match) {
        return {
            isToolUseError: true,
            errorMessage: typeof match[1] === 'string' ? match[1].trim() : ''
        }
    }
    return { isToolUseError: false, errorMessage: null }
}
function extractTextFromContentBlock(block: unknown): string | null {
    if (typeof block === 'string') return block
    if (!isObject(block)) return null
    if (block.type === 'text' && typeof block.text === 'string') return block.text
    if (typeof block.text === 'string') return block.text
    return null
}
export function extractTextFromResult(result: unknown, depth: number = 0): string | null {
    if (depth > 2) return null
    if (result === null || result === undefined) return null
    if (typeof result === 'string') {
        const toolUseError = parseToolUseError(result)
        return toolUseError.isToolUseError ? (toolUseError.errorMessage ?? '') : result
    }
    if (Array.isArray(result)) {
        const parts = result
            .map(extractTextFromContentBlock)
            .filter((part): part is string => part !== null && part.length > 0)
        return parts.length > 0 ? parts.join('\n') : null
    }
    if (!isObject(result)) return null
    if (typeof result.content === 'string') return result.content
    if (typeof result.text === 'string') return result.text
    if (typeof result.output === 'string') return result.output
    if (typeof result.error === 'string') return result.error
    if (typeof result.message === 'string') return result.message
    const contentArray = Array.isArray(result.content) ? result.content : null
    if (contentArray) {
        const parts = contentArray
            .map(extractTextFromContentBlock)
            .filter((part): part is string => part !== null && part.length > 0)
        return parts.length > 0 ? parts.join('\n') : null
    }
    const nestedOutput = isObject(result.output) ? result.output : null
    if (nestedOutput) {
        if (typeof nestedOutput.content === 'string') return nestedOutput.content
        if (typeof nestedOutput.text === 'string') return nestedOutput.text
    }
    const nestedError = isObject(result.error) ? result.error : null
    if (nestedError) {
        if (typeof nestedError.message === 'string') return nestedError.message
        if (typeof nestedError.error === 'string') return nestedError.error
    }
    const nestedResult = isObject(result.result) ? result.result : null
    if (nestedResult) {
        const nestedText = extractTextFromResult(nestedResult, depth + 1)
        if (nestedText) return nestedText
    }
    const nestedData = isObject(result.data) ? result.data : null
    if (nestedData) {
        const nestedText = extractTextFromResult(nestedData, depth + 1)
        if (nestedText) return nestedText
    }
    return null
}
function looksLikeHtml(text: string): boolean {
    const trimmed = text.trimStart()
    return trimmed.startsWith('<!DOCTYPE') || trimmed.startsWith('<html') || trimmed.startsWith('<div') || trimmed.startsWith('<span')
}
function looksLikeJson(text: string): boolean {
    const trimmed = text.trim()
    return (trimmed.startsWith('{') && trimmed.endsWith('}')) || (trimmed.startsWith('[') && trimmed.endsWith(']'))
}
// 递归解析多层编码的 JSON（如 JSON 字符串内嵌 JSON 字符串）
// 最多 unwrap 3 层，防止死循环
function tryParseJson(text: string, maxDepth = 3): { parsed: unknown; depth: number } | null {
    try {
        let parsed: unknown = JSON.parse(text)
        let depth = 1
        while (typeof parsed === 'string' && depth < maxDepth) {
            try {
                parsed = JSON.parse(parsed)
                depth++
            } catch {
                break
            }
        }
        // 只有最终结果不是原始字符串才算成功
        if (typeof parsed === 'string') return null
        return { parsed, depth }
    } catch {
        return null
    }
}

function renderText(text: string, opts: { mode: 'markdown' | 'code' | 'auto'; language?: string } = { mode: 'auto' }) {
    const { token } = useToken()
    if (opts.mode === 'code') {
        return <CodeBlock code={text} language={opts.language ?? 'text'} />
    }
    if (opts.mode === 'markdown') {
        return <Markdown content={text} />
    }
    // auto 模式：优先尝试 JSON 解析（含多层 unwrap），再降级 HTML/markdown
    const jsonResult = tryParseJson(text)
    if (jsonResult) {
        return <CodeBlock code={JSON.stringify(jsonResult.parsed, null, 2)} language="json" />
    }
    if (looksLikeHtml(text)) {
        return <CodeBlock code={text} language="html" />
    }
    return <Markdown content={text} />
}
export function placeholderForState(state: ToolViewProps['block']['tool']['state']): string {
    if (state === 'pending') return 'Waiting for permission…';
    if (state === 'running') return 'Running...'
    return '(no output)'
}

/** 无结果时的占位组件 */
function ResultPlaceholder({ state }: { state: ToolViewProps['block']['tool']['state'] }) {
    const { token } = useToken()
    return <div style={{ fontSize: 13, color: token.colorTextTertiary }}>{placeholderForState(state)}</div>
}

function extractReadFileContent(result: unknown): { filePath: string | null; content: string } | null {
    if (!isObject(result)) return null
    const file = isObject(result.file) ? result.file : null
    if (!file) return null
    const content = typeof file.content === 'string' ? file.content : null
    if (content === null) return null
    const filePath = typeof file.filePath === 'string'
        ? file.filePath
        : typeof file.file_path === 'string'
            ? file.file_path
            : null
    return { filePath, content }
}
function extractLineList(text: string): string[] {
    return text
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line.length > 0)
}
function isProbablyMarkdownList(text: string): boolean {
    const trimmed = text.trimStart()
    return trimmed.startsWith('- ') || trimmed.startsWith('* ') || trimmed.startsWith('1. ')
}
// 代码块组件
function CodeBlock(props: { code: string; language?: string }) {
    const { token } = useToken()
    return (
        <pre style={{
            background: token.colorBgContainer,
            padding: 8,
            borderRadius: 4,
            fontSize: 12,
            overflowX: 'hidden',
            margin: '4px 0',
            border: `1px solid ${token.colorBorder}`,
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word'
        }}>
            {props.code}
        </pre>
    )
}
const AskUserQuestionResultView: ToolViewComponent = (props: ToolViewProps) => {
    const answers = props.block.tool.permission?.answers ?? null
    // If answers exist, AskUserQuestionView already shows them with highlighting
    // Return null to avoid duplicate display
    if (answers && Object.keys(answers).length > 0) {
        return null
    }
    // Fallback for tools without structured answers
    return <MarkdownResultView {...props} />
}
const MarkdownResultView: ToolViewComponent = (props: ToolViewProps) => {
    const { token } = useToken()
    const result = props.block.tool.result
    if (result === undefined || result === null) {
        return <div style={{ fontSize: 13, color: token.colorTextTertiary }}>{placeholderForState(props.block.tool.state)}</div>
    }
    const text = extractTextFromResult(result)
    if (text) {
        return renderText(text, { mode: 'auto' })
    }
    return <div style={{ fontSize: 13, color: token.colorTextTertiary }}>(no output)</div>
}
const LineListResultView: ToolViewComponent = (props: ToolViewProps) => {
    const { token } = useToken()
    const result = props.block.tool.result
    if (result === undefined || result === null) {
        return <div style={{ fontSize: 13, color: token.colorTextTertiary }}>{placeholderForState(props.block.tool.state)}</div>
    }
    const text = extractTextFromResult(result)
    if (!text) {
        return <div style={{ fontSize: 13, color: token.colorTextTertiary }}>(no output)</div>
    }
    if (isProbablyMarkdownList(text)) {
        return <Markdown content={text} />
    }
    const lines = extractLineList(text)
    if (lines.length === 0) {
        return <div style={{ fontSize: 13, color: token.colorTextTertiary }}>(no output)</div>
    }
    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {lines.map((line) => (
                <div key={line} style={{ fontSize: 13, fontFamily: 'var(--font-mono)', color: token.colorText, wordBreak: 'break-all' }}>
                    {line}
                </div>
            ))}
        </div>
    )
}
const ReadResultView: ToolViewComponent = (props: ToolViewProps) => {
    const { token } = useToken()
    const { input, result } = props.block.tool

    const filePath = useMemo(() => {
        const raw = getInputStringAny(input, ['file_path', 'path', 'file'])
        return raw ? resolveDisplayPath(raw, props.metadata) : null
    }, [input, props.metadata])

    const content = useMemo(() => {
        if (result === undefined || result === null) return null
        const file = extractReadFileContent(result)
        return file ? file.content : extractTextFromResult(result)
    }, [result])

    const statsLabel = useMemo(() => {
        if (!content) return null
        const offset = isObject(input) && typeof input.offset === 'number' ? input.offset : null
        const lineCount = content.split('\n').filter(l => l.trim().length > 0).length
        return formatLineRangeStats(offset, lineCount)
    }, [input, content])

    if (result === undefined || result === null) {
        return <div style={{ fontSize: 13, color: token.colorTextTertiary }}>{placeholderForState(props.block.tool.state)}</div>
    }

    if (!content) {
        return <div style={{ fontSize: 13, color: token.colorTextTertiary }}>(no output)</div>
    }

    return (
        <ToolViewPanel
            header={filePath ? (
                <>
                    <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {filePath}
                    </div>
                    <div style={{
                        fontSize: 11,
                        color: token.colorTextTertiary,
                        fontFamily: 'var(--font-mono)',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                    }}>
                        {statsLabel}
                    </div>
                </>
            ) : undefined}
        >
            <div style={{
                padding: '4px 10px',
                fontFamily: 'var(--font-mono)',
                fontSize: 12,
                lineHeight: 1.5,
                whiteSpace: 'pre',
                overflowX: 'auto',
            }}>
                {content}
            </div>
        </ToolViewPanel>
    )
}
const MutationResultView: ToolViewComponent = (props: ToolViewProps) => {
    const { token } = useToken()
    const { state, result } = props.block.tool
    if (result === undefined || result === null) {
        if (state === 'completed') {
            return <div style={{ fontSize: 13, color: token.colorTextTertiary }}>Done</div>
        }
        return <div style={{ fontSize: 13, color: token.colorTextTertiary }}>{placeholderForState(state)}</div>
    }
    const text = extractTextFromResult(result)
    if (typeof text === 'string' && text.trim().length > 0) {
        const color = state === 'error' ? token.colorError : token.colorText
        return (
            <div style={{ fontSize: 13, color }}>
                {renderText(text, { mode: state === 'error' ? 'code' : 'auto' })}
            </div>
        )
    }
    return (
        <div style={{ fontSize: 13, color: token.colorTextTertiary }}>
            {state === 'completed' ? 'Done' : '(no output)'}
        </div>
    )
}

/** Edit 工具结果视图 - 显示 diff */
const EditResultView: ToolViewComponent = (props: ToolViewProps) => {
    const input = props.block.tool.input
    const { state, result } = props.block.tool

    // 执行中或无结果时显示占位
    if (result === undefined || result === null) {
        return <ResultPlaceholder state={state} />
    }

    // 从 input 提取 diff 内容
    if (!isObject(input)) {
        return <MutationResultView {...props} />
    }

    const filePath = typeof input.file_path === 'string' ? input.file_path : null
    const oldString = typeof input.old_string === 'string' ? input.old_string : null
    const newString = typeof input.new_string === 'string' ? input.new_string : null

    if (oldString === null || newString === null) {
        return <MutationResultView {...props} />
    }

    return (
        <DiffView
            oldString={oldString}
            newString={newString}
            filePath={filePath ?? undefined}
            variant="inline"
            statsType="edit"
        />
    )
}

/** Write 工具结果视图 - 显示写入内容 */
const WriteResultView: ToolViewComponent = (props: ToolViewProps) => {
    const input = props.block.tool.input
    const { state, result } = props.block.tool

    if (result === undefined || result === null) {
        return <ResultPlaceholder state={state} />
    }

    if (!isObject(input)) {
        return <MutationResultView {...props} />
    }

    const filePath = typeof input.file_path === 'string' ? input.file_path : null
    const content = typeof input.content === 'string' ? input.content : typeof input.text === 'string' ? input.text : null

    if (content === null) {
        return <MutationResultView {...props} />
    }

    return (
        <DiffView
            oldString=""
            newString={content}
            filePath={filePath ?? undefined}
            variant="inline"
            statsType="write"
        />
    )
}

/** MultiEdit 工具结果视图 - 显示多个 diff */
const MultiEditResultView: ToolViewComponent = (props: ToolViewProps) => {
    const input = props.block.tool.input
    const { state, result } = props.block.tool

    if (result === undefined || result === null) {
        return <ResultPlaceholder state={state} />
    }

    if (!isObject(input)) {
        return <MutationResultView {...props} />
    }

    const filePath = typeof input.file_path === 'string' ? input.file_path : null
    const edits = Array.isArray(input.edits) ? input.edits : null

    if (!edits || edits.length === 0) {
        return <MutationResultView {...props} />
    }

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {edits.map((edit: unknown, idx: number) => {
                if (!isObject(edit)) return null
                const oldString = typeof edit.old_string === 'string' ? edit.old_string : null
                const newString = typeof edit.new_string === 'string' ? edit.new_string : null
                if (oldString === null || newString === null) return null
                return (
                    <DiffView
                        key={idx}
                        oldString={oldString}
                        newString={newString}
                        filePath={idx === 0 ? filePath ?? undefined : undefined}
                        variant="inline"
                        statsType="edit"
                    />
                )
            })}
        </div>
    )
}
const GenericResultView: ToolViewComponent = (props: ToolViewProps) => {
    const { token } = useToken()
    const result = props.block.tool.result
    if (result === undefined || result === null) {
        return <div style={{ fontSize: 13, color: token.colorTextTertiary }}>{placeholderForState(props.block.tool.state)}</div>
    }
    const text = extractTextFromResult(result)
    if (text) {
        return renderText(text, { mode: 'auto' })
    }
    if (typeof result === 'string') {
        return renderText(result, { mode: 'auto' })
    }
    return <CodeBlock code={safeStringify(result)} language="json" />
}
/** Task 工具结果视图：保留换行的纯文本 */
const TaskTextView: ToolViewComponent = (props: ToolViewProps) => {
    const { token } = useToken()
    const text = extractTextFromResult(props.block.tool.result)
    if (!text) {
        return <div style={{ fontSize: 13, color: token.colorTextTertiary }}>{placeholderForState(props.block.tool.state)}</div>
    }
    return (
        <div style={{ whiteSpace: 'pre-line', fontSize: 13, color: token.colorTextTertiary, lineHeight: 1.6 }}>
            {text}
        </div>
    )
}
export const toolResultViewRegistry: Record<string, ToolViewComponent> = {
    Task: MarkdownResultView,
    Agent: MarkdownResultView,
    Bash: BashView,
    shell_command: BashView,
    Glob: GlobView,
    Grep: LineListResultView,
    LS: LineListResultView,
    Read: ReadResultView,
    Edit: EditResultView,
    MultiEdit: MultiEditResultView,
    Write: WriteResultView,
    WebFetch: MarkdownResultView,
    WebSearch: MarkdownResultView,
    NotebookRead: ReadResultView,
    NotebookEdit: MutationResultView,
    AskUserQuestion: AskUserQuestionResultView,
    ExitPlanMode: MarkdownResultView,
    ask_user_question: AskUserQuestionResultView,
    exit_plan_mode: MarkdownResultView,
    TaskList: TaskTextView,
    TaskGet: TaskTextView,
}
export function getToolResultViewComponent(toolName: string): ToolViewComponent {
    if (toolName.startsWith('mcp__')) {
        return GenericResultView
    }
    return toolResultViewRegistry[toolName] ?? GenericResultView
}
