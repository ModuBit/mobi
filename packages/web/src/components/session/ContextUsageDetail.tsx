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

import { theme } from 'antd'
import type { ContextUsage } from '@mobi/shared'

/** SDK 未给 color 时的回退色板（消息/工具/系统/MCP/记忆/其他） */
const FALLBACK_PALETTE = ['#4d9eff', '#f0883e', '#a371f7', '#3fb950', '#d29922', '#6e7681']

function formatK(tokens: number): string {
    return tokens >= 1000 ? `${Math.round(tokens / 1000)}k` : `${tokens}`
}

/** SessionContextBar 展开态详情：大条 + 距压缩剩余 + 分类占用 + 成本 */
export function ContextUsageDetail({ usage }: { usage: ContextUsage }) {
    const { token } = theme.useToken()
    const pct = Math.round(usage.percentage)
    const threshold = usage.autoCompactThreshold
    const remaining = threshold !== undefined ? Math.max(0, threshold - pct) : null
    const remainingTokens = remaining !== null
        ? Math.round((usage.maxTokens * remaining) / 100)
        : null

    return (
        <div
            style={{
                borderTop: `1px solid ${token.colorBorderSecondary}`,
                padding: '12px 16px',
                fontSize: 11,
                color: token.colorTextSecondary,
                fontFamily: 'var(--ant-font-family-code, ui-monospace, monospace)',
            }}
        >
            {/* 用量读取行 */}
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                <span style={{ color: token.colorTextTertiary, letterSpacing: '0.06em' }}>上下文用量</span>
                <span>
                    {usage.totalTokens.toLocaleString()} / {usage.maxTokens.toLocaleString()} ·{' '}
                    <span style={{ color: token.colorText, fontWeight: 600 }}>{pct}%</span>
                </span>
            </div>

            {/* 大条：stacked categories（每段按 tokens/maxTokens 占比） */}
            <div
                style={{
                    position: 'relative',
                    height: 8,
                    background: token.colorBorderSecondary,
                    borderRadius: 3,
                    overflow: 'hidden',
                    display: 'flex',
                }}
            >
                {usage.categories.map((c, i) => (
                    <div
                        key={c.name}
                        title={`${c.name}: ${c.tokens.toLocaleString()} tokens`}
                        style={{
                            width: `${(c.tokens / usage.maxTokens) * 100}%`,
                            background: c.color ?? FALLBACK_PALETTE[i % FALLBACK_PALETTE.length],
                        }}
                    />
                ))}
                {threshold !== undefined && threshold > 0 && threshold <= 100 && (
                    <div
                        style={{
                            position: 'absolute',
                            top: -2,
                            bottom: -2,
                            width: 1,
                            left: `${threshold}%`,
                            background: token.colorWarning,
                        }}
                    />
                )}
            </div>

            {/* 距压缩剩余 */}
            {remaining !== null && remainingTokens !== null && usage.isAutoCompactEnabled && (
                <div
                    style={{
                        marginTop: 8,
                        padding: '6px 8px',
                        background: token.colorWarningBg,
                        borderLeft: `2px solid ${token.colorWarning}`,
                        borderRadius: 3,
                        color: token.colorText,
                    }}
                >
                    距自动压缩还剩 <b style={{ color: token.colorWarning }}>~{remaining}%</b>
                    （约 {remainingTokens.toLocaleString()} tokens · 阈值 {threshold}%）
                </div>
            )}

            {/* 分类占用表 */}
            <div style={{ marginTop: 8, display: 'grid', gap: 4 }}>
                {usage.categories.map((c, i) => {
                    const catPct = usage.totalTokens > 0
                        ? Math.round((c.tokens / usage.totalTokens) * 100)
                        : 0
                    return (
                        <div
                            key={c.name}
                            style={{
                                display: 'grid',
                                gridTemplateColumns: '10px 1fr 40px 56px',
                                gap: 8,
                                alignItems: 'center',
                            }}
                        >
                            <span style={{
                                width: 8,
                                height: 8,
                                borderRadius: 2,
                                background: c.color ?? FALLBACK_PALETTE[i % FALLBACK_PALETTE.length],
                            }} />
                            <span style={{ color: token.colorText }}>{c.name}</span>
                            <span style={{ textAlign: 'right' }}>{catPct}%</span>
                            <span style={{ textAlign: 'right', color: token.colorTextTertiary }}>
                                {formatK(c.tokens)}
                            </span>
                        </div>
                    )
                })}
            </div>

            {/* 成本 */}
            <div
                style={{
                    marginTop: 8,
                    paddingTop: 8,
                    borderTop: `1px dashed ${token.colorBorderSecondary}`,
                    display: 'flex',
                    justifyContent: 'space-between',
                }}
            >
                <span style={{ color: token.colorTextTertiary, letterSpacing: '0.06em' }}>会话成本</span>
                <span style={{ color: token.colorSuccess, fontWeight: 600 }}>
                    ${usage.costUsd.toFixed(4)}
                </span>
            </div>
        </div>
    )
}
