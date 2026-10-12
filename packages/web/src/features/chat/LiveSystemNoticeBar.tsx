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

import { memo, useState } from 'react'
import { theme as antTheme } from 'antd'
import { useTranslation } from 'react-i18next'
import { TriangleAlert, ChevronDown, ChevronUp, X } from 'lucide-react'
import { useLiveNotice, useLiveNoticeStore } from '@/core/data/stores/liveNoticeStore'

/**
 * 实时系统提示横幅（02 票）：informational warning 的 SSE 实时到达提示。
 * 挂在 ChatPane 的 PageHeader 之下——「实时事件通知」语义的承载形态：
 * - 单 slot（新提示覆盖旧的）；✕ 关闭 = 清内存 slot，刷新页面即消失（不落任何持久状态）
 * - 一行摘要 + 点击展开全文（mockup：
 *   .mobi/artifacts/2026-09/system-informational-banner-mockup.html）
 * - 色值走主题 warning token（light/dark 双档由算法各自提供，组件不硬编码）；
 *   正文为 CC 原文原样显示不翻译
 */
export const LiveSystemNoticeBar = memo(function LiveSystemNoticeBar({ sessionId }: { sessionId: string }) {
    const { t } = useTranslation()
    const { token } = antTheme.useToken()
    const notice = useLiveNotice(sessionId)
    const dismiss = useLiveNoticeStore((s) => s.dismissLiveNotice)
    // 展开态是纯查看态：提示被覆盖/关闭即随组件卸载重置，无需按消息 id 记忆
    const [expanded, setExpanded] = useState(false)

    if (!notice) return null

    return (
        <div
            data-testid="live-system-notice"
            style={{
                background: token.colorWarningBg,
                borderBottom: `1px solid ${token.colorWarningBorder}`,
            }}
        >
            <div
                role={expanded ? undefined : 'button'}
                aria-expanded={expanded}
                onClick={() => setExpanded((v) => !v)}
                style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    padding: '6px 12px',
                    cursor: expanded ? 'default' : 'pointer',
                    color: token.colorWarningText,
                }}
            >
                <TriangleAlert size={13} style={{ flexShrink: 0, color: token.colorWarning }} aria-hidden />
                <span
                    style={{
                        fontSize: 12,
                        fontWeight: 500,
                        flexShrink: 0,
                    }}
                >
                    {t('chat.liveNotice.title')}
                </span>
                {!expanded && (
                    <span
                        style={{
                            fontSize: 12,
                            flex: 1,
                            minWidth: 0,
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                            opacity: 0.85,
                        }}
                    >
                        {notice.content}
                    </span>
                )}
                <span style={{ flex: expanded ? 1 : 0 }} />
                {!expanded ? (
                    <ChevronDown size={13} style={{ flexShrink: 0, opacity: 0.7 }} aria-hidden />
                ) : (
                    <ChevronUp size={13} style={{ flexShrink: 0, opacity: 0.7 }} aria-hidden />
                )}
                <button
                    type="button"
                    aria-label={t('chat.liveNotice.dismiss')}
                    onClick={(e) => {
                        // 不触发外层展开/收起切换
                        e.stopPropagation()
                        dismiss(sessionId)
                    }}
                    style={{
                        border: 'none',
                        background: 'transparent',
                        padding: 2,
                        cursor: 'pointer',
                        color: 'inherit',
                        opacity: 0.55,
                        display: 'flex',
                    }}
                >
                    <X size={13} aria-hidden />
                </button>
            </div>
            {expanded && (
                <div
                    style={{
                        padding: '2px 33px 10px',
                        fontSize: 12,
                        lineHeight: 1.65,
                        color: token.colorWarningText,
                        whiteSpace: 'pre-wrap',
                        wordBreak: 'break-word',
                        fontFamily: 'var(--font-mono)',
                    }}
                >
                    {notice.content}
                </div>
            )}
        </div>
    )
})
