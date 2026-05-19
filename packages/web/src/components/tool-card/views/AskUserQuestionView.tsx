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
import type { ToolViewProps } from '@/components/tool-card/views/_all'
import { parseAskUserQuestionInput, normalizeAnswers } from '@/domain/tool/askUserQuestion'
import { theme as antTheme } from 'antd'
import { OptionPreview } from '../OptionPreview'

function isAnswerSelected(
    answers: Record<string, string[]> | undefined,
    questionText: string,
    optionLabel: string
): boolean {
    if (!answers) return false
    const questionAnswers = answers[questionText]
    if (!questionAnswers || !Array.isArray(questionAnswers)) return false
    return questionAnswers.some(a => a.trim() === optionLabel.trim())
}

function getSelectionMark(isMulti: boolean, isSelected: boolean): string {
    if (isMulti) {
        return isSelected ? '☑' : '☐'
    }
    return isSelected ? '●' : '○'
}

function renderOtherAnswers(
    answers: Record<string, string[]>,
    questionText: string,
    options: { label: string }[],
    isMulti: boolean
): ReactNode {
    const questionAnswers = answers[questionText]
    if (!questionAnswers || !Array.isArray(questionAnswers)) return null

    const optionLabels = new Set(options.map(o => o.label.trim()))
    const otherAnswers = questionAnswers.filter(a => !optionLabels.has(a.trim()))

    if (otherAnswers.length === 0) return null

    return (
        <>
            {otherAnswers.map((answer, i) => (
                <div
                    key={`other-${i}`}
                    style={{
                        borderRadius: 6,
                        border: '1px solid #52c41a',
                        background: '#f6ffed',
                        padding: '8px'
                    }}
                >
                    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                        <span style={{ flexShrink: 0, fontSize: 14, color: '#52c41a' }}>
                            {isMulti ? '☑' : '●'}
                        </span>
                        <div style={{ minWidth: 0, flex: 1 }}>
                            <div style={{ fontSize: 14, color: '#237804', fontWeight: 500, wordBreak: 'break-word' }}>
                                {answer}
                            </div>
                            <div style={{ marginTop: 2, fontSize: 12, color: '#999' }}>
                                (custom answer)
                            </div>
                        </div>
                    </div>
                </div>
            ))}
        </>
    )
}

function renderFreeformAnswers(
    answers: Record<string, string[]>,
    questionText: string
): ReactNode {
    const questionAnswers = answers[questionText]
    if (!questionAnswers || !Array.isArray(questionAnswers)) return null

    const cleaned = questionAnswers.map(a => a.trim()).filter(a => a.length > 0)
    if (cleaned.length === 0) return null

    return (
        <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 4 }}>
            {cleaned.map((answer, i) => (
                <div
                    key={i}
                    style={{
                        borderRadius: 6,
                        border: '1px solid #52c41a',
                        background: '#f6ffed',
                        padding: '8px'
                    }}
                >
                    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                        <span style={{ flexShrink: 0, fontSize: 14, color: '#52c41a' }}>●</span>
                        <div style={{ minWidth: 0, flex: 1 }}>
                            <div style={{ fontSize: 14, color: '#237804', fontWeight: 500, wordBreak: 'break-word' }}>
                                {answer}
                            </div>
                        </div>
                    </div>
                </div>
            ))}
        </div>
    )
}

export function AskUserQuestionView(props: ToolViewProps) {
    const { token } = antTheme.useToken()
    const parsed = parseAskUserQuestionInput(props.block.tool.input)
    const questions = parsed.questions
    const rawAnswers = props.block.tool.permission?.answers ?? undefined
    const answers = normalizeAnswers(rawAnswers)
    const hasAnswers = answers && Object.keys(answers).length > 0

    // 当问题数组为空但答案存在时（备用路径），直接渲染答案
    if (questions.length === 0) {
        if (hasAnswers && answers) {
            return renderFreeformAnswers(answers, '')
        }
        return null
    }

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {questions.map((q, idx) => {
                const isMulti = q.multiSelect

                return (
                    <div
                        key={idx}
                        style={{
                            borderRadius: 6,
                            border: `1px solid ${token.colorBorder}`,
                            background: token.colorBgContainer,
                            padding: 12
                        }}
                    >
                        {q.question ? (
                            <div style={{ fontSize: 14, color: token.colorText, wordBreak: 'break-word' }}>
                                {q.question}
                            </div>
                        ) : null}

                        {q.options.length > 0 ? (
                            <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 4 }}>
                                {q.options.map((opt, optIdx) => {
                                    const isSelected = isAnswerSelected(answers, q.question, opt.label)

                                    const labelContent = (
                                        <span style={{ minWidth: 0, flex: 1 }}>
                                            <div style={{
                                                fontSize: 14,
                                                wordBreak: 'break-word',
                                                color: isSelected ? '#237804' : token.colorText,
                                                fontWeight: isSelected ? 500 : 400
                                            }}>
                                                {opt.label}
                                            </div>
                                            {opt.description ? (
                                                <div style={{ marginTop: 2, fontSize: 12, color: token.colorTextSecondary, wordBreak: 'break-word' }}>
                                                    {opt.description}
                                                </div>
                                            ) : null}
                                        </span>
                                    )

                                    return (
                                        <div
                                            key={optIdx}
                                            style={{
                                                borderRadius: 6,
                                                border: `1px solid ${isSelected ? '#52c41a' : token.colorBorder}`,
                                                background: isSelected ? '#f6ffed' : 'transparent',
                                                padding: 8
                                            }}
                                        >
                                            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                                                {hasAnswers && (
                                                    <span style={{
                                                        flexShrink: 0,
                                                        fontSize: 14,
                                                        color: isSelected ? '#52c41a' : token.colorTextDisabled
                                                    }}>
                                                        {getSelectionMark(isMulti, isSelected)}
                                                    </span>
                                                )}
                                                {opt.preview ? (
                                                    <OptionPreview preview={opt.preview}>{labelContent}</OptionPreview>
                                                ) : labelContent}
                                            </div>
                                        </div>
                                    )
                                })}

                                {hasAnswers && renderOtherAnswers(answers, q.question, q.options, isMulti)}
                            </div>
                        ) : hasAnswers && answers ? (
                            // 自由格式问题（无选项）- 直接显示答案
                            renderFreeformAnswers(answers, q.question)
                        ) : null}
                    </div>
                )
            })}
        </div>
    )
}
