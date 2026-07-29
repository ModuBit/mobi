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
import { keyframes } from '@emotion/react'
import type { ContextUsage } from '@mobi/shared'

/** >75% 临近压缩时透明度脉冲（不发光，纯透明度） */
const pulse = keyframes`0%,100%{opacity:1}50%{opacity:0.4}`

/** 三档警示色：<50% 蓝（健康）/ 50–75% 琥珀（注意）/ >75% 红（警示） */
function resolveTone(pct: number): 'info' | 'warning' | 'error' {
    if (pct >= 75) return 'error'
    if (pct >= 50) return 'warning'
    return 'info'
}

function formatK(tokens: number): string {
    return tokens >= 1000 ? `${Math.round(tokens / 1000)}k` : `${tokens}`
}

interface ContextUsageThreadProps {
    usage: ContextUsage
}

/**
 * 上下文用量线（composer 输入框上方，~10px 高）
 *
 * 视觉：2px 暗灰底线 + 已用段彩色（末 28px 自然 fade 融回底线）+ autoCompact 阈值刻度。
 * 右端数字点击在「百分比 / 已用 tokens」间切换。
 * 三档警示色随 percentage 变化，>75% 透明度脉冲提示「该压缩了」。
 * 详情（分类占用 / 距压缩剩余 / 成本）收进 SessionContextBar 展开态。
 *
 * 样式参照 .scratch/context-gauge/mockup.html 的 thread 线。
 */
export function ContextUsageThread({ usage }: ContextUsageThreadProps) {
    const { token } = theme.useToken()
    const [showTokens, setShowTokens] = useState(false)

    const pct = Math.max(0, Math.min(100, Math.round(usage.percentage)))
    const tone = resolveTone(pct)
    const danger = tone === 'error'
    const color = tone === 'error'
        ? token.colorError
        : tone === 'warning'
            ? token.colorWarning
            : token.colorInfo

    const threshold = usage.autoCompactThreshold
    const thresholdWarn = pct >= 50

    return (
        <div
            style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                padding: '2px 4px',
            }}
            title={`${usage.totalTokens.toLocaleString()} / ${usage.maxTokens.toLocaleString()} tokens${
                threshold !== undefined ? ` · 阈值 ${threshold}%` : ''
            }`}
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
                {/* autoCompact 阈值刻度（与线齐平的 1px 细纹） */}
                {threshold !== undefined && threshold > 0 && threshold <= 100 && (
                    <div
                        style={{
                            position: 'absolute',
                            top: 0,
                            bottom: 0,
                            width: 1,
                            left: `${threshold}%`,
                            background: thresholdWarn ? token.colorWarning : token.colorBorder,
                        }}
                    />
                )}
            </div>
            <span
                role="button"
                onClick={() => setShowTokens(s => !s)}
                title="点击切换 百分比 / 已用 tokens"
                style={{
                    fontFamily: 'var(--ant-font-family-code, ui-monospace, monospace)',
                    fontSize: 11,
                    fontWeight: 600,
                    color: tone === 'info' ? token.colorTextSecondary : color,
                    cursor: 'pointer',
                    userSelect: 'none',
                    fontVariantNumeric: 'tabular-nums',
                    minWidth: 34,
                    textAlign: 'right',
                    lineHeight: 1.4,
                }}
            >
                {showTokens ? formatK(usage.totalTokens) : `${pct}%`}
            </span>
        </div>
    )
}
