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
import type { ToolViewProps } from '@/components/tool-card/views/_all'
import { isObject } from '@mobi/shared'
import { getInputStringAny } from '@/core/lib/toolInputUtils'
import { resolveDisplayPath } from '@/core/utils/path'
import { calculateLineNumWidth, getMaxLineNum } from './lineNumberUtils'
import { ToolViewPanel } from './ToolViewPanel'

const { useToken } = antTheme

/** 从 result 中提取文本内容 */
function extractReadContent(result: unknown): string | null {
    if (typeof result === 'string') return result
    if (!isObject(result)) return null

    const file = isObject(result.file) ? result.file : null
    if (file && typeof file.content === 'string') return file.content

    if (typeof result.content === 'string') return result.content
    if (typeof result.text === 'string') return result.text
    if (typeof result.output === 'string') return result.output

    return null
}

/** 解析带行号前缀的行 */
function parseLineWithNumber(line: string): { lineNum: number; content: string } | null {
    const match = line.match(/^(\d+)(?:\t| {2})(.*)$/)
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
    const { input, result } = props.block.tool

    const filePath = useMemo(() => {
        const raw = getInputStringAny(input, ['file_path', 'path', 'file'])
        return raw ? resolveDisplayPath(raw, props.metadata) : null
    }, [input, props.metadata])

    const content = useMemo(() => extractReadContent(result), [result])

    const parsedLines = useMemo(() => {
        if (!content) return []
        const lines = content.split('\n')
        return lines.map((line) => parseLineWithNumber(line))
    }, [content])

    const maxLineNum = useMemo(() => getMaxLineNum(parsedLines), [parsedLines])
    const lineNumWidth = useMemo(() => calculateLineNumWidth(maxLineNum), [maxLineNum])

    const statsLabel = useMemo(() => {
        const offset = isObject(input) && typeof input.offset === 'number' ? input.offset : null
        const lineCount = parsedLines.filter(p => p !== null).length
        if (offset !== null && lineCount > 0) {
            return `L${offset + 1}-${offset + lineCount} · ${lineCount} lines`
        }
        return lineCount > 0 ? `${lineCount} lines` : null
    }, [input, parsedLines])

    if (!content || parsedLines.length === 0) {
        return (
            <div style={{ fontSize: 13, color: token.colorTextTertiary }}>
                (no content)
            </div>
        )
    }

    return (
        <ToolViewPanel
            header={filePath ? (
                <>
                    <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {filePath}
                    </div>
                    {statsLabel && (
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
                    )}
                </>
            ) : undefined}
        >
            <div style={{ overflowX: 'auto', overflowY: 'hidden' }}>
                <div style={{ display: 'table', minWidth: '100%' }}>
                    {parsedLines.map((parsed, idx) => (
                        <div key={idx} style={{
                            display: 'table-row',
                            fontFamily: 'var(--font-mono)',
                            fontSize: 12,
                            lineHeight: 1.6,
                        }}>
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
        </ToolViewPanel>
    )
}
