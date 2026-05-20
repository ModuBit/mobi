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

import type { MobiApi } from '@/core/data/api/client'
import type { ToolInfo } from '@/domain/tool/types'
import { memo, useEffect, useMemo, useState } from 'react'
import { Button, theme as antTheme, Typography, Input, Tabs } from 'antd'
import { CheckOutlined, LoadingOutlined } from '@ant-design/icons'
import { Circle, CircleCheck, Square, SquareCheck } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { isAskUserQuestionToolName, parseAskUserQuestionInput, type AskUserQuestionQuestion } from '@/domain/tool/askUserQuestion'
import { OptionPreview } from './OptionPreview'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { queryKeys } from '@/core/lib/query-keys'

const { Text } = Typography
const { useToken } = antTheme
const { TextArea } = Input

function SelectionMark(props: { checked: boolean; mode: 'single' | 'multi' }) {
    const { token } = useToken()
    const icon = props.mode === 'multi'
        ? (props.checked ? <SquareCheck size={16} /> : <Square size={16} />)
        : (props.checked ? <CircleCheck size={16} /> : <Circle size={16} />)
    return (
        <span style={{ marginTop: 2, width: 16, flexShrink: 0, textAlign: 'center', color: props.checked ? token.colorPrimary : token.colorTextQuaternary, display: 'flex', alignItems: 'center' }}>
            {icon}
        </span>
    )
}

function OptionRow(props: {
    checked: boolean
    mode: 'single' | 'multi'
    disabled: boolean
    title: string
    description?: string | null
    preview?: string | null
    onClick: () => void
}) {
    const { token } = useToken()

    const showDescription = props.description && props.description !== props.title
    const labelContent = (
        <span style={{ minWidth: 0, flex: 1 }}>
            <div style={{ fontWeight: 500, color: token.colorText, wordBreak: 'break-word' }}>{props.title}</div>
            {showDescription ? (
                <div style={{ marginTop: 2, fontSize: 12, color: token.colorTextSecondary, wordBreak: 'break-word' }}>
                    {props.description}
                </div>
            ) : null}
        </span>
    )

    const content = props.preview
        ? <OptionPreview preview={props.preview}>{labelContent}</OptionPreview>
        : labelContent

    return (
        <button
            type="button"
            onClick={props.onClick}
            disabled={props.disabled}
            style={{
                display: 'flex',
                width: '100%',
                alignItems: 'flex-start',
                gap: 8,
                borderRadius: 6,
                padding: '4px 8px',
                textAlign: 'left',
                fontSize: 14,
                border: 'none',
                background: props.checked ? token.colorBgTextHover : 'transparent',
                cursor: props.disabled ? 'not-allowed' : 'pointer',
                opacity: props.disabled ? 0.5 : 1,
                transition: 'background 0.2s'
            }}
        >
            <SelectionMark checked={props.checked} mode={props.mode} />
            {content}
        </button>
    )
}

function computeAnswersForQuestion(
    question: AskUserQuestionQuestion,
    selectedOptionIndices: number[],
    otherSelected: boolean,
    otherText: string
): string[] {
    const answers: string[] = []

    for (const idx of selectedOptionIndices) {
        const opt = question.options[idx]
        if (!opt) continue
        const label = opt.label.trim()
        if (label.length > 0) answers.push(label)
    }

    const other = otherText.trim()
    if (otherSelected && other.length > 0) {
        answers.push(other)
    }

    return answers
}

type AskUserQuestionFooterProps = {
    api: MobiApi
    sessionId: string
    tool: ToolInfo
    disabled: boolean
    onDone: () => void
}

