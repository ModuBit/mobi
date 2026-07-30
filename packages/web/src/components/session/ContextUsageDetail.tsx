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

import { theme, Alert } from 'antd'
import { useTranslation } from 'react-i18next'
import type { ContextUsage } from '@mobi/shared'
import { formatTokens, thresholdPercent } from '@/core/lib/formatTokens'

/**
 * SDK categories 的 color 是 Claude 终端语义色板名（promptBorder / warning / inactive /
 * purple_FOR_SUBAGENTS_ONLY 等），**不是合法 CSS 色**——直接用作 background 会被浏览器
 * 忽略导致色块透明（进度条看着空）。只有当 color 形如 #hex / rgb() 时才采用，
 * 否则按索引回退到 FALLBACK_PALETTE。
 */
// SDK categories 的 color 是 Claude 终端语义色板名（promptBorder / warning / claude /
// inactive / *_FOR_SUBAGENTS_ONLY 等），**不是合法 CSS**。同一个色名每次稳定出现——
// 按色名映射到固定 CSS 色，保证分类颜色不随数组顺序/数量漂移（旧实现按索引回退，
// categories 增减会让同项颜色乱跳）。
const SDK_COLOR_MAP: Record<string, string> = {
    promptBorder: '#4d9eff',
    claude: '#d97757',
    warning: '#d29922',
    inactive: '#6e7681',
    success: '#3fb950',
    error: '#f85149',
    cyan_FOR_SUBAGENTS_ONLY: '#39c5cf',
    purple_FOR_SUBAGENTS_ONLY: '#a371f7',
}
const CSS_COLOR_RE = /^#[0-9a-fA-F]{3,8}$|^rgb/i
const FALLBACK_PALETTE = ['#4d9eff', '#f0883e', '#a371f7', '#3fb950', '#d29922', '#6e7681']

function hashStr(s: string): number {
    let h = 0
    for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0
    return Math.abs(h)
}

function resolveColor(color: string | undefined): string {
    if (!color) return FALLBACK_PALETTE[0]
    if (CSS_COLOR_RE.test(color)) return color // 已是合法 CSS（测试/自定义）
    if (SDK_COLOR_MAP[color]) return SDK_COLOR_MAP[color] // SDK 语义色名 → 固定色
    // 未知色名：按色名 hash 稳定取调色板（不依赖数组索引）
    return FALLBACK_PALETTE[hashStr(color) % FALLBACK_PALETTE.length]
}

/** Free space 是「剩余空间」而非占用——SDK 给它的色名（如 promptBorder）常与其它项撞色，
 *  且语义上应为「空」。单独识别，大条里留空显底色、分类表用虚线灰块，占用项才上彩色。 */
const FREE_SPACE_RE = /free\s*space/i
const isFreeSpace = (name: string): boolean => FREE_SPACE_RE.test(name)

/** SessionContextBar 展开态详情：大条 + 距压缩剩余 + 分类占用 + 成本 */
export function ContextUsageDetail({ usage }: { usage: ContextUsage }) {
    const { t } = useTranslation()
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
                padding: '12px 16px',
                fontSize: 11,
                color: token.colorTextSecondary,
                fontFamily: 'var(--ant-font-family-code, ui-monospace, monospace)',
            }}
        >
            {/* 用量读取行 */}
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                <span style={{ color: token.colorTextTertiary, letterSpacing: '0.06em' }}>{t('session.contextUsage.usage')}</span>
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
                {usage.categories.map((c, i) => {
                    // Free space 不画彩色段——它是剩余空间，留底色表示「空」，占用项彩色堆叠凸显
                    if (isFreeSpace(c.name)) return null
                    return (
                        <div
                            key={`${c.name}-${i}`}
                            title={`${c.name}: ${c.tokens.toLocaleString()} tokens`}
                            style={{
                                width: `${(c.tokens / usage.maxTokens) * 100}%`,
                                background: resolveColor(c.color),
                            }}
                        />
                    )
                })}
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
                <Alert
                    type={overThreshold ? 'error' : 'warning'}
                    showIcon
                    style={{ marginTop: 8 }}
                    message={overThreshold
                        ? t('session.contextUsage.compactReached', { pct: Math.round(thresholdPct) })
                        : t('session.contextUsage.compactRemaining', { pct: remainingPct })}
                    description={overThreshold
                        ? t('session.contextUsage.compactReachedDesc')
                        : t('session.contextUsage.compactRemainingDesc', {
                            tokens: formatTokens(remainingTokens),
                            threshold: Math.round(thresholdPct),
                        })}
                />
            )}

            {/* 分类占用表：catPct 按 maxTokens（categories 之和=maxTokens，故各项加起来=100%） */}
            <div style={{ marginTop: 8, display: 'grid', gap: 4 }}>
                {usage.categories.map((c, i) => {
                    const catPct = usage.maxTokens > 0
                        ? Math.round((c.tokens / usage.maxTokens) * 100)
                        : 0
                    const free = isFreeSpace(c.name)
                    return (
                        <div
                            key={`${c.name}-${i}`}
                            style={{
                                display: 'grid',
                                gridTemplateColumns: '10px 1fr 40px 56px',
                                gap: 8,
                                alignItems: 'center',
                            }}
                        >
                            <span
                                data-cat={c.name}
                                style={{
                                    width: 8,
                                    height: 8,
                                    borderRadius: 2,
                                    background: free ? 'transparent' : resolveColor(c.color),
                                    border: free ? `1px dashed ${token.colorBorder}` : 'none',
                                    boxSizing: 'border-box',
                                }}
                            />
                            <span style={{ color: free ? token.colorTextTertiary : token.colorText }}>{c.name}</span>
                            <span style={{ textAlign: 'right', color: free ? token.colorTextQuaternary : undefined }}>{catPct}%</span>
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
                <span style={{ color: token.colorTextTertiary, letterSpacing: '0.06em' }}>{t('session.contextUsage.cost')}</span>
                <span style={{ color: token.colorSuccess, fontWeight: 600 }}>
                    ${usage.costUsd.toFixed(4)}
                </span>
            </div>
        </div>
    )
}
