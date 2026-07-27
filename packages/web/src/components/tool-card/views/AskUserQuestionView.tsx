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
import { OptionRow } from '../OptionRow'

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

/**
 * 自定义/其他答案项 —— 选项列表之外的自由答案（例如 deno）。
 * 完成态视觉与 OptionRow 一致：colorSuccessBg 底 + colorSuccessBorder 边 + colorSuccess 文本强调。
 * 不直接复用 OptionRow 是因为它需要 (custom answer) 副标题与图标占位语义。
 */
function OtherAnswerItem({ answer, isMulti }: { answer: string; isMulti: boolean }) {
    const { token } = antTheme.useToken()
    return (
        <div
            data-testid="other-answer"
            style={{
                borderRadius: 6,
                border: `1px solid ${token.colorSuccessBorder}`,
                background: token.colorSuccessBg,
                padding: 8,
            }}
        >
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                <span style={{ flexShrink: 0, fontSize: 14, color: token.colorSuccess }}>
                    {isMulti ? '☑' : '●'}
                </span>
                <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{
                        fontSize: 14,
                        color: token.colorSuccess,
                        fontWeight: 500,
                        wordBreak: 'break-word',
                    }}>
                        {answer}
                    </div>
                    <div style={{ marginTop: 2, fontSize: 12, color: token.colorTextSecondary }}>
                        (custom answer)
                    </div>
                </div>
            </div>
        </div>
    )
}

/**
 * 自由格式答案项 —— 无选项的问题直接展示文本答案。
 * 同样走 colorSuccess 系 token，与完成态整体视觉统一。
 */
function FreeformAnswerItem({ answer }: { answer: string }) {
    const { token } = antTheme.useToken()
    return (
        <div
            data-testid="freeform-answer"
            style={{
                borderRadius: 6,
                border: `1px solid ${token.colorSuccessBorder}`,
                background: token.colorSuccessBg,
                padding: 8,
            }}
        >
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                <span style={{ flexShrink: 0, fontSize: 14, color: token.colorSuccess }}>●</span>
                <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{
                        fontSize: 14,
                        color: token.colorSuccess,
                        fontWeight: 500,
                        wordBreak: 'break-word',
                    }}>
                        {answer}
                    </div>
                </div>
            </div>
        </div>
    )
}

function OtherAnswersList(props: {
    answers: Record<string, string[]>
    questionText: string
    options: { label: string }[]
    isMulti: boolean
}): ReactNode {
    const questionAnswers = props.answers[props.questionText]
    if (!questionAnswers || !Array.isArray(questionAnswers)) return null

    const optionLabels = new Set(props.options.map(o => o.label.trim()))
    const otherAnswers = questionAnswers.filter(a => !optionLabels.has(a.trim()))

    if (otherAnswers.length === 0) return null

    return (
        <>
            {otherAnswers.map((answer, i) => (
                <OtherAnswerItem key={`other-${i}`} answer={answer} isMulti={props.isMulti} />
            ))}
        </>
    )
}

function FreeformAnswersList(props: {
    answers: Record<string, string[]>
    questionText: string
}): ReactNode {
    const questionAnswers = props.answers[props.questionText]
    if (!questionAnswers || !Array.isArray(questionAnswers)) return null

    const cleaned = questionAnswers.map(a => a.trim()).filter(a => a.length > 0)
    if (cleaned.length === 0) return null

    return (
        <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 4 }}>
            {cleaned.map((answer, i) => (
                <FreeformAnswerItem key={i} answer={answer} />
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
            return <FreeformAnswersList answers={answers} questionText="" />
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
                            padding: 12,
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
                                    return (
                                        <OptionRow
                                            key={optIdx}
                                            checked={isSelected}
                                            mode={isMulti ? 'multi' : 'single'}
                                            disabled
                                            tone="completed"
                                            title={opt.label}
                                            description={opt.description}
                                            preview={opt.preview}
                                        />
                                    )
                                })}

                                {hasAnswers && answers ? (
                                    <OtherAnswersList
                                        answers={answers}
                                        questionText={q.question}
                                        options={q.options}
                                        isMulti={isMulti}
                                    />
                                ) : null}
                            </div>
                        ) : hasAnswers && answers ? (
                            // 自由格式问题（无选项）- 直接显示答案
                            <FreeformAnswersList answers={answers} questionText={q.question} />
                        ) : null}
                    </div>
                )
            })}
        </div>
    )
}