function AskUserQuestionFooterInner(props: AskUserQuestionFooterProps) {
    const { t } = useTranslation()
    const { token } = useToken()
    const queryClient = useQueryClient()
    const permission = props.tool.permission
    const parsed = useMemo(() => parseAskUserQuestionInput(props.tool.input), [props.tool.input])
    const questions = parsed.questions

    const [step, setStep] = useState(0)
    const [selectedByQuestion, setSelectedByQuestion] = useState<number[][]>([])
    const [otherSelectedByQuestion, setOtherSelectedByQuestion] = useState<boolean[]>([])
    const [otherTextByQuestion, setOtherTextByQuestion] = useState<string[]>([])
    const [fallbackText, setFallbackText] = useState('')

    const [loading, setLoading] = useState(false)
    const [error, setError] = useState<string | null>(null)

    useEffect(() => {
        setStep(0)
        setSelectedByQuestion(questions.map(() => []))
        setOtherSelectedByQuestion(questions.map(() => false))
        setOtherTextByQuestion(questions.map(() => ''))
        setFallbackText('')
        setLoading(false)
        setError(null)
    }, [props.tool.input])

    if (!permission || permission.status !== 'pending') return null
    if (!isAskUserQuestionToolName(props.tool.name)) return null

    const validateQuestion = (idx: number): string[] | null => {
        if (questions.length === 0) {
            const text = fallbackText.trim()
            return text.length > 0 ? [text] : null
        }

        const question = questions[idx]
        if (!question) return null
        const answers = computeAnswersForQuestion(
            question,
            selectedByQuestion[idx] ?? [],
            otherSelectedByQuestion[idx] ?? false,
            otherTextByQuestion[idx] ?? ''
        )
        return answers.length > 0 ? answers : null
    }

    const canSubmit = questions.length === 0
        ? fallbackText.trim().length > 0
        : questions.every((_, i) => validateQuestion(i) !== null)

    const renderSubmitButton = () => (
        <Button
            type="primary"
            block
            disabled={props.disabled || loading || !canSubmit}
            onClick={submit}
            loading={loading}
            icon={loading ? <LoadingOutlined /> : <CheckOutlined />}
            style={{ marginTop: 8 }}
        >
            {loading ? t('chat.tool.submitting') : t('chat.tool.submit')}
        </Button>
    )

    const submit = async () => {
        if (loading) return

        const answers: Record<string, string[]> = {}
        if (questions.length === 0) {
            const a0 = validateQuestion(0)
            if (!a0) {
                setError(t('chat.tool.selectOption'))
                return
            }
            answers[''] = a0
        } else {
            for (let i = 0; i < questions.length; i += 1) {
                const a = validateQuestion(i)
                if (!a) {
                    setError(t('chat.tool.selectOption'))
                    setStep(i)
                    return
                }
                answers[questions[i].question] = a
            }
        }

        setLoading(true)
        try {
            await props.api.permissions.approve(props.sessionId, permission.id, { answers })
            queryClient.invalidateQueries({ queryKey: queryKeys.session(props.sessionId) })
            props.onDone()
        } catch (e) {
            setError(e instanceof Error ? e.message : t('chat.tool.requestFailed'))
        } finally {
            setLoading(false)
        }
    }

    const toggleOption = (qIdx: number, optIdx: number) => {
        const q = questions[qIdx]
        if (!q) return

        setSelectedByQuestion((prevSelected) => {
            const nextSelected = prevSelected.slice()
            const cur = new Set(nextSelected[qIdx] ?? [])
            if (q.multiSelect) {
                if (cur.has(optIdx)) cur.delete(optIdx)
                else cur.add(optIdx)
                nextSelected[qIdx] = Array.from(cur).sort((a, b) => a - b)
                return nextSelected
            }

            nextSelected[qIdx] = [optIdx]
            return nextSelected
        })

        if (!q.multiSelect) {
            setOtherSelectedByQuestion((prevOther) => {
                const nextOther = prevOther.slice()
                nextOther[qIdx] = false
                return nextOther
            })
        }
    }

    const toggleOther = (qIdx: number) => {
        const q = questions[qIdx]
        if (!q) return

        if (!q.multiSelect) {
            const isCurrentlySelected = otherSelectedByQuestion[qIdx]
            if (!isCurrentlySelected) {
                setSelectedByQuestion((prevSelected) => {
                    const nextSelected = prevSelected.slice()
                    nextSelected[qIdx] = []
                    return nextSelected
                })
            }
            setOtherSelectedByQuestion((prevOther) => {
                const nextOther = prevOther.slice()
                nextOther[qIdx] = !isCurrentlySelected
                return nextOther
            })
            return
        }

        setOtherSelectedByQuestion((prevOther) => {
            const nextOther = prevOther.slice()
            nextOther[qIdx] = !nextOther[qIdx]
            return nextOther
        })
    }

    const updateOtherText = (qIdx: number, value: string) => {
        setOtherTextByQuestion((prevText) => {
            const nextText = prevText.slice()
            nextText[qIdx] = value
            return nextText
        })
        if (value.trim().length > 0) {
            setOtherSelectedByQuestion((prevOther) => {
                const nextOther = prevOther.slice()
                nextOther[qIdx] = true
                return nextOther
            })
            if (!questions[qIdx]?.multiSelect) {
                setSelectedByQuestion((prevSelected) => {
                    const nextSelected = prevSelected.slice()
                    nextSelected[qIdx] = []
                    return nextSelected
                })
            }
        }
    }

    // 渲染单个问题的选项列表（不含 header）
    const renderQuestionOptions = (qIdx: number) => {
        const question = questions[qIdx]
        if (!question) return null
        const m: 'single' | 'multi' = question.multiSelect ? 'multi' : 'single'
        return (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                {question.question ? (
                    <div style={{ fontSize: 14, color: token.colorText, wordBreak: 'break-word', marginBottom: 4 }}>
                        {question.question}
                    </div>
                ) : null}
                {question.options.map((opt, optIdx) => {
                    const selected = (selectedByQuestion[qIdx] ?? []).includes(optIdx)
                    return (
                        <OptionRow
                            key={optIdx}
                            checked={selected}
                            mode={m}
                            disabled={props.disabled || loading}
                            title={opt.label}
                            description={opt.description}
                            preview={opt.preview}
                            onClick={() => toggleOption(qIdx, optIdx)}
                        />
                    )
                })}
                <OptionRow
                    checked={otherSelectedByQuestion[qIdx] ?? false}
                    mode={m}
                    disabled={props.disabled || loading}
                    title={t('chat.tool.other')}
                    description={t('chat.tool.otherDescription')}
                    onClick={() => toggleOther(qIdx)}
                />
                {(otherSelectedByQuestion[qIdx] ?? false) ? (
                    <TextArea
                        value={otherTextByQuestion[qIdx] ?? ''}
                        onChange={(e) => updateOtherText(qIdx, e.target.value)}
                        disabled={props.disabled || loading}
                        placeholder={t('chat.tool.askUserQuestion.otherPlaceholder')}
                        rows={3}
                        style={{ marginTop: 4 }}
                    />
                ) : null}
            </div>
        )
    }

    return (
        <div style={{
            marginTop: 8,
            display: 'flex',
            flexDirection: 'column',
            gap: 8
        }}>
            {error ? (
                <div style={{ fontSize: 12, color: token.colorError }}>
                    {error}
                </div>
            ) : null}

            {questions.length === 0 ? (
                <div>
                    <div style={{ fontSize: 14, color: token.colorTextSecondary }}>
                        {t('chat.tool.askUserQuestion.fallback')}
                    </div>
                    <TextArea
                        value={fallbackText}
                        onChange={(e) => setFallbackText(e.target.value)}
                        disabled={props.disabled || loading}
                        placeholder={t('chat.tool.askUserQuestion.placeholder')}
                        rows={4}
                        style={{ marginTop: 8 }}
                    />
                    {renderSubmitButton()}
                </div>
            ) : questions.length === 1 ? (
                /* 单题：直接展示选项 */
                <div>
                    {renderQuestionOptions(0)}
                    {renderSubmitButton()}
                </div>
            ) : (
                /* 多题：使用 Tabs 组件 */
                <Tabs
                    activeKey={String(step)}
                    onChange={(key) => { setError(null); setStep(Number(key)) }}
                    size="small"
                    items={questions.map((q, idx) => ({
                        key: String(idx),
                        label: q.header || t('chat.tool.askUserQuestion.questionN', { n: idx + 1 }),
                        children: (
                            <div>
                                {renderQuestionOptions(idx)}
                                {idx === questions.length - 1 ? renderSubmitButton() : null}
                            </div>
                        )
                    }))}
                />
            )}
        </div>
    )
}

export const AskUserQuestionFooter = memo(AskUserQuestionFooterInner)
