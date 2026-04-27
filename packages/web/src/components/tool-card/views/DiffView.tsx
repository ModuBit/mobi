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

import { useMemo, useState } from 'react'
import { Modal, theme as antTheme } from 'antd'
import { useTranslation } from 'react-i18next'
import { calculateLineNumWidth, getMaxLineNum } from './lineNumberUtils'

const { useToken } = antTheme

/**
 * 简单的行级 diff 算法
 */
function diffLines(oldStr: string, newStr: string): Array<{ value: string; added?: boolean; removed?: boolean }> {
    const oldLines = oldStr.split('\n')
    const newLines = newStr.split('\n')
    const result: Array<{ value: string; added?: boolean; removed?: boolean }> = []

    let oldIdx = 0
    let newIdx = 0

    while (oldIdx < oldLines.length || newIdx < newLines.length) {
        if (oldIdx < oldLines.length && newIdx < newLines.length) {
            if (oldLines[oldIdx] === newLines[newIdx]) {
                result.push({ value: oldLines[oldIdx] })
                oldIdx++
                newIdx++
            } else {
                // 查找在 old 中是否有匹配
                const matchInOld = newLines.slice(newIdx).findIndex(l => l === oldLines[oldIdx])
                const matchInNew = oldLines.slice(oldIdx).findIndex(l => l === newLines[newIdx])

                if (matchInOld === -1 && matchInNew >= 0) {
                    // new 中这行在 old 中找不到匹配，作为添加
                    result.push({ value: newLines[newIdx], added: true })
                    newIdx++
                } else if (matchInNew === -1 && matchInOld >= 0) {
                    // old 中这行在 new 中找不到匹配，作为删除
                    result.push({ value: oldLines[oldIdx], removed: true })
                    oldIdx++
                } else if (matchInOld >= 0 && (matchInNew === -1 || matchInOld <= matchInNew)) {
                    // 先添加 new 中的行
                    for (let i = 0; i < matchInOld; i++) {
                        result.push({ value: newLines[newIdx + i], added: true })
                    }
                    newIdx += matchInOld
                } else if (matchInNew >= 0) {
                    // 先删除 old 中的行
                    for (let i = 0; i < matchInNew; i++) {
                        result.push({ value: oldLines[oldIdx + i], removed: true })
                    }
                    oldIdx += matchInNew
                } else {
                    // 无法匹配，一个删除一个添加
                    result.push({ value: oldLines[oldIdx], removed: true })
                    result.push({ value: newLines[newIdx], added: true })
                    oldIdx++
                    newIdx++
                }
            }
        } else if (oldIdx < oldLines.length) {
            result.push({ value: oldLines[oldIdx], removed: true })
            oldIdx++
        } else {
            result.push({ value: newLines[newIdx], added: true })
            newIdx++
        }
    }

    return result
}

/**
 * Diff 内联视图
 */
function DiffInlineView(props: {
    oldString: string
    newString: string
    filePath?: string
}) {
    const { token } = useToken()
    const diff = useMemo(() => diffLines(props.oldString, props.newString), [props.oldString, props.newString])

    // 计算每行的行号（基于 newString 的行号）
    const linesWithNumbers = useMemo(() => {
        const result: Array<{ value: string; added?: boolean; removed?: boolean; lineNum?: number }> = []
        let newLineNum = 1

        for (const part of diff) {
            const lines = part.value.split('\n')
            if (lines.length > 0 && lines[lines.length - 1] === '') {
                lines.pop()
            }

            for (const line of lines) {
                result.push({
                    value: line,
                    added: part.added,
                    removed: part.removed,
                    // 删除行不显示行号，添加/不变行显示 new 文件的行号
                    lineNum: part.removed ? undefined : newLineNum,
                })
                if (!part.removed) {
                    newLineNum++
                }
            }
        }

        return result
    }, [diff])

    // 计算行号列宽度（根据最大行号）
    const maxLineNum = useMemo(() => getMaxLineNum(linesWithNumbers), [linesWithNumbers])
    const lineNumWidth = useMemo(() => calculateLineNumWidth(maxLineNum), [maxLineNum])

    return (
        <div style={{
            overflow: 'hidden',
            borderRadius: 4,
            border: `1px solid ${token.colorBorder}`,
            background: token.colorBgContainer
        }}>
            {props.filePath ? (
                <div style={{
                    borderBottom: `1px solid ${token.colorBorder}`,
                    background: token.colorBgLayout,
                    padding: '4px 8px',
                    fontSize: 11,
                    color: token.colorTextSecondary,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap'
                }}>
                    {props.filePath}
                </div>
            ) : null}

            {/* 整体容器，横向滚动 */}
            <div style={{ overflowX: 'auto', overflowY: 'hidden' }}>
                <div style={{ display: 'table', minWidth: '100%' }}>
                    {linesWithNumbers.map((line, i) => {
                        const prefix = line.added ? '+' : line.removed ? '-' : ' '
                        const bgColor = line.added ? token.colorSuccessBg : line.removed ? token.colorErrorBg : 'transparent'
                        const textColor = line.added ? token.colorSuccess : line.removed ? token.colorError : token.colorText

                        return (
                            <div key={i} style={{
                                display: 'table-row',
                                background: bgColor,
                                fontFamily: 'var(--font-mono)',
                                fontSize: 12,
                                lineHeight: 1.6,
                            }}>
                                {/* 行号列 */}
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
                                    {line.lineNum ?? ''}
                                </div>
                                {/* 内容列 */}
                                <div style={{
                                    display: 'table-cell',
                                    padding: '0 8px',
                                    whiteSpace: 'pre',
                                    color: textColor,
                                }}>
                                    {prefix} {line.value || ' '}
                                </div>
                            </div>
                        )
                    })}
                </div>
            </div>
        </div>
    )
}

