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

import type { ToolViewComponent, ToolViewProps } from '@/components/ToolCard/views/_all'
import { isObject, safeStringify } from '@mobi/shared'
import { theme as antTheme, Typography } from 'antd'
import { ChecklistList, extractTodoChecklist } from '@/components/ToolCard/checklist'
import { basename, resolveDisplayPath } from '@/utils/path'

import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

import type { ToolPermission } from '../types'

import type { SessionMetadataSummary } from '@/api/types'

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
function extractTextFromResult(result: unknown, depth: number = 0): string | null {
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
        return <MarkdownContent content={text} />
    }
    // auto 模式：优先尝试 JSON 解析（含多层 unwrap），再降级 HTML/markdown
    const jsonResult = tryParseJson(text)
    if (jsonResult) {
        return <CodeBlock code={JSON.stringify(jsonResult.parsed, null, 2)} language="json" />
    }
    if (looksLikeHtml(text)) {
        return <CodeBlock code={text} language="html" />
    }
    return <MarkdownContent content={text} />
}
function placeholderForState(state: ToolViewProps['block']['tool']['state']): string {
    if (state === 'pending') return 'Waiting for permission…';
    if (state === 'running') return 'Running...'
    return '(no output)'
}
function RawJsonDevOnly(props: { value: unknown }) {
    const { token } = useToken()
    if (!import.meta.env.DEV) return null
    if (props.value === null || props.value === undefined) return null
    return (
        <details style={{ marginTop: 12 }}>
            <summary style={{ cursor: 'pointer', fontSize: 11, fontWeight: 500, color: token.colorTextSecondary }}>
                Raw JSON
            </summary>
            <div style={{ marginTop: 8 }}>
                <CodeBlock code={safeStringify(props.value)} language="json" />
            </div>
        </details>
    )
}
function extractStdoutStderr(result: unknown): { stdout: string | null; stderr: string | null } | null {
    if (!isObject(result)) return null
    const stdout = typeof result.stdout === 'string' ? result.stdout : null
    const stderr = typeof result.stderr === 'string' ? result.stderr : null
    if (stdout !== null || stderr !== null) {
        return { stdout, stderr }
    }
    const nested = isObject(result.output) ? result.output : null
    if (nested) {
        const nestedStdout = typeof nested.stdout === 'string' ? nested.stdout : null
        const nestedStderr = typeof nested.stderr === 'string' ? nested.stderr : null
        if (nestedStdout !== null || nestedStderr !== null) {
            return { stdout: nestedStdout, stderr: nestedStderr }
        }
    }
    return null
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
// Markdown 内容渲染
function MarkdownContent(props: { content: string }) {
    return (
        <div className="x-markdown" style={{ maxWidth: '100%' }}>
            <ReactMarkdown remarkPlugins={[remarkGfm]}>
                {props.content || ''}
            </ReactMarkdown>
        </div>
    )
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
            overflowX: 'auto',
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
const BashResultView: ToolViewComponent = (props: ToolViewProps) => {
    const { token } = useToken()
    const result = props.block.tool.result
    if (result === undefined || result === null) {
        return <div style={{ fontSize: 13, color: token.colorTextTertiary }}>{placeholderForState(props.block.tool.state)}</div>
    }
    if (typeof result === 'string') {
        const toolUseError = parseToolUseError(result)
        const display = toolUseError.isToolUseError ? (toolUseError.errorMessage ?? '') : result
        return (
            <>
                <CodeBlock code={display} language="text" />
                <RawJsonDevOnly value={result} />
            </>
        )
    }
    const stdio = extractStdoutStderr(result)
    if (stdio) {
        return (
            <>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {stdio.stdout ? <CodeBlock code={stdio.stdout} language="text" /> : null}
                    {stdio.stderr ? <CodeBlock code={stdio.stderr} language="text" /> : null}
                </div>
                <RawJsonDevOnly value={result} />
            </>
        )
    }
    const text = extractTextFromResult(result)
    if (text) {
        return (
            <>
                {renderText(text, { mode: 'code', language: 'text' })}
                <RawJsonDevOnly value={result} />
            </>
        )
    }
    return (
        <>
            <div style={{ fontSize: 13, color: token.colorTextTertiary }}>(no output)</div>
            <RawJsonDevOnly value={result} />
        </>
    )
}
const MarkdownResultView: ToolViewComponent = (props: ToolViewProps) => {
    const { token } = useToken()
    const result = props.block.tool.result
    if (result === undefined || result === null) {
        return <div style={{ fontSize: 13, color: token.colorTextTertiary }}>{placeholderForState(props.block.tool.state)}</div>
    }
    const text = extractTextFromResult(result)
    if (text) {
        return (
            <>
                {renderText(text, { mode: 'auto' })}
                <RawJsonDevOnly value={result} />
            </>
        )
    }
    return (
        <>
            <div style={{ fontSize: 13, color: token.colorTextTertiary }}>(no output)</div>
            <RawJsonDevOnly value={result} />
        </>
    )
}
const LineListResultView: ToolViewComponent = (props: ToolViewProps) => {
    const { token } = useToken()
    const result = props.block.tool.result
    if (result === undefined || result === null) {
        return <div style={{ fontSize: 13, color: token.colorTextTertiary }}>{placeholderForState(props.block.tool.state)}</div>
    }
    const text = extractTextFromResult(result)
    if (!text) {
        return (
            <>
                <div style={{ fontSize: 13, color: token.colorTextTertiary }}>(no output)</div>
                <RawJsonDevOnly value={result} />
            </>
        )
    }
    if (isProbablyMarkdownList(text)) {
        return (
            <>
                <MarkdownContent content={text} />
                <RawJsonDevOnly value={result} />
            </>
        )
    }
    const lines = extractLineList(text)
    if (lines.length === 0) {
        return (
            <>
                <div style={{ fontSize: 13, color: token.colorTextTertiary }}>(no output)</div>
                <RawJsonDevOnly value={result} />
            </>
        )
    }
    return (
        <>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {lines.map((line) => (
                    <div key={line} style={{ fontSize: 13, fontFamily: 'var(--font-mono)', color: token.colorText, wordBreak: 'break-all' }}>
                        {line}
                    </div>
                ))}
            </div>
            <RawJsonDevOnly value={result} />
        </>
    )
}
const ReadResultView: ToolViewComponent = (props: ToolViewProps) => {
    const { token } = useToken()
    const result = props.block.tool.result
    if (result === undefined || result === null) {
        return <div style={{ fontSize: 13, color: token.colorTextTertiary }}>{placeholderForState(props.block.tool.state)}</div>
    }
    const file = extractReadFileContent(result)
    if (file) {
        const path = file.filePath ? resolveDisplayPath(file.filePath, props.metadata) : null
        return (
            <>
                {path ? (
                    <div style={{ marginBottom: 8, fontSize: 11, color: token.colorTextTertiary, fontFamily: 'var(--font-mono)', wordBreak: 'break-all' }}>
                        {basename(path)}
                    </div>
                ) : null}
                <CodeBlock code={file.content} language="text" />
                <RawJsonDevOnly value={result} />
            </>
        )
    }
    const text = extractTextFromResult(result)
    if (text) {
        return (
            <>
                {renderText(text, { mode: 'code', language: 'text' })}
                <RawJsonDevOnly value={result} />
            </>
        )
    }
    return (
        <>
            <div style={{ fontSize: 13, color: token.colorTextTertiary }}>(no output)</div>
            <RawJsonDevOnly value={result} />
        </>
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
            <>
                <div style={{ fontSize: 13, color }}>
                    {renderText(text, { mode: state === 'error' ? 'code' : 'auto' })}
                </div>
                <RawJsonDevOnly value={result} />
            </>
        )
    }
    return (
        <>
            <div style={{ fontSize: 13, color: token.colorTextTertiary }}>
                {state === 'completed' ? 'Done' : '(no output)'}
            </div>
            <RawJsonDevOnly value={result} />
        </>
    )
}
const TodoWriteResultView: ToolViewComponent = (props: ToolViewProps) => {
    const { token } = useToken()
    const todos = extractTodoChecklist(props.block.tool.input, props.block.tool.result)
    if (todos.length === 0) {
        return <div style={{ fontSize: 13, color: token.colorTextTertiary }}>{placeholderForState(props.block.tool.state)}</div>
    }
    return <ChecklistList items={todos} />
}
const GenericResultView: ToolViewComponent = (props: ToolViewProps) => {
    const { token } = useToken()
    const result = props.block.tool.result
    if (result === undefined || result === null) {
        return <div style={{ fontSize: 13, color: token.colorTextTertiary }}>{placeholderForState(props.block.tool.state)}</div>
    }
    const text = extractTextFromResult(result)
    if (text) {
        return (
            <>
                {renderText(text, { mode: 'auto' })}
                {typeof result === 'object' ? <RawJsonDevOnly value={result} /> : null}
            </>
        )
    }
    if (typeof result === 'string') {
        return renderText(result, { mode: 'auto' })
    }
    return <CodeBlock code={safeStringify(result)} language="json" />
}
export const toolResultViewRegistry: Record<string, ToolViewComponent> = {
    Task: MarkdownResultView,
    Bash: BashResultView,
    Glob: LineListResultView,
    Grep: LineListResultView,
    LS: LineListResultView,
    Read: ReadResultView,
    Edit: MutationResultView,
    MultiEdit: MutationResultView,
    Write: MutationResultView,
    WebFetch: MarkdownResultView,
    WebSearch: MarkdownResultView,
    NotebookRead: ReadResultView,
    NotebookEdit: MutationResultView,
    TodoWrite: TodoWriteResultView,
    AskUserQuestion: AskUserQuestionResultView,
    ExitPlanMode: MarkdownResultView,
    ask_user_question: AskUserQuestionResultView,
    exit_plan_mode: MarkdownResultView
}
export function getToolResultViewComponent(toolName: string): ToolViewComponent {
    if (toolName.startsWith('mcp__')) {
        return GenericResultView
    }
    return toolResultViewRegistry[toolName] ?? GenericResultView
}
