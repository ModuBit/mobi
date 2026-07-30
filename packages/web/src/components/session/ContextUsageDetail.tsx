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
import { formatTokens, thresholdPercent } from '@/core/lib/formatTokens'

/**
 * SDK categories 的 color 是 Claude 终端语义色板名（promptBorder / warning / inactive /
 * purple_FOR_SUBAGENTS_ONLY 等），**不是合法 CSS 色**——直接用作 background 会被浏览器
 * 忽略导致色块透明（进度条看着空）。只有当 color 形如 #hex / rgb() 时才采用，
 * 否则按索引回退到 FALLBACK_PALETTE。
 */
const FALLBACK_PALETTE = ['#4d9eff', '#f0883e', '#a371f7', '#3fb950', '#d29922', '#6e7681']
const CSS_COLOR_RE = /^#[0-9a-fA-F]{3,8}$|^rgb/i
function resolveColor(color: string | undefined, i: number): string {
    return color && CSS_COLOR_RE.test(color) ? color : FALLBACK_PALETTE[i % FALLBACK_PALETTE.length]
}

/** SessionContextBar 展开态详情：大条 + 距压缩剩余 + 分类占用 + 成本 */
export function ContextUsageDetail({ usage }: { usage: ContextUsage }) {
    const { token } = theme.useToken()
    const pct = Math.round(usage.percentage)
    // SDK autoCompactThreshold 是 token 阈值数，换算成占 maxTokens 的百分比（@/core/lib/formatTokens）
    const thresholdPct = thresholdPercent(usage)
    // 距压缩剩余用 token 差值（绝对值准确），再换算成百分比。
    // remainingTokens/remainingPct 用 0 兜底，仅当 thresholdPct !== null（有阈值）时块才渲染
    const remainingTokens = usage.autoCompactThreshold !== undefined
        ? usage.autoCompactThreshold - usage.totalTokens
        : 0
    const remainingPct = thresholdPct !== null ? Math.max(0, Math.round(thresholdPct - pct)) : 0
    const overThreshold = remainingTokens <= 0

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
                    {formatTokens(usage.totalTokens)} / {formatTokens(usage.maxTokens)} ·{' '}
                    <span style={{ color: token.colorText, fontWeight: 600 }}>{pct}%</span>
                </span>
            </div>

            {/* 大条：stacked categories（每段按 tokens/maxTokens 占比，加起来=100%） */}
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
                            background: resolveColor(c.color, i),
                        }}
                    />
                ))}
                {thresholdPct !== null && thresholdPct > 0 && thresholdPct <= 100 && (
                    <div
                        style={{
                            position: 'absolute',
                            top: -2,
                            bottom: -2,
                            width: 1,
                            left: `${thresholdPct}%`,
                            background: token.colorWarning,
                        }}
                    />
                )}
            </div>

            {/* 距压缩剩余 / 已超阈值（autoCompact 启用且有阈值时才展示） */}
            {thresholdPct !== null && usage.isAutoCompactEnabled && (
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
                    {overThreshold ? (
                        <>
                            <b style={{ color: token.colorWarning }}>已达自动压缩阈值</b>
                            （{Math.round(thresholdPct)}%）· 下次轮次可能触发压缩
                        </>
                    ) : (
                        <>
                            距自动压缩还剩 <b style={{ color: token.colorWarning }}>~{remainingPct}%</b>
                            （约 {formatTokens(remainingTokens)} tokens · 阈值 {Math.round(thresholdPct)}%）
                        </>
                    )}
                </div>
            )}

            {/* 分类占用表：catPct 按 maxTokens（categories 之和=maxTokens，故各项加起来=100%） */}
            <div style={{ marginTop: 8, display: 'grid', gap: 4 }}>
                {usage.categories.map((c, i) => {
                    const catPct = usage.maxTokens > 0
                        ? Math.round((c.tokens / usage.maxTokens) * 100)
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
                                background: resolveColor(c.color, i),
                            }} />
                            <span style={{ color: token.colorText }}>{c.name}</span>
                            <span style={{ textAlign: 'right' }}>{catPct}%</span>
                            <span style={{ textAlign: 'right', color: token.colorTextTertiary }}>
                                {formatTokens(c.tokens)}
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
