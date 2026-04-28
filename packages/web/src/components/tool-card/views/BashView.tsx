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

import { useMemo } from 'react'
import { theme as antTheme, Typography } from 'antd'
import hljs from 'highlight.js/lib/core'
import bash from 'highlight.js/lib/languages/bash'
import type { ToolViewProps } from '@/components/tool-card/views/_all'
import { isObject } from '@mobi/shared'
import { getInputStringAny } from '@/core/lib/toolInputUtils'

// 注册 bash 语言
hljs.registerLanguage('bash', bash)

const { useToken } = antTheme
const { Text } = Typography

/** 从 result 中提取输出文本 */
function extractOutputText(result: unknown): string | null {
    if (result === null || result === undefined) return null
    if (typeof result === 'string') {
        // 解析 tool_use_error 标签
        const match = result.match(/<tool_use_error>(.*?)<\/tool_use_error>/s)
        if (match) return match[1]?.trim() ?? ''
        return result
    }
    if (!isObject(result)) return null

    // 提取 stdout/stderr
    const stdout = typeof result.stdout === 'string' ? result.stdout : null
    const stderr = typeof result.stderr === 'string' ? result.stderr : null
    if (stdout !== null || stderr !== null) {
        const parts: string[] = []
        if (stdout) parts.push(stdout)
        if (stderr) parts.push(stderr)
        return parts.join('\n')
    }

    // 其他文本字段
    if (typeof result.content === 'string') return result.content
    if (typeof result.text === 'string') return result.text
    if (typeof result.output === 'string') return result.output
    if (typeof result.error === 'string') return result.error
    if (typeof result.message === 'string') return result.message

    return null
}

/** 判断是否为错误结果 */
function isErrorResult(result: unknown): boolean {
    if (!isObject(result)) return false
    if (result.is_error === true) return true
    if (typeof result.exit_code === 'number' && result.exit_code !== 0) return true
    if (result.error !== undefined && result.error !== null) return true
    return false
}

/** 命令行组件（使用 highlight.js 高亮） */
function CommandBlock({ command }: { command: string }) {
    const { token } = useToken()

    // highlight.js 输出为安全的 HTML span 元素，不包含用户可控的脚本
    const highlighted = useMemo(() => {
        try {
            return hljs.highlight(command, { language: 'bash' }).value
        } catch {
            return command
        }
    }, [command])

    return (
        <div
            style={{
                fontFamily: 'var(--font-mono)',
                fontSize: 12,
                lineHeight: 1.6,
                padding: '6px 10px',
                background: token.colorBgLayout,
                borderRadius: 4,
                border: `1px solid ${token.colorBorder}`,
                marginBottom: 8,
                overflow: 'auto',
            }}
        >
            <span style={{ color: token.colorPrimary }}>$ </span>
            <span dangerouslySetInnerHTML={{ __html: highlighted }} />
        </div>
    )
}

/** 输出结果组件 */
function OutputBlock({ output, isError }: { output: string; isError: boolean }) {
    const { token } = useToken()

    return (
        <div
            style={{
                fontFamily: 'var(--font-mono)',
                fontSize: 12,
                lineHeight: 1.5,
                padding: '6px 10px',
                background: isError ? token.colorErrorBg : token.colorBgContainer,
                borderRadius: 4,
                border: `1px solid ${isError ? token.colorErrorBorder : token.colorBorder}`,
                color: isError ? token.colorError : token.colorText,
                overflow: 'auto',
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
            }}
        >
            {output}
        </div>
    )
}

/** 状态文本样式 */
const STATUS_TEXT_STYLE = { fontSize: 12 } as const

/** 容器样式 */
const CONTAINER_STYLE = { display: 'flex', flexDirection: 'column', gap: 0 } as const

/**
 * Bash 工具视图
 * 先展示命令，再展示执行结果
 */
export function BashView(props: ToolViewProps) {
    const { input, result, state } = props.block.tool

    // 复用 getInputStringAny 提取命令
    const command = typeof input === 'string' ? input : getInputStringAny(input, ['command', 'cmd'])

    // 处理 pending 和 running 状态
    if (state === 'pending') {
        return (
            <div style={CONTAINER_STYLE}>
                {command && <CommandBlock command={command} />}
                <Text type="secondary" style={STATUS_TEXT_STYLE}>Waiting for permission…</Text>
            </div>
        )
    }

    if (state === 'running') {
        return (
            <div style={CONTAINER_STYLE}>
                {command && <CommandBlock command={command} />}
                <Text type="secondary" style={STATUS_TEXT_STYLE}>Running…</Text>
            </div>
        )
    }

    // 完成状态
    const output = extractOutputText(result)
    const isError = isErrorResult(result) || state === 'error'

    return (
        <div style={CONTAINER_STYLE}>
            {command && <CommandBlock command={command} />}
            {output
                ? <OutputBlock output={output} isError={isError} />
                : <Text type="secondary" style={STATUS_TEXT_STYLE}>(no output)</Text>
            }
        </div>
    )
}
