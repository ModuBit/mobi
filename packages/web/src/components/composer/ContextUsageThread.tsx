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

import { useState } from 'react'
import { theme } from 'antd'
import { useTranslation } from 'react-i18next'
import { keyframes } from '@emotion/react'
import type { ContextUsage } from '@mobi/shared'
import { formatTokens } from '@/core/lib/formatTokens'

/** >75% 临近上限时透明度脉冲（不发光，纯透明度） */
const pulse = keyframes`0%,100%{opacity:1}50%{opacity:0.4}`

/** 三档警示色：<50% 蓝（健康）/ 50–75% 琥珀（注意）/ >75% 红（警示） */
function resolveTone(pct: number): 'info' | 'warning' | 'error' {
    if (pct >= 75) return 'error'
    if (pct >= 50) return 'warning'
    return 'info'
}

interface ContextUsageThreadProps {
    usage: ContextUsage
}

/**
 * 上下文用量线（composer 输入框上方，~10px 高）
 *
 * 视觉：2px 暗灰底线 + 已用段彩色（末 28px 自然 fade 融回底线）。
 * 右端数字点击在「百分比 / 已用 tokens」间切换。
 * 三档警示色随 percentage 变化，>75% 透明度脉冲提示「该压缩了」。
 * 详情（距窗口上限剩余 / 成本）收进 SessionContextBar 展开态。
 *
 * 数据完全由 SDK 消息流派生（无 getContextUsage 的 count_tokens 开销）：
 * totalTokens = 最后一条 assistant 的 input+cache_creation+cache_read（当前占用），
 * maxTokens = result.modelUsage[model].contextWindow（窗口大小）。
 */
export function ContextUsageThread({ usage }: ContextUsageThreadProps) {
    const { t } = useTranslation()
    const { token } = theme.useToken()
    const [showTokens, setShowTokens] = useState(true)

    const pct = Math.max(0, Math.min(100, Math.round(usage.percentage)))
    const tone = resolveTone(pct)
    const danger = tone === 'error'
    const color = tone === 'error'
        ? token.colorError
        : tone === 'warning'
            ? token.colorWarning
            : token.colorInfo
    const remaining = Math.max(0, usage.maxTokens - usage.totalTokens)

    return (
        <div
            style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                padding: '2px 4px',
            }}
            title={`${usage.totalTokens.toLocaleString()} / ${usage.maxTokens.toLocaleString()} tokens · ${t('session.contextUsage.remaining', { tokens: formatTokens(remaining) })}`}
        >
            <div
                style={{
                    position: 'relative',
                    flex: 1,
                    height: 2,
                    background: token.colorBorderSecondary,
                }}
            >
                {/* 已用段：彩色，末 28px fade 融回底线 */}
                <div
                    style={{
                        position: 'absolute',
                        left: 0,
                        top: 0,
                        bottom: 0,
                        width: `${pct}%`,
                        background: `linear-gradient(90deg, ${color}, ${color} calc(100% - 28px), transparent)`,
                        animation: danger ? `${pulse} 1.3s ease-in-out infinite` : undefined,
                    }}
                />
            </div>
            <span
                role="button"
                onClick={() => setShowTokens(s => !s)}
                title={t('session.contextUsage.toggleHint')}
                style={{
                    fontFamily: 'var(--ant-font-family-code, ui-monospace, monospace)',
                    fontSize: 11,
                    fontWeight: 600,
                    color: tone === 'info' ? token.colorTextSecondary : color,
                    cursor: 'pointer',
                    userSelect: 'none',
                    fontVariantNumeric: 'tabular-nums',
                    minWidth: 60,
                    textAlign: 'right',
                    lineHeight: 1.4,
                }}
            >
                {showTokens ? `${formatTokens(usage.totalTokens)}/${formatTokens(usage.maxTokens)}` : `${pct}%`}
            </span>
        </div>
    )
}
