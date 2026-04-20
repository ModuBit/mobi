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

import type { ToolInfo } from './types'
import { memo, useEffect, useMemo, useState } from 'react'
import { Button, theme as antTheme, Tag, Input } from 'antd'
import { CheckOutlined, LeftOutlined, RightOutlined, LoadingOutlined } from '@ant-design/icons'
import { useTranslation } from 'react-i18next'
import {
    isRequestUserInputToolName,
    parseRequestUserInputInput,
    formatRequestUserInputAnswers,
    type RequestUserInputQuestion
} from './requestUserInput'
import { useAuthStore } from '@/core/data/stores/authStore'
import { useMobiApi } from '@/core/data/api/client'
import { useQueryClient } from '@tanstack/react-query'
import { queryKeys } from '@/core/lib/query-keys'

const { useToken } = antTheme
const { TextArea } = Input

type QuestionState = {
    selected: string | null
    userNote: string
}

type RequestUserInputFooterProps = {
    sessionId: string
    tool: ToolInfo
    disabled: boolean
    onDone: () => void
}

function RequestUserInputFooterInner(props: RequestUserInputFooterProps) {
    const { t } = useTranslation()
    const { token } = useToken()
    const queryClient = useQueryClient()
    const { token: authToken } = useAuthStore()
    const api = useMobiApi(authToken)

    const permission = props.tool.permission
    const parsed = useMemo(() => parseRequestUserInputInput(props.tool.input), [props.tool.input])
    const questions = parsed.questions

    const [step, setStep] = useState(0)
    const [stateByQuestion, setStateByQuestion] = useState<Record<string, QuestionState>>({})
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState<string | null>(null)

    useEffect(() => {
        setStep(0)
        const initial: Record<string, QuestionState> = {}
        for (const q of questions) {
            initial[q.id] = { selected: null, userNote: '' }
        }
        setStateByQuestion(initial)
        setLoading(false)
        setError(null)
    }, [props.tool.name])

    if (!permission || permission.status !== 'pending') return null
    if (!isRequestUserInputToolName(props.tool.name)) return null

    const total = Math.max(1, questions.length)
    const clampedStep = Math.min(Math.max(step, 0), total - 1)
    const currentQuestion = questions[clampedStep]
    const currentState = currentQuestion ? stateByQuestion[currentQuestion.id] : null
    const isPureTextQuestion = currentQuestion && currentQuestion.options.length === 0

    const validateQuestion = (question: RequestUserInputQuestion): boolean => {
        const state = stateByQuestion[question.id]
        if (!state) return false
        if (question.options.length > 0) {
            return state.selected !== null || state.userNote.trim().length > 0
        }
        return state.userNote.trim().length > 0
    }

    const submit = async () => {
        if (loading) return
        for (let i = 0; i < questions.length; i++) {
            const q = questions[i]
            if (!validateQuestion(q)) {
                setError(t('tool.selectOption'))
                setStep(i)
                return
            }
        }
        const formattedAnswers = formatRequestUserInputAnswers(stateByQuestion)
        setLoading(true)
        try {
            await api.permissions.approve(props.sessionId, permission.id, formattedAnswers)
            queryClient.invalidateQueries({ queryKey: queryKeys.session(props.sessionId) })
            props.onDone()
        } catch (e) {
            setError(e instanceof Error ? e.message : t('tool.requestFailed'))
        } finally {
            setLoading(false)
        }
    }

    const next = () => {
        if (!currentQuestion) return
        if (!validateQuestion(currentQuestion)) {
            setError(t('tool.selectOption'))
            return
        }
        setError(null)
        setStep(s => Math.min(s + 1, questions.length - 1))
    }

    const prev = () => {
        setError(null)
        setStep(s => Math.max(s - 1, 0))
    }

    const selectOption = (questionId: string, optionLabel: string) => {
        setStateByQuestion(prev => ({
            ...prev,
            [questionId]: { ...prev[questionId], selected: optionLabel }
        }))
    }

    const updateUserNote = (questionId: string, value: string) => {
        setStateByQuestion(prev => ({
            ...prev,
            [questionId]: { ...prev[questionId], userNote: value }
        }))
    }

    return (
        <div style={{
            marginTop: 12,
            borderRadius: 8,
            border: `1px solid ${token.colorBorder}`,
            background: token.colorBgContainer,
            padding: 12
        }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <Tag color="orange">{t('tool.question')}</Tag>
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: token.colorTextSecondary }}>
                    [{clampedStep + 1}/{total}]
                </span>
            </div>

            {error && (
                <div style={{ marginTop: 8, fontSize: 12, color: token.colorError }}>{error}</div>
            )}

            {currentQuestion && (
                <div style={{ marginTop: 12 }}>
                    {currentQuestion.question && (
                        <div style={{ fontSize: 14, color: token.colorText, wordBreak: 'break-word' }}>
                            {currentQuestion.question}
                        </div>
                    )}

                    {isPureTextQuestion ? (
                        <TextArea
                            value={currentState?.userNote ?? ''}
                            onChange={e => updateUserNote(currentQuestion.id, e.target.value)}
                            disabled={props.disabled || loading}
                            placeholder={t('tool.requestUserInput.textPlaceholder')}
                            rows={4}
                            style={{ marginTop: 12 }}
                        />
                    ) : (
                        <>
                            <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 4 }}>
                                {currentQuestion.options.map((opt, optIdx) => {
                                    const isSelected = currentState?.selected === opt.label
                                    return (
                                        <button
                                            key={optIdx}
                                            type="button"
                                            onClick={() => selectOption(currentQuestion.id, opt.label)}
                                            disabled={props.disabled || loading}
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
                                                background: isSelected ? token.colorBgTextHover : 'transparent',
                                                cursor: props.disabled || loading ? 'not-allowed' : 'pointer',
                                                opacity: props.disabled || loading ? 0.5 : 1
                                            }}
                                        >
                                            <span style={{ marginTop: 2, width: 16, color: token.colorTextSecondary }}>
                                                {isSelected ? '●' : '○'}
                                            </span>
                                            <span style={{ minWidth: 0, flex: 1 }}>
                                                <div style={{ fontWeight: 500, color: token.colorText, wordBreak: 'break-word' }}>{opt.label}</div>
                                                {opt.description && (
                                                    <div style={{ marginTop: 2, fontSize: 12, color: token.colorTextSecondary }}>{opt.description}</div>
                                                )}
                                            </span>
                                        </button>
                                    )
                                })}
                            </div>
                            <div style={{ marginTop: 12 }}>
                                <div style={{ fontSize: 12, color: token.colorTextSecondary, marginBottom: 4 }}>
                                    {t('tool.requestUserInput.noteLabel')}
                                </div>
                                <TextArea
                                    value={currentState?.userNote ?? ''}
                                    onChange={e => updateUserNote(currentQuestion.id, e.target.value)}
                                    disabled={props.disabled || loading}
                                    placeholder={t('tool.requestUserInput.notePlaceholder')}
                                    rows={3}
                                />
                            </div>
                        </>
                    )}
                </div>
            )}

            <div style={{ marginTop: 12, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                <div>
                    {questions.length > 1 && (
                        <Button size="small" disabled={props.disabled || loading || clampedStep === 0} onClick={prev} icon={<LeftOutlined />}>
                            {t('tool.prev')}
                        </Button>
                    )}
                </div>
                <div>
                    {questions.length > 1 && clampedStep < questions.length - 1 ? (
                        <Button type="primary" size="small" disabled={props.disabled || loading} onClick={next} icon={<RightOutlined />}>
                            {t('tool.next')}
                        </Button>
                    ) : (
                        <Button type="primary" size="small" disabled={props.disabled || loading} onClick={submit} icon={loading ? <LoadingOutlined /> : <CheckOutlined />}>
                            {loading ? t('tool.submitting') : t('tool.submit')}
                        </Button>
                    )}
                </div>
            </div>
        </div>
    )
}

export const RequestUserInputFooter = memo(RequestUserInputFooterInner)
