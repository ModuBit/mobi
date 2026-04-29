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
import { theme as antTheme } from 'antd'
import hljs from 'highlight.js/lib/core'
import bash from 'highlight.js/lib/languages/bash'
import type { ToolViewProps } from '@/components/tool-card/views/_all'
import { isObject } from '@mobi/shared'
import { getInputStringAny } from '@/core/lib/toolInputUtils'
import { OverflowContainer } from '@/components/ui/OverflowContainer'
import { extractTextFromResult, placeholderForState } from './_results'

hljs.registerLanguage('bash', bash)

const { useToken } = antTheme

function isErrorResult(result: unknown): boolean {
    if (!isObject(result)) return false
    if (result.is_error === true) return true
    if (typeof result.exit_code === 'number' && result.exit_code !== 0) return true
    if (result.error !== undefined && result.error !== null) return true
    return false
}

/** header 栏样式（command 高亮展示） */
const HEADER_STYLE = {
    borderBottom: '1px solid var(--border-color)',
    background: 'var(--bg-layout)',
    padding: '4px 10px',
    fontFamily: 'var(--font-mono)',
    fontSize: 12,
    lineHeight: 1.6,
    overflow: 'auto',
} as const

/**
 * Bash 工具视图（DiffView 风格）
 * command 作为 header 栏，output 作为 body
 */
export function BashView(props: ToolViewProps) {
    const { token } = useToken()
    const { input, result, state } = props.block.tool

    const command = typeof input === 'string' ? input : getInputStringAny(input, ['command', 'cmd'])
    const isFinished = state === 'completed' || state === 'error'
    const output = isFinished ? extractTextFromResult(result) : null
    const isError = isFinished && (isErrorResult(result) || state === 'error')

    // 仅对 command 做语法高亮，description/fallback 不需要
    const highlighted = useMemo(() => {
        if (!command) return ''
        try {
            return hljs.highlight(command, { language: 'bash' }).value
        } catch {
            return command
        }
    }, [command])

    const headerText = command || props.block.tool.description

    return (
        <div style={{
            overflow: 'hidden',
            borderRadius: 4,
            border: `1px solid ${token.colorBorder}`,
            background: token.colorBgContainer,
        }}>
            {headerText && (
                <div style={{
                    ...HEADER_STYLE,
                    borderBottom: `1px solid ${token.colorBorder}`,
                    background: token.colorBgLayout,
                }}>
                    <span style={{ color: token.colorPrimary }}>$ </span>
                    {command
                        ? <span dangerouslySetInnerHTML={{ __html: highlighted }} />
                        : headerText
                    }
                </div>
            )}

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
                <div style={{ padding: '6px 10px', fontSize: 12, color: token.colorTextTertiary }}>
                    {placeholderForState(state)}
                </div>
            )}
        </div>
    )
}
