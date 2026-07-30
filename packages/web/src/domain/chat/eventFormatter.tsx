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
import { useState } from 'react'
import { theme } from 'antd'
import { useTranslation } from 'react-i18next'
import { formatMessageTime } from '@/core/utils/timeFormat'
import { formatTokens } from '@/core/lib/formatTokens'
import type { AgentEvent } from './types'

/** 毫秒 → 可读时长（turn 概要与详情共用，避免两处公式偏移） */
function formatDurationMs(ms: number): string {
    if (ms >= 60000) {
        const min = Math.floor(ms / 60000)
        const sec = Math.floor((ms % 60000) / 1000)
        return `${min}m ${sec}s`
    }
    if (ms >= 1000) return `${(ms / 1000).toFixed(1)}s`
    return `${ms}ms`
}

/** token 数 → 「N tokens / Nk tokens」概要串 */
function formatTokensCount(tokens: number): string {
    return tokens >= 1000 ? `${(tokens / 1000).toFixed(1)}k tokens` : `${tokens} tokens`
}

type TurnResultEvent = Extract<AgentEvent, { type: 'turn-result' }>

/** 详情表单行：label 左、value 右（tabular-nums 对齐） */
function DetailRow({ label, value }: { label: string; value: string | number }) {
    const { token } = theme.useToken()
    return (
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, padding: '2px 0' }}>
            <span style={{ color: token.colorTextTertiary }}>{label}</span>
            <span style={{ color: token.colorText, fontVariantNumeric: 'tabular-nums' }}>{value}</span>
        </div>
    )
}

/**
 * turn 结束概要（可折叠）。收起态保持「duration · N tokens · time」一行概要，
 * 展开态显示 result 完整详情（耗时/首 token/轮次/模型/成本/token 细分）。
 * 数据全部来自 CLI 透传的 result 消息，零额外采集。
 *
 * 本地命令（/usage /cost /help 等不调主模型的指令）result.usage 为 0 → tokens===0：
 * 只显示「duration · time」，不显示 token 数、不可展开（反正也没有 token 细分）。
 * 判据是 tokens===0 这个数据特征，不维护命令清单。
 */
function TurnResultMeta({ event, createdAt }: { event: TurnResultEvent; createdAt?: number }) {
    const { t } = useTranslation()
    const { token } = theme.useToken()
    const [open, setOpen] = useState(false)
    const dur = formatDurationMs(event.durationMs)
    const time = createdAt ? formatMessageTime(createdAt) : null
    // 无 LLM 调用的本地命令：tokens===0，精简显示（只耗时+时间），不可展开
    const noTokens = event.tokens === 0
    const hasDetail = !noTokens && (event.numTurns != null || event.ttftMs !== undefined || event.costUsd !== undefined
        || event.inputTokens !== undefined || event.model !== undefined
        || event.cacheReadTokens !== undefined || event.cacheCreationTokens !== undefined)

    return (
        <div style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: token.colorTextTertiary }}>
            <span
                {...(hasDetail ? { role: 'button' as const, onClick: () => setOpen(o => !o) } : {})}
                style={{ cursor: hasDetail ? 'pointer' : 'default', userSelect: 'none' }}
            >
                {hasDetail && <span style={{ display: 'inline-block', width: '1em' }}>{open ? '▾' : '▸'}</span>}
                {dur}{!noTokens && <> · {formatTokensCount(event.tokens)}</>}
                {time && <span style={{ marginLeft: 8 }}>{time}</span>}
            </span>
            {hasDetail && (
                <div
                    style={{
                        display: 'grid',
                        gridTemplateRows: open ? '1fr' : '0fr',
                        opacity: open ? 1 : 0,
                        transition: 'grid-template-rows 0.22s ease, opacity 0.22s ease',
                    }}
                >
                    <div style={{ overflow: 'hidden' }}>
                        <div style={{ marginTop: 6, padding: '6px 10px', borderLeft: `2px solid ${token.colorBorderSecondary}`, marginLeft: '1em' }}>
                            <DetailRow label={t('chat.turnDetail.duration')} value={dur} />
                            {event.ttftMs !== undefined && <DetailRow label={t('chat.turnDetail.ttft')} value={formatDurationMs(event.ttftMs)} />}
                            {event.numTurns != null && <DetailRow label={t('chat.turnDetail.turns')} value={event.numTurns} />}
                            {event.model && <DetailRow label={t('chat.turnDetail.model')} value={event.model} />}
                            {event.costUsd !== undefined && <DetailRow label={t('chat.turnDetail.cost')} value={`$${event.costUsd.toFixed(4)}`} />}
                            {event.inputTokens !== undefined && <DetailRow label={t('chat.turnDetail.input')} value={formatTokens(event.inputTokens)} />}
                            {event.outputTokens !== undefined && <DetailRow label={t('chat.turnDetail.output')} value={formatTokens(event.outputTokens)} />}
                            {event.cacheReadTokens !== undefined && <DetailRow label={t('chat.turnDetail.cacheRead')} value={formatTokens(event.cacheReadTokens)} />}
                            {event.cacheCreationTokens !== undefined && <DetailRow label={t('chat.turnDetail.cacheWrite')} value={formatTokens(event.cacheCreationTokens)} />}
                        </div>
                    </div>
                </div>
            )}
            {event.error && (
                <div style={{ marginTop: 2, color: 'rgba(255, 77, 79, 0.63)', fontFamily: 'var(--font-sans)' }}>
                    {event.error}
                </div>
            )}
        </div>
    )
}

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
            return <TurnResultMeta event={event as TurnResultEvent} createdAt={createdAt} />
        }
        default:
            return null
    }
}
