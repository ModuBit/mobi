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
import type { ToolInfo } from './types'
import { memo, useEffect, useMemo, useState } from 'react'
import { Button, theme as antTheme, Typography, Tag, Spin, Input } from 'antd'
import { CheckOutlined, LeftOutlined, RightOutlined, LoadingOutlined } from '@ant-design/icons'
import { useTranslation } from 'react-i18next'
import { isAskUserQuestionToolName, parseAskUserQuestionInput, type AskUserQuestionQuestion } from './askUserQuestion'
import { getInputStringAny } from '@/core/lib/toolInputUtils'
import { useAuthStore } from '@/core/data/stores/authStore'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { queryKeys } from '@/core/lib/query-keys'

const { Text } = Typography
const { useToken } = antTheme
const { TextArea } = Input

function SelectionMark(props: { checked: boolean; mode: 'single' | 'multi' }) {
    const mark = props.mode === 'multi'
        ? (props.checked ? '☑' : '☐')
        : (props.checked ? '●' : '○')
    return (
        <span style={{ marginTop: 2, width: 16, flexShrink: 0, textAlign: 'center', color: '#999' }}>
            {mark}
        </span>
    )
}

function OptionRow(props: {
    checked: boolean
    mode: 'single' | 'multi'
    disabled: boolean
    title: string
    description?: string | null
    onClick: () => void
}) {
    const { token } = useToken()
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
                padding: 8,
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
            <span style={{ minWidth: 0, flex: 1 }}>
                <div style={{ fontWeight: 500, color: token.colorText, wordBreak: 'break-word' }}>{props.title}</div>
                {props.description ? (
                    <div style={{ marginTop: 2, fontSize: 12, color: token.colorTextSecondary, wordBreak: 'break-word' }}>
                        {props.description}
                    </div>
                ) : null}
            </span>
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
    }, [props.tool.name])

    if (!permission || permission.status !== 'pending') return null
    if (!isAskUserQuestionToolName(props.tool.name)) return null

    const run = async (action: () => Promise<void>) => {
        if (props.disabled) return
        setError(null)
        try {
            await action()
            props.onDone()
        } catch (e) {
            setError(e instanceof Error ? e.message : t('dialog.error.default'))
        }
    }

    const total = Math.max(1, questions.length)
    const clampedStep = Math.min(Math.max(step, 0), total - 1)

    const mode: 'single' | 'multi' = questions[clampedStep]?.multiSelect ? 'multi' : 'single'

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

    const submit = async () => {
        if (loading) return

        const answers: Record<string, string[]> = {}
        if (questions.length === 0) {
            const a0 = validateQuestion(0)
            if (!a0) {
                setError(t('tool.selectOption'))
                return
            }
            answers['0'] = a0
        } else {
            for (let i = 0; i < questions.length; i += 1) {
                const a = validateQuestion(i)
                if (!a) {
                    setError(t('tool.selectOption'))
                    setStep(i)
                    return
                }
                answers[String(i)] = a
            }
        }

        setLoading(true)
        try {
            await props.api.permissions.approve(props.sessionId, permission.id, { answers })
            queryClient.invalidateQueries({ queryKey: queryKeys.session(props.sessionId) })
            props.onDone()
        } catch (e) {
            setError(e instanceof Error ? e.message : t('tool.requestFailed'))
        } finally {
            setLoading(false)
        }
    }

    const next = () => {
        if (questions.length === 0) return
        const a = validateQuestion(clampedStep)
        if (!a) {
            setError(t('tool.selectOption'))
            return
        }
        setError(null)
        setStep((s) => Math.min(s + 1, questions.length - 1))
    }

    const prev = () => {
        setError(null)
        setStep((s) => Math.max(s - 1, 0))
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
            setSelectedByQuestion((prevSelected) => {
                const nextSelected = prevSelected.slice()
                nextSelected[qIdx] = []
                return nextSelected
            })
            setOtherSelectedByQuestion((prevOther) => {
                const nextOther = prevOther.slice()
                nextOther[qIdx] = true
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
        }
    }

    return (
        <div style={{
            marginTop: 12,
            borderRadius: 8,
            border: `1px solid ${token.colorBorder}`,
            background: token.colorBgContainer,
            padding: 12
        }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
                <div style={{ minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <Tag color="orange">{t('tool.question')}</Tag>
                        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: token.colorTextSecondary }}>
                            [{clampedStep + 1}/{total}]
                        </span>
                    </div>
                </div>
            </div>

            {error ? (
                <div style={{ marginTop: 8, fontSize: 12, color: token.colorError }}>
                    {error}
                </div>
            ) : null}

            {questions.length === 0 ? (
                <div style={{ marginTop: 12 }}>
                    <div style={{ fontSize: 14, color: token.colorTextSecondary }}>
                        {t('tool.askUserQuestion.fallback')}
                    </div>
                    <TextArea
                        value={fallbackText}
                        onChange={(e) => setFallbackText(e.target.value)}
                        disabled={props.disabled || loading}
                        placeholder={t('tool.askUserQuestion.placeholder')}
                        rows={4}
                        style={{ marginTop: 8 }}
                    />
                </div>
            ) : (
                <div style={{ marginTop: 12 }}>
                    <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
                        <div style={{ minWidth: 0, flex: 1 }}>
                            {questions[clampedStep]?.header ? (
                                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                    <Tag color="orange">{questions[clampedStep].header}</Tag>
                                </div>
                            ) : null}
                            {questions[clampedStep]?.question ? (
                                <div style={{
                                    fontSize: 14,
                                    color: token.colorText,
                                    wordBreak: 'break-word',
                                    marginTop: questions[clampedStep]?.header ? 8 : 0
                                }}>
                                    {questions[clampedStep].question}
                                </div>
                            ) : null}
                        </div>
                    </div>

                    <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 4 }}>
                        {questions[clampedStep].options.map((opt, optIdx) => {
                            const selected = (selectedByQuestion[clampedStep] ?? []).includes(optIdx)
                            return (
                                <OptionRow
                                    key={optIdx}
                                    checked={selected}
                                    mode={mode}
                                    disabled={props.disabled || loading}
                                    title={opt.label}
                                    description={opt.description}
                                    onClick={() => toggleOption(clampedStep, optIdx)}
                                />
                            )
                        })}

                        <OptionRow
                            checked={otherSelectedByQuestion[clampedStep] ?? false}
                            mode={mode}
                            disabled={props.disabled || loading}
                            title={t('tool.other')}
                            description={t('tool.otherDescription')}
                            onClick={() => toggleOther(clampedStep)}
                        />

                        {(otherSelectedByQuestion[clampedStep] ?? false) ? (
                            <TextArea
                                value={otherTextByQuestion[clampedStep] ?? ''}
                                onChange={(e) => updateOtherText(clampedStep, e.target.value)}
                                disabled={props.disabled || loading}
                                placeholder={t('tool.askUserQuestion.otherPlaceholder')}
                                rows={3}
                                style={{ marginTop: 8 }}
                            />
                        ) : null}
                    </div>
                </div>
            )}

            <div style={{ marginTop: 12, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                <div>
                    {questions.length > 1 ? (
                        <Button
                            size="small"
                            disabled={props.disabled || loading || clampedStep === 0}
                            onClick={prev}
                            icon={<LeftOutlined />}
                        >
                            {t('tool.prev')}
                        </Button>
                    ) : null}
                </div>

                <div>
                    {questions.length > 1 && clampedStep < questions.length - 1 ? (
                        <Button
                            type="primary"
                            size="small"
                            disabled={props.disabled || loading}
                            onClick={next}
                            icon={<RightOutlined />}
                        >
                            {t('tool.next')}
                        </Button>
                    ) : (
                        <Button
                            type="primary"
                            size="small"
                            disabled={props.disabled || loading}
                            onClick={submit}
                            loading={loading}
                            icon={loading ? <LoadingOutlined /> : <CheckOutlined />}
                        >
                            {loading ? t('tool.submitting') : t('tool.submit')}
                        </Button>
                    )}
                </div>
            </div>
        </div>
    )
}

export const AskUserQuestionFooter = memo(AskUserQuestionFooterInner)
