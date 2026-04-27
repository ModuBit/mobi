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
 * 行号列固定，内容列可横向滚动
 */

import { useMemo } from 'react'
import { theme as antTheme } from 'antd'
import type { ToolViewProps } from '@/components/tool-card/views/_all'
import { isObject } from '@mobi/shared'
import { calculateLineNumWidth, getMaxLineNum } from './lineNumberUtils'

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

/** 解析带行号前缀的行（如 "55\t### Python" → { lineNum: 55, content: "### Python" }） */
function parseLineWithNumber(line: string): { lineNum: number; content: string } | null {
    // 匹配行首的数字和制表符/空格
    const match = line.match(/^(\d+)(?:\t|  )(.*)$/)
    if (match) {
        return {
            lineNum: parseInt(match[1], 10),
            content: match[2],
        }
    }
    return null
}

export function ReadDetailView(props: ToolViewProps) {
    const { token } = useToken()
    const result = props.block.tool.result

    const content = useMemo(() => extractReadContent(result), [result])

    // 解析所有行，提取行号和内容
    const parsedLines = useMemo(() => {
        if (!content) return []
        const lines = content.split('\n')
        return lines.map((line) => parseLineWithNumber(line))
    }, [content])

    // 计算行号列宽度（根据最大行号）
    const maxLineNum = useMemo(() => getMaxLineNum(parsedLines), [parsedLines])
    const lineNumWidth = useMemo(() => calculateLineNumWidth(maxLineNum), [maxLineNum])

    if (!content || parsedLines.length === 0) {
        return (
            <div style={{ fontSize: 13, color: token.colorTextTertiary }}>
                (no content)
            </div>
        )
    }

    return (
        <div style={{
            overflow: 'hidden',
            background: token.colorBgContainer,
            border: `1px solid ${token.colorBorder}`,
            borderRadius: 6,
        }}>
            {/* 整体容器，横向滚动 */}
            <div style={{ overflowX: 'auto', overflowY: 'hidden' }}>
                <div style={{ display: 'table', minWidth: '100%' }}>
                    {parsedLines.map((parsed, idx) => (
                        <div key={idx} style={{
                            display: 'table-row',
                            fontFamily: 'var(--font-mono)',
                            fontSize: 12,
                            lineHeight: 1.6,
                        }}>
                            {/* 行号列 - 固定 */}
                            <div style={{
                                display: 'table-cell',
                                width: lineNumWidth,
                                minWidth: lineNumWidth,
                                padding: '0 8px',
                                textAlign: 'right',
                                color: token.colorTextTertiary,
                                userSelect: 'none',
                                background: token.colorBgLayout,
                                borderRight: `1px solid ${token.colorBorderSecondary}`,
                                position: 'sticky',
                                left: 0,
                                zIndex: 1,
                            }}>
                                {parsed?.lineNum ?? ''}
                            </div>
                            {/* 内容列 */}
                            <div style={{
                                display: 'table-cell',
                                padding: '0 12px',
                                whiteSpace: 'pre',
                                color: token.colorText,
                            }}>
                                {parsed?.content ?? ''}
                            </div>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    )
}
