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
 * Read 工具详情视图
 * 在详情抽屉中展示带行号的内容，不折行
 */

import { useMemo } from 'react'
import { theme as antTheme } from 'antd'
import type { ToolViewProps } from '@/components/tool-card/views/_all'
import { isObject } from '@mobi/shared'

const { useToken } = antTheme

/** 从 result 中提取文本内容 */
function extractReadContent(result: unknown): string | null {
    if (typeof result === 'string') return result
    if (!isObject(result)) return null

    // 尝试从 file.content 提取
    const file = isObject(result.file) ? result.file : null
    if (file && typeof file.content === 'string') return file.content

    // 尝试从 content/text/output 提取
    if (typeof result.content === 'string') return result.content
    if (typeof result.text === 'string') return result.text
    if (typeof result.output === 'string') return result.output

    return null
}

/** 从 input 中提取起始行号 */
function extractStartLine(input: unknown): number {
    if (!isObject(input)) return 1
    const offset = typeof input.offset === 'number' ? input.offset : null
    return offset !== null ? offset + 1 : 1
}

export function ReadDetailView(props: ToolViewProps) {
    const { token } = useToken()
    const result = props.block.tool.result
    const input = props.block.tool.input

    const content = useMemo(() => extractReadContent(result), [result])
    const startLine = useMemo(() => extractStartLine(input), [input])

    if (!content) {
        return (
            <div style={{ fontSize: 13, color: token.colorTextTertiary }}>
                (no content)
            </div>
        )
    }

    const lines = content.split('\n')

    return (
        <div style={{
            background: token.colorBgContainer,
            border: `1px solid ${token.colorBorder}`,
            borderRadius: 6,
            overflow: 'hidden',
        }}>
            <pre style={{
                margin: 0,
                padding: 0,
                fontSize: 12,
                fontFamily: 'var(--font-mono)',
                lineHeight: 1.6,
                overflowX: 'auto',
            }}>
                <code style={{ display: 'block' }}>
                    {lines.map((line, idx) => {
                        const lineNum = startLine + idx
                        return (
                            <div key={idx} style={{ display: 'flex' }}>
                                <span style={{
                                    width: 48,
                                    minWidth: 48,
                                    padding: '0 8px',
                                    textAlign: 'right',
                                    color: token.colorTextTertiary,
                                    userSelect: 'none',
                                    borderRight: `1px solid ${token.colorBorderSecondary}`,
                                    background: token.colorBgLayout,
                                }}>
                                    {lineNum}
                                </span>
                                <span style={{
                                    padding: '0 12px',
                                    whiteSpace: 'pre',
                                    color: token.colorText,
                                }}>
                                    {line || ' '}
                                </span>
                            </div>
                        )
                    })}
                </code>
            </pre>
        </div>
    )
}
