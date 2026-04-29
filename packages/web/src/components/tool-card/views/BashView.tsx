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
import { OverflowContainer } from '@/components/ui/OverflowContainer'

hljs.registerLanguage('bash', bash)

const { useToken } = antTheme
const { Text } = Typography

/** 从 result 中提取输出文本 */
function extractOutputText(result: unknown): string | null {
    if (result === null || result === undefined) return null
    if (typeof result === 'string') {
        const match = result.match(/<tool_use_error>(.*?)<\/tool_use_error>/s)
        if (match) return match[1]?.trim() ?? ''
        return result
    }
    if (!isObject(result)) return null

    const stdout = typeof result.stdout === 'string' ? result.stdout : null
    const stderr = typeof result.stderr === 'string' ? result.stderr : null
    if (stdout !== null || stderr !== null) {
        const parts: string[] = []
        if (stdout) parts.push(stdout)
        if (stderr) parts.push(stderr)
        return parts.join('\n')
    }
    if (typeof result.content === 'string') return result.content
    if (typeof result.text === 'string') return result.text
    if (typeof result.output === 'string') return result.output
    if (typeof result.error === 'string') return result.error
    if (typeof result.message === 'string') return result.message
    return null
}

function isErrorResult(result: unknown): boolean {
    if (!isObject(result)) return false
    if (result.is_error === true) return true
    if (typeof result.exit_code === 'number' && result.exit_code !== 0) return true
    if (result.error !== undefined && result.error !== null) return true
    return false
}

/** 状态占位文本 */
function statusText(state: string): string {
    if (state === 'pending') return 'Waiting for permission…'
    if (state === 'running') return 'Running…'
    return '(no output)'
}

/**
 * Bash 工具视图（DiffView 风格）
 * command 作为 header 栏，output 作为 body
 */
export function BashView(props: ToolViewProps) {
    const { token } = useToken()
    const { input, result, state } = props.block.tool

    const command = typeof input === 'string' ? input : getInputStringAny(input, ['command', 'cmd'])
    const isFinished = state === 'completed' || state === 'error'
    const output = isFinished ? extractOutputText(result) : null
    const isError = isFinished && (isErrorResult(result) || state === 'error')

    const displayText = command || props.block.tool.description || statusText(state)

    const highlighted = useMemo(() => {
        if (!displayText) return ''
        try {
            return hljs.highlight(displayText, { language: 'bash' }).value
        } catch {
            return displayText
        }
    }, [displayText])

    return (
        <div style={{
            overflow: 'hidden',
            borderRadius: 4,
            border: `1px solid ${token.colorBorder}`,
            background: token.colorBgContainer,
        }}>
            {/* header: command */}
            {displayText && (
                <div style={{
                    borderBottom: `1px solid ${token.colorBorder}`,
                    background: token.colorBgLayout,
                    padding: '4px 10px',
                    fontFamily: 'var(--font-mono)',
                    fontSize: 12,
                    lineHeight: 1.6,
                    overflow: 'auto',
                }}>
                    <span style={{ color: token.colorPrimary }}>$ </span>
                    <span dangerouslySetInnerHTML={{ __html: highlighted }} />
                </div>
            )}

            {/* body: output */}
            {output ? (
                <OverflowContainer
                    maxHeight={200}
                    style={{
                        padding: '4px 10px',
                        fontFamily: 'var(--font-mono)',
                        fontSize: 12,
                        lineHeight: 1.5,
                        color: isError ? token.colorError : token.colorText,
                        background: isError ? token.colorErrorBg : 'transparent',
                        whiteSpace: 'pre-wrap',
                        wordBreak: 'break-word',
                    }}
                >
                    {output}
                </OverflowContainer>
            ) : (
                <div style={{
                    padding: '6px 10px',
                    fontSize: 12,
                    color: token.colorTextTertiary,
                }}>
                    {statusText(state)}
                </div>
            )}
        </div>
    )
}
