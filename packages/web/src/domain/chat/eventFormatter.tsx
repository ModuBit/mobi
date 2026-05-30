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

import type React from 'react'
import { formatMessageTime } from '@/core/utils/timeFormat'

/** 从嵌套 error 对象中提取错误详情 */
export function extractApiErrorDetail(error: unknown): string | null {
    if (!error || typeof error !== 'object') return null
    const err = error as Record<string, unknown>
    if (err.error && typeof err.error === 'object') {
        const inner = err.error as Record<string, unknown>
        if (inner.error && typeof inner.error === 'object') {
            const deepest = inner.error as Record<string, unknown>
            const code = typeof deepest.code === 'string' ? deepest.code : ''
            const message = typeof deepest.message === 'string' ? deepest.message : ''
            if (code || message) return `${code ? `[${code}] ` : ''}${message}`
        }
    }
    return null
}

/** 格式化 Agent 事件为可渲染内容 */
export function formatEvent(
    event: { type: string; [key: string]: unknown },
    t: (key: string, params?: Record<string, unknown>) => string,
    createdAt?: number,
): React.ReactNode {
    switch (event.type) {
        case 'api-retry': {
            const attempt = Number(event.attempt) || 0
            const maxRetries = Number(event.maxRetries) || 0
            const delaySec = Math.ceil((Number(event.retryDelayMs) || 0) / 1000)
            const errorStatus = Number(event.errorStatus) || 0
            const errorLabel = errorStatus === 429 ? t('chat.apiRateLimit') : t('chat.apiError')
            return (
                <div>
                    <div>{errorLabel}{attempt > 0 ? ` (${t('chat.retry')} ${attempt}/${maxRetries})` : ''}</div>
                    {delaySec > 0 && <div style={{ marginTop: 2 }}>{t('chat.retryDelay', { seconds: delaySec })}</div>}
                </div>
            )
        }
        case 'api-error': {
            const detail = extractApiErrorDetail(event.error)
            const retryAttempt = Number(event.retryAttempt) || 0
            const maxRetries = Number(event.maxRetries) || 0
            return (
                <div>
                    <div>{t('chat.apiError')}{retryAttempt > 0 ? ` (${t('chat.retry')} ${retryAttempt}/${maxRetries})` : ''}</div>
                    {detail && <div style={{ marginTop: 2 }}>{detail}</div>}
                </div>
            )
        }
        case 'turn-duration': {
            const ms = Number(event.durationMs) || 0
            if (ms >= 60000) {
                const min = Math.floor(ms / 60000)
                const sec = Math.floor((ms % 60000) / 1000)
                return t('chat.durationValue', { value: `${min}m ${sec}s` })
            }
            if (ms >= 1000) {
                return t('chat.durationValue', { value: `${(ms / 1000).toFixed(1)}s` })
            }
            return t('chat.durationValue', { value: `${ms}ms` })
        }
        case 'switch': {
            const mode = String(event.mode || '')
            return t('chat.switchMode', { mode })
        }
        case 'aborted': {
            const durationMs = Number(event.durationMs) || 0
            const tokens = Number(event.tokens) || 0
            const hasMetrics = durationMs > 0 || tokens > 0

            const parts: string[] = [t('chat.aborted')]
            if (hasMetrics) {
                let durationText: string
                if (durationMs >= 60000) {
                    const min = Math.floor(durationMs / 60000)
                    const sec = Math.floor((durationMs % 60000) / 1000)
                    durationText = `${min}m ${sec}s`
                } else if (durationMs >= 1000) {
                    durationText = `${(durationMs / 1000).toFixed(1)}s`
                } else {
                    durationText = `${durationMs}ms`
                }
                const tokensText = tokens >= 1000
                    ? `${(tokens / 1000).toFixed(1)}k tokens`
                    : `${tokens} tokens`
                parts.push(durationText, tokensText)
            }

            const time = createdAt ? formatMessageTime(createdAt) : null

            return (
                <div style={{ fontFamily: 'var(--font-mono)' }}>
                    {parts.join(' · ')}
                    {time && <span style={{ marginLeft: 8 }}>{time}</span>}
                </div>
            )
        }
        case 'title-changed': {
            return null
        }
        case 'plan-mode-entered': {
            return t('chat.planMode.entered')
        }
        case 'plan-mode-enter-failed': {
            return t('chat.planMode.enterFailed')
        }
        case 'turn-result': {
            const durationMs = Number(event.durationMs) || 0
            const tokens = Number(event.tokens) || 0
            const error = typeof event.error === 'string' ? event.error : null

            let durationText: string
            if (durationMs >= 60000) {
                const min = Math.floor(durationMs / 60000)
                const sec = Math.floor((durationMs % 60000) / 1000)
                durationText = `${min}m ${sec}s`
            } else if (durationMs >= 1000) {
                durationText = `${(durationMs / 1000).toFixed(1)}s`
            } else {
                durationText = `${durationMs}ms`
            }

            const tokensText = tokens >= 1000
                ? `${(tokens / 1000).toFixed(1)}k tokens`
                : `${tokens} tokens`

            const time = createdAt ? formatMessageTime(createdAt) : null

            return (
                <div style={{ fontFamily: 'var(--font-mono)' }}>
                    {durationText} · {tokensText}
                    {time && <span style={{ marginLeft: 8 }}>{time}</span>}
                    {error && (
                        <div style={{
                            marginTop: 2,
                            color: 'rgba(255, 77, 79, 0.63)',
                            fontFamily: 'var(--font-sans)',
                        }}>
                            {error}
                        </div>
                    )}
                </div>
            )
        }
        default:
            return null
    }
}
