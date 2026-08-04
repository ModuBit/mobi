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
import { Alert, Button, theme as antTheme, Input, Tabs } from 'antd'
import { CheckOutlined, LoadingOutlined } from '@ant-design/icons'
import { useTranslation } from 'react-i18next'
import { isAskUserQuestionToolName, parseAskUserQuestionInput, buildChatAboutThisReason, type AskUserQuestionQuestion } from '@/domain/tool/askUserQuestion'
import { useIsMobile } from '@/core/data/hooks/useMediaQuery'
import { useQueryClient } from '@tanstack/react-query'
import { queryKeys } from '@/core/lib/query-keys'
import { OptionRow } from './OptionRow'

const { useToken } = antTheme
const { TextArea } = Input

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
    const isMobile = useIsMobile()
    // 移动端触摸目标 ≥44px，桌面端 40px
    const actionMinHeight = isMobile ? 44 : 40
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
        <div style={{ marginTop: 12, display: 'flex', gap: 8, alignItems: 'stretch' }}>
            <Button
                type="primary"
                block
                disabled={props.disabled || loading || !canSubmit}
                onClick={submit}
                loading={loading}
                icon={loading ? <LoadingOutlined /> : <CheckOutlined />}
                style={{ minHeight: actionMinHeight, justifyContent: 'center' }}
            >
                {loading ? t('chat.tool.submitting') : t('chat.tool.submit')}
            </Button>
            <Button
                disabled={props.disabled || loading}
                onClick={chatAbout}
                loading={loading}
                style={{ minHeight: actionMinHeight, justifyContent: 'center' }}
            >
                {t('chat.tool.askUserQuestion.chatAbout')}
            </Button>
        </div>
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

    /** 聊一聊：不提交答案，deny 带 seed 文案引导 Claude 主动反问 */
    const chatAbout = async () => {
        if (loading) return

        // 收集已选答案（与 submit 同逻辑，但不阻断未答题）
        const answers: Record<string, string[]> = {}
        if (questions.length === 0) {
            const a0 = validateQuestion(0)
            if (a0) answers[''] = a0
        } else {
            for (let i = 0; i < questions.length; i += 1) {
                const a = computeAnswersForQuestion(
                    questions[i],
                    selectedByQuestion[i] ?? [],
                    otherSelectedByQuestion[i] ?? false,
                    otherTextByQuestion[i] ?? '',
                )
                if (a.length > 0) answers[questions[i].question] = a
            }
        }

        const reason = buildChatAboutThisReason(questions, answers)
        setLoading(true)
        try {
            await props.api.permissions.deny(props.sessionId, permission.id, { reason })
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

    // 渲染单个问题的选项列表（不含 header）—— 用共享 OptionRow + 卡片容器
    const renderQuestionOptions = (qIdx: number) => {
        const question = questions[qIdx]
        if (!question) return null
        const m: 'single' | 'multi' = question.multiSelect ? 'multi' : 'single'
        return (
            <div style={{
                display: 'flex', flexDirection: 'column', gap: 6,
                padding: 10, borderRadius: 8,
                background: token.colorBgLayout,
                border: `1px solid ${token.colorBorderSecondary}`,
            }}>
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
                            data-testid={`option-${optIdx}`}
                            checked={selected}
                            mode={m}
                            disabled={props.disabled || loading}
                            tone="interactive"
                            title={opt.label}
                            description={opt.description}
                            preview={opt.preview}
                            onClick={() => toggleOption(qIdx, optIdx)}
                        />
                    )
                })}
                <OptionRow
                    data-testid="option-other"
                    checked={otherSelectedByQuestion[qIdx] ?? false}
                    mode={m}
                    disabled={props.disabled || loading}
                    tone="interactive"
                    title={t('chat.tool.other')}
                    description={t('chat.tool.otherDescription')}
                    onClick={() => toggleOther(qIdx)}
                />
                {/* TextArea 作为 OptionRow 的兄弟节点，避免点击 textarea 冒泡到 OptionRow 的 button 触发 toggle */}
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
                <Alert
                    type="error"
                    showIcon
                    message={error}
                    style={{ fontSize: 12, padding: '8px 12px', marginBottom: 8 }}
                />
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
                    tabBarStyle={{ minHeight: actionMinHeight }}
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
