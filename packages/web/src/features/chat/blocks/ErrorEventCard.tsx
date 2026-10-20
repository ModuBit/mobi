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

/**
 * 错误卡片（error-presentation）：分类 → 文案 → 动作三层由 shared 的
 * `presentError` 决策，本组件只执行呈现与交互。
 *
 * 原文策略（raw）：
 * - keep：原文直接铺在正文下方（额度/未知/非法请求这类「原文就是唯一线索」）
 * - describe：原文收进「详情」
 * - drop：正文不出现原文，详情里仍可查看（排障需要，但默认不吓人）
 */

import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { theme as antTheme } from 'antd'
import { ChevronDown, ChevronRight, CircleAlert, Copy, TriangleAlert } from 'lucide-react'
import {
    extractRequestId,
    extractResetAt,
    presentError,
    type ErrorAction,
    type ErrorContext,
    type NormalizedErrorEvent,
} from '@mobi/shared'
import { Button } from '@/ui/base/interactive/button/Button'

/** 动作 i18n 键（文案在 locales 的 chat.error.action.*） */
const ACTION_LABEL_KEYS: Record<ErrorAction, string> = {
    retry: 'chat.error.action.retry',
    rewind: 'chat.error.action.rewind',
    compact: 'chat.error.action.compact',
    resume: 'chat.error.action.resume',
    switchModel: 'chat.error.action.switchModel',
    newSession: 'chat.error.action.newSession',
    reauth: 'chat.error.action.reauth',
    copyDetails: 'chat.error.action.copyDetails',
}

/** 详情里的原文：字符串直出，对象转缩进 JSON（裁剪循环引用/超长值） */
export function formatErrorRaw(raw: unknown): string {
    if (raw == null) return ''
    if (typeof raw === 'string') return raw
    try {
        return JSON.stringify(raw, null, 2)
    } catch {
        return String(raw)
    }
}

export type ErrorEventCardProps = {
    event: NormalizedErrorEvent
    /** 缺省 = 只读展示（不出现动作按钮） */
    context?: ErrorContext
    onAction?: (action: ErrorAction) => void
    /** 事件产生时间（毫秒）；用于判断「N 秒后自动重试」是否已成为历史 */
    createdAt?: number
}

