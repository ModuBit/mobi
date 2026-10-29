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
import { Alert, theme as antTheme, Input } from 'antd'
import { Button } from '@/ui/base/interactive/button/Button'
import { CheckOutlined } from '@ant-design/icons'
import { TabStrip, TabStripList, TabStripPanel, TabStripTab } from '@/ui/base/interactive/tabStrip'
import { useTranslation } from 'react-i18next'
import { isAskUserQuestionToolName, parseAskUserQuestionInput, buildChatAboutThisReason, type AskUserQuestionQuestion } from '@/domain/tool/askUserQuestion'
import { useIsMobile } from '@/core/data/hooks/useMediaQuery'
import { useQueryClient } from '@tanstack/react-query'
import { isAxiosError } from 'axios'
import { queryKeys } from '@/core/lib/queryKeys'
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

/**
 * 收集所有问题的已选答案为 Record<questionText, string[]>。
 * 空问题（fallback 形态）用 '' key 存 fallback 文本。不校验完整性（submit 另行校验）。
 * submit 与 chatAbout 共用，避免答案收集逻辑双份散落（曾因两份逻辑差异致 seed 与提交答案不一致）。
 */
export function collectAnswers(
    questions: AskUserQuestionQuestion[],
    selectedByQuestion: number[][],
    otherSelectedByQuestion: boolean[],
    otherTextByQuestion: string[],
    fallbackText: string,
): Record<string, string[]> {
    const answers: Record<string, string[]> = {}
    if (questions.length === 0) {
        const text = fallbackText.trim()
        if (text.length > 0) answers[''] = [text]
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

    const [pendingAction, setPendingAction] = useState<'submit' | 'chatAbout' | null>(null)
    const [error, setError] = useState<string | null>(null)

    useEffect(() => {
        setStep(0)
        setSelectedByQuestion(questions.map(() => []))
        setOtherSelectedByQuestion(questions.map(() => false))
        setOtherTextByQuestion(questions.map(() => ''))
        setFallbackText('')
        setPendingAction(null)
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

    /** 当前题是否已填（决定逐题按钮文案与末题提交/跳过并提交切换） */
    const isQuestionAnswered = (idx: number): boolean => validateQuestion(idx) !== null

    /**
     * 底部动作条（主按钮 + 「聊一聊」副按钮）：逐题前进/提交与 fallback 提交共用同一形态。
     * 有题形态下按钮恒可点（未填 → 跳过并提交，文案自解释）——mobi 的 claude 二进制随包
     * 分发、版本受控（≥ annotations 引入版本），无老 CLI 分支需要挡。
     */
    const renderActionBar = (primary: { label: string; onClick: () => void; disabled?: boolean }) => (
        <div style={{ marginTop: 12, display: 'flex', gap: 8, alignItems: 'stretch' }}>
            <Button
                variant="primary"
                loading={pendingAction === 'submit'}
                disabled={props.disabled || pendingAction != null || primary.disabled}
                onClick={primary.onClick}
                style={{ flex: 1, minHeight: actionMinHeight, justifyContent: 'center' }}
            >
                <CheckOutlined /> {pendingAction === 'submit' ? t('chat.tool.submitting') : primary.label}
            </Button>
            <Button
                variant="secondary"
                loading={pendingAction === 'chatAbout'}
                disabled={props.disabled || pendingAction != null}
                onClick={chatAbout}
                style={{ minHeight: actionMinHeight, justifyContent: 'center' }}
            >
                {t('chat.tool.askUserQuestion.chatAbout')}
            </Button>
        </div>
    )

    /**
     * 逐题主按钮（2026-10-28 形态定稿）：
     * - 非末题：已填 →「下一步」（前进）；未填 →「跳过」（同样前进，提交时该题自动标未答）
     * - 末题：已填 →「提交」；未填 →「跳过并提交」——同一 submit，提交时统一按
     *   有答案 → answers / 无答案 → annotations 分发
     */
    const renderQuestionAction = (idx: number) => {
        const isLast = idx === questions.length - 1
        const answered = isQuestionAnswered(idx)
        return renderActionBar({
            label: isLast
                ? (answered ? t('chat.tool.submit') : t('chat.tool.askUserQuestion.skipSubmit'))
                : (answered ? t('chat.tool.askUserQuestion.next') : t('chat.tool.askUserQuestion.skip')),
            onClick: isLast ? submit : () => { setError(null); setStep(idx + 1) },
        })
    }

    /** fallback 单文本框形态的提交行（questions 为空）：无题可标 skipped，恒要求非空 */
    const renderSubmitButton = () => renderActionBar({
        label: t('chat.tool.submit'),
        onClick: submit,
        disabled: fallbackText.trim().length === 0,
    })

    /**
     * 请求包装：清旧错误（setError null）+ pendingAction 管理 + 404 静默收起。
     * daemon 对「会话仍存活但 requestId 已被处理」返回 404 + code:'permission_request_gone'
     * （SSE 滞后/重复点击）→ 静默 onDone 自愈，不报错；其余 404 仍当真实失败提示。
     * 对齐 PermissionFooter.run。
     */
    const run = async (label: 'submit' | 'chatAbout', action: () => Promise<unknown>) => {
        if (props.disabled) return
        setError(null)
        setPendingAction(label)
        let handled = true
        try {
            await action()
        } catch (e) {
            const data = isAxiosError(e)
                ? (e.response?.data as { code?: string; error?: string } | undefined)
                : undefined
            const isHandled = isAxiosError(e)
                && e.response?.status === 404
                && (data?.code === 'permission_request_gone' || data?.error === 'Request not found')
            if (!isHandled) {
                setError(e instanceof Error ? e.message : t('chat.tool.requestFailed'))
                handled = false
            }
        } finally {
            setPendingAction(null)
        }
        if (!handled) return
        queryClient.invalidateQueries({ queryKey: queryKeys.session(props.sessionId) })
        props.onDone()
    }

    const submit = async () => {
        if (pendingAction) return

        const answers = collectAnswers(
            questions, selectedByQuestion, otherSelectedByQuestion, otherTextByQuestion, fallbackText
        )
        // 跳过标注（ask_user_question_unanswered_v1）：未答题不阻断提交，按题面文本标
        // skipped 让模型得知「跳过」而非被拒。mobi 的 claude 二进制随包分发、版本受控
        // （≥ annotations 引入版本），无老 CLI 分支——fallback 单文本框形态（questions
        // 为空）无题可标，仍要求非空
        if (questions.length === 0) {
            if (!answers['']?.length) {
                setError(t('chat.tool.selectOption'))
                return
            }
            await run('submit', () => props.api.permissions.approve(props.sessionId, permission.id, { answers }))
            return
        }

        const annotations = Object.fromEntries(
            questions
                .filter(q => !answers[q.question]?.length)
                .map(q => [q.question, { unanswered: 'skipped' as const }])
        )
        const body = Object.keys(annotations).length > 0 ? { answers, annotations } : { answers }
        await run('submit', () => props.api.permissions.approve(props.sessionId, permission.id, body))
    }

    /** 聊一聊：不提交答案，deny 带 seed 文案引导 Claude 主动反问 */
    const chatAbout = async () => {
        if (pendingAction) return

        const answers = collectAnswers(
            questions, selectedByQuestion, otherSelectedByQuestion, otherTextByQuestion, fallbackText
        )
        const reason = buildChatAboutThisReason(questions, answers)
        await run('chatAbout', () => props.api.permissions.deny(props.sessionId, permission.id, { reason }))
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
                padding: 10, borderRadius: 'var(--radius-control-sm)',
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
                            disabled={props.disabled || pendingAction != null}
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
                    disabled={props.disabled || pendingAction != null}
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
                        disabled={props.disabled || pendingAction != null}
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
                        disabled={props.disabled || pendingAction != null}
                        placeholder={t('chat.tool.askUserQuestion.placeholder')}
                        rows={4}
                        style={{ marginTop: 8 }}
                    />
                    {renderSubmitButton()}
                </div>
            ) : questions.length === 1 ? (
                /* 单题：直接展示选项，按钮文案随填写切换 */
                <div>
                    {renderQuestionOptions(0)}
                    {renderQuestionAction(0)}
                </div>
            ) : (
                /* 多题：页签条 + 每题一个面板。面板不 keepMounted——每题内容只是选项列表，
                   切走即卸载没有副作用，还省掉不活跃题目的 DOM */
                <TabStrip
                    value={String(step)}
                    onValueChange={(key) => { setError(null); setStep(Number(key)) }}
                >
                    <TabStripList
                        ariaLabel={t('chat.tool.askUserQuestion.title')}
                        // 页签行与下方动作按钮等高（原 antd tabBarStyle.minHeight，数值不变）
                        style={{ minHeight: actionMinHeight }}
                    >
                        {questions.map((q, idx) => (
                            <TabStripTab key={idx} value={String(idx)}>
                                {q.header || t('chat.tool.askUserQuestion.questionN', { n: idx + 1 })}
                            </TabStripTab>
                        ))}
                    </TabStripList>
                    {questions.map((_q, idx) => (
                        <TabStripPanel key={idx} value={String(idx)}>
                            {renderQuestionOptions(idx)}
                            {/* 每题都有前进按钮（末题兼提交行） */}
                            {renderQuestionAction(idx)}
                        </TabStripPanel>
                    ))}
                </TabStrip>
            )}
        </div>
    )
}

export const AskUserQuestionFooter = memo(AskUserQuestionFooterInner)