/**
 * Diff 视图组件
 * 支持 inline 和 preview 两种模式
 */
export function DiffView(props: {
    oldString: string
    newString: string
    filePath?: string
    variant?: 'preview' | 'inline'
}) {
    const { t } = useTranslation()
    const { token } = useToken()
    const variant = props.variant ?? 'preview'

    const stats = useMemo(() => {
        const oldChars = props.oldString.length
        const newChars = props.newString.length
        const oldLabel = `${oldChars.toLocaleString()} chars`
        const newLabel = `${newChars.toLocaleString()} chars`
        return { oldChars, newChars, label: `old: ${oldLabel} → new: ${newLabel}` }
    }, [props.oldString.length, props.newString.length])

    const title = props.filePath ? props.filePath : t('diff.title')
    const subtitle = props.filePath ? stats.label : `${t('diff.title')} • ${stats.label}`

    const DiffInline = (
        <DiffInlineView
            oldString={props.oldString}
            newString={props.newString}
            filePath={props.filePath}
        />
    )

    if (variant === 'inline') {
        return DiffInline
    }

    // preview 模式：使用 Modal 显示
    const [modalOpen, setModalOpen] = useState(false)

    return (
        <>
            <button
                type="button"
                onClick={() => setModalOpen(true)}
                style={{
                    width: '100%',
                    textAlign: 'left',
                    background: 'transparent',
                    border: 'none',
                    padding: 0,
                    cursor: 'pointer'
                }}
            >
                <div style={{
                    overflow: 'hidden',
                    borderRadius: 4,
                    border: `1px solid ${token.colorBorder}`,
                    background: token.colorBgContainer,
                    transition: 'background 0.2s'
                }}
                    onMouseEnter={(e) => e.currentTarget.style.background = token.colorBgTextHover}
                    onMouseLeave={(e) => e.currentTarget.style.background = token.colorBgContainer}
                >
                    {props.filePath ? (
                        <div style={{
                            borderBottom: `1px solid ${token.colorBorder}`,
                            background: token.colorBgLayout,
                            padding: '4px 8px',
                            fontSize: 11,
                            color: token.colorTextSecondary,
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap'
                        }}>
                            {props.filePath}
                        </div>
                    ) : null}
                    <div style={{ padding: 8 }}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                            <div style={{
                                minWidth: 0,
                                fontFamily: 'var(--font-mono)',
                                fontSize: 11,
                                color: token.colorTextSecondary,
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                                whiteSpace: 'nowrap'
                            }}>
                                {props.filePath ? stats.label : subtitle}
                            </div>
                            <div style={{ flexShrink: 0, fontSize: 11, color: token.colorPrimary }}>
                                {t('diff.view')}
                            </div>
                        </div>
                    </div>
                </div>
            </button>

            <Modal
                open={modalOpen}
                onCancel={() => setModalOpen(false)}
                footer={null}
                title={title}
                width={800}
            >
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: token.colorTextSecondary, marginBottom: 12 }}>
                    {stats.label}
                </div>
                <div style={{ maxHeight: '75vh', overflow: 'auto' }}>
                    {DiffInline}
                </div>
            </Modal>
        </>
    )
}