export function ErrorEventCard({ event, context, onAction, createdAt }: ErrorEventCardProps) {
    const { t } = useTranslation()
    const { token } = antTheme.useToken()
    const [detailsOpen, setDetailsOpen] = useState(false)
    const [copied, setCopied] = useState<'raw' | 'requestId' | null>(null)

    const presentation = presentError(
        event.category,
        context ?? {
            canRewind: false,
            canSend: true,
            sessionState: 'active',
            hasFallbackModel: false,
            hasWorkspace: false,
        },
    )
    // 压缩进行中：退化为进行态占位，不重复铺错误正文（票 02）
    if (event.category === 'context_length' && context?.compact?.pending) {
        return (
            <div
                role="status"
                style={{
                    display: 'flex', alignItems: 'center', gap: 6,
                    padding: '8px 12px', margin: '6px 0',
                    borderRadius: 'var(--radius-control-sm)',
                    background: token.colorBgContainer,
                    boxShadow: `inset 0 0 0 1px ${token.colorBorderSecondary}`,
                    fontSize: 12, color: token.colorTextSecondary,
                }}
            >
                <CircleAlert size={14} style={{ color: token.colorWarning, flexShrink: 0 }} aria-hidden />
                {t('chat.error.compacting')}
            </div>
        )
    }
    const severityColor = presentation.severity === 'warning' ? token.colorWarning : token.colorError
    const rawText = formatErrorRaw(event.raw)
    const requestId = extractRequestId(rawText) ?? extractRequestId(event.message)
    const resetAt = event.category === 'quota_exhausted' ? extractResetAt(event.message) : null
    // 重试倒计时只对「还没到点」的事件成立：历史消息（例如最终失败前最后一次 retry）
    // 若继续显示「N 秒后自动重试」会误导用户以为还有自动恢复
    const retryPending =
        event.retryInMs != null &&
        event.retryInMs > 0 &&
        (createdAt == null || Date.now() < createdAt + event.retryInMs)
    const retrySeconds = retryPending ? Math.ceil((event.retryInMs ?? 0) / 1000) : null
    const showInlineRaw = presentation.raw === 'keep' && event.message.trim().length > 0
    // copyDetails 由下方的「详情」开关承载，避免出现两个入口
    const visibleActions = presentation.actions.filter((action) => action !== 'copyDetails')

    const copy = async (kind: 'raw' | 'requestId', text: string) => {
        if (!navigator.clipboard) return
        try {
            await navigator.clipboard.writeText(text)
            setCopied(kind)
            setTimeout(() => setCopied((current) => (current === kind ? null : current)), 1500)
        } catch {
            // 剪贴板不可用（非安全上下文/权限拒绝）时静默——详情仍可手动选中复制
        }
    }

    return (
        <div
            role={presentation.severity === 'error' ? 'alert' : 'status'}
            style={{
                display: 'flex',
                flexDirection: 'column',
                gap: 6,
                padding: '10px 12px',
                margin: '6px 0',
                borderRadius: 'var(--radius-control-sm)',
                background: token.colorBgContainer,
                boxShadow: `inset 0 0 0 1px ${token.colorBorderSecondary}`,
                borderLeft: `3px solid ${severityColor}`,
            }}
        >
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                {presentation.severity === 'warning'
                    ? <TriangleAlert size={14} style={{ color: severityColor, flexShrink: 0 }} aria-hidden />
                    : <CircleAlert size={14} style={{ color: severityColor, flexShrink: 0 }} aria-hidden />}
                <div style={{ fontSize: 13, fontWeight: 600, color: token.colorText }}>
                    {t(presentation.titleKey)}
                </div>
                {event.attempt > 0 && event.maxRetries > 0 && (
                    <span style={{ fontSize: 11, color: token.colorTextTertiary }}>
                        {t('chat.error.attempt', { attempt: event.attempt, maxRetries: event.maxRetries })}
                    </span>
                )}
            </div>

            <div style={{ fontSize: 12, lineHeight: 1.5, color: token.colorTextSecondary }}>
                {t(presentation.bodyKey)}
            </div>

            {resetAt && (
                <div style={{ fontSize: 12, color: token.colorTextSecondary }}>
                    {t('chat.error.resetAt', { time: new Date(resetAt).toLocaleString() })}
                </div>
            )}
            {presentation.noteKey && (
                <div style={{ fontSize: 12, color: token.colorTextTertiary }}>
                    {t(presentation.noteKey)}
                </div>
            )}
            {context?.compact?.pending && (
                <div style={{ fontSize: 12, color: token.colorTextTertiary }}>
                    {t('chat.error.compacting')}
                </div>
            )}
            {retrySeconds != null && (
                <div style={{ fontSize: 12, color: token.colorTextTertiary }}>
                    {t('chat.error.retryIn', { seconds: retrySeconds })}
                </div>
            )}

            {showInlineRaw && (
                <div style={{
                    fontSize: 11,
                    fontFamily: 'var(--font-mono)',
                    color: token.colorTextSecondary,
                    whiteSpace: 'pre-wrap',
                    wordBreak: 'break-word',
                    maxHeight: 96,
                    overflow: 'auto',
                }}>
                    {event.message}
                </div>
            )}

            <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 6 }}>
                {onAction && context && visibleActions.map((action, index) => (
                    <Button
                        key={action}
                        size="sm"
                        variant={index === 0 ? 'primary' : 'secondary'}
                        onClick={() => { onAction(action) }}
                    >
                        {t(ACTION_LABEL_KEYS[action])}
                    </Button>
                ))}
                <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setDetailsOpen((open) => !open)}
                    aria-expanded={detailsOpen}
                >
                    {detailsOpen
                        ? <ChevronDown size={12} aria-hidden />
                        : <ChevronRight size={12} aria-hidden />}
                    {t('chat.error.details')}
                </Button>
            </div>

            {detailsOpen && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 2 }}>
                    {requestId && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11 }}>
                            <span style={{ color: token.colorTextTertiary }}>{t('chat.error.requestId')}</span>
                            <span style={{ fontFamily: 'var(--font-mono)', color: token.colorTextSecondary }}>{requestId}</span>
                            <Button size="sm" variant="ghost" onClick={() => void copy('requestId', requestId)}>
                                <Copy size={12} aria-hidden />
                                {copied === 'requestId' ? t('chat.error.copied') : t('chat.error.copy')}
                            </Button>
                        </div>
                    )}
                    {rawText && (
                        <>
                            <pre style={{
                                margin: 0,
                                padding: 8,
                                borderRadius: 'var(--radius-control-sm)',
                                background: token.colorFillQuaternary,
                                fontFamily: 'var(--font-mono)',
                                fontSize: 11,
                                lineHeight: 1.45,
                                color: token.colorTextSecondary,
                                whiteSpace: 'pre-wrap',
                                wordBreak: 'break-word',
                                maxHeight: 200,
                                overflow: 'auto',
                            }}>
                                {rawText}
                            </pre>
                            <div>
                                <Button size="sm" variant="ghost" onClick={() => void copy('raw', rawText)}>
                                    <Copy size={12} aria-hidden />
                                    {copied === 'raw' ? t('chat.error.copied') : t('chat.error.copyRaw')}
                                </Button>
                            </div>
                        </>
                    )}
                </div>
            )}
        </div>
    )
}
