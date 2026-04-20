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

import type { ToolViewProps } from '@/components/tool-card/views/_all'
import {
    parseRequestUserInputInput,
    parseRequestUserInputAnswers
} from '@/domain/tool/requestUserInput'
import { theme as antTheme } from 'antd'

function getSelectionMark(isSelected: boolean): string {
    return isSelected ? '●' : '○'
}

function parseResultAsAnswers(result: unknown): unknown {
    // tool.result from history may be a JSON string
    if (typeof result === 'string') {
        try {
            return JSON.parse(result)
        } catch {
            return undefined
        }
    }
    return result
}

/**
 * RequestUserInput 工具视图
 */
export function RequestUserInputView(props: ToolViewProps) {
    const { token } = antTheme.useToken()
    const parsed = parseRequestUserInputInput(props.block.tool.input)
    const questions = parsed.questions
    // 优先使用 permission.answers（实时），回退到 tool.result（历史）
    const rawAnswers = props.block.tool.permission?.answers ?? parseResultAsAnswers(props.block.tool.result) ?? undefined
    const parsedAnswers = rawAnswers ? parseRequestUserInputAnswers(rawAnswers) : null
    const hasAnswers = parsedAnswers && Object.keys(parsedAnswers).length > 0

    if (questions.length === 0) {
        return null
    }

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {questions.map((q) => {
                const answer = parsedAnswers?.[q.id]
                const isPureTextQuestion = q.options.length === 0

                return (
                    <div
                        key={q.id}
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

                        {isPureTextQuestion ? (
                            // 纯文本问题 - 直接显示答案
                            hasAnswers && answer?.userNote ? (
                                <div style={{ marginTop: 12 }}>
                                    <div style={{
                                        borderRadius: 6,
                                        border: '1px solid #52c41a',
                                        background: '#f6ffed',
                                        padding: 8
                                    }}>
                                        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                                            <span style={{ flexShrink: 0, fontSize: 14, color: '#52c41a' }}>●</span>
                                            <div style={{ minWidth: 0, flex: 1 }}>
                                                <div style={{ fontSize: 14, color: '#237804', fontWeight: 500, wordBreak: 'break-word' }}>
                                                    {answer.userNote}
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            ) : null
                        ) : (
                            // 带选项的问题
                            <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 4 }}>
                                {q.options.map((opt, optIdx) => {
                                    const isSelected = answer?.selected === opt.label

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
                                                        {getSelectionMark(isSelected)}
                                                    </span>
                                                )}
                                                <div style={{ minWidth: 0, flex: 1 }}>
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
                                                </div>
                                            </div>
                                        </div>
                                    )
                                })}

                                {/* 显示用户备注（如果有） */}
                                {hasAnswers && answer?.userNote ? (
                                    <div style={{
                                        marginTop: 8,
                                        borderRadius: 6,
                                        border: '1px solid #69b1ff',
                                        background: '#e6f4ff',
                                        padding: 8
                                    }}>
                                        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                                            <span style={{ flexShrink: 0, fontSize: 12, color: '#1677ff' }}>📝</span>
                                            <div style={{ minWidth: 0, flex: 1 }}>
                                                <div style={{ fontSize: 12, color: token.colorTextSecondary }}>Note:</div>
                                                <div style={{ fontSize: 14, color: '#1677ff', wordBreak: 'break-word' }}>
                                                    {answer.userNote}
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                ) : null}
                            </div>
                        )}
                    </div>
                )
            })}
        </div>
    )
}
