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
import type { ContextUsage, ContextUsageCategoryKey } from '@mobi/shared'
import { formatTokens } from '@/core/lib/formatTokens'

/** 方格网列数（20 × 5 = 100 格） */
const GRID_COLUMNS = 20
/** 方格网总格数（= 上下文窗口的 100%） */
const TOTAL_CELLS = 100

/**
 * 类目元数据：显示名 + light/dark 两套色（dataviz 校验过的定稿色板）。
 * key 序 = CC 实现序，渲染顺序直接跟随 breakdown.categories 给定序，不自行重排。
 */
const CATEGORY_META: Record<ContextUsageCategoryKey, { label: string; light: string; dark: string }> = {
    systemPrompt: { label: 'System prompt', light: '#4f66e0', dark: '#4a5ed0' },
    systemTools: { label: 'System tools', light: '#0aa2c0', dark: '#1fa0b8' },
    mcpTools: { label: 'MCP tools', light: '#8a4fe8', dark: '#ad72e4' },
    memoryFiles: { label: 'Memory files', light: '#4784c8', dark: '#3f74b8' },
    skills: { label: 'Skills', light: '#23a572', dark: '#2fae74' },
    messages: { label: 'Messages', light: '#e0662e', dark: '#d8743a' },
}

/** 可展开逐项明细的类目（逐 server / 逐 skill / 逐 memory 文件） */
const EXPANDABLE_KEYS = new Set<ContextUsageCategoryKey>(['mcpTools', 'memoryFiles', 'skills'])

/**
 * 主题暗色判定：antd useToken 无显式 mode，按 colorBgBase 十六进制 RGB 均值 <128 判暗色。
 * mobi 两主题底色 #faf9f5 / #141413，均值分别 ~249 / ~20，判定稳健。
 */
function isDarkBackground(colorBgBase: string): boolean {
    const m = /^#?([0-9a-f]{6})$/i.exec(colorBgBase.trim())
    if (!m) return false
    const n = Number.parseInt(m[1], 16)
    const avg = (((n >> 16) & 0xff) + ((n >> 8) & 0xff) + (n & 0xff)) / 3
    return avg < 128
}

/** 类目/明细色点的视觉语言：淡底 + 45° 斜纹 + 描边（与方格格一致） */
function stripeDotStyle(color: string, angle: 45 | 135 = 45): React.CSSProperties {
    return {
        width: 9,
        height: 9,
        borderRadius: 2,
        flexShrink: 0,
        backgroundColor: `${color}29`,
        backgroundImage: `repeating-linear-gradient(${angle}deg, ${color} 0 1.5px, transparent 1.5px 4px)`,
        boxShadow: `inset 0 0 0 1px ${color}99`,
    }
}

/**
 * 上下文水位类目细分（水位 Popover 内展示）：
 * - 20×5 方格网（waffle）：类目按占比占格、free 兜底补齐、buffer 反向斜纹殿后
 * - 类目列表：色点 + label + token + 百分比；MCP tools / Memory files / Skills 可展开逐项明细
 * - breakdown 缺省（旧 CLI / local 模式）整体渲染 null，由挂载方兜底
 */
export function ContextBreakdown({ usage }: { usage: ContextUsage }) {
    const { token } = theme.useToken()
    const [expanded, setExpanded] = useState<Set<ContextUsageCategoryKey>>(new Set())

    const breakdown = usage.breakdown
    if (!breakdown) return null

    const isDark = isDarkBackground(token.colorBgBase)
    const neutral = isDark ? '#5e5d59' : '#b0aea5'
    const max = usage.maxTokens > 0 ? usage.maxTokens : 1 // 防 0 除

    /** 百分比文本：Math.round 取整 */
    const pct = (tokens: number) => `${Math.round((tokens / max) * 100)}%`

    /** 格数分配：有占用至少 1 格，否则按占比四舍五入 */
    const cellCount = (tokens: number) => Math.max(tokens > 0 ? 1 : 0, Math.round((tokens / max) * TOTAL_CELLS))

    const hasBuffer = breakdown.autocompactBufferTokens != null
    const categoryCounts = breakdown.categories.map((c) => cellCount(c.tokens))
    const bufferCount = hasBuffer ? cellCount(breakdown.autocompactBufferTokens!) : 0
    const usedCells = categoryCounts.reduce((a, b) => a + b, 0) + bufferCount
    // free 格兜底补齐到 100（类目四舍五入误差由 free 吸收）
    const freeCells = Math.max(0, TOTAL_CELLS - usedCells)

    const toggle = (key: ContextUsageCategoryKey) => {
        setExpanded((prev) => {
            const next = new Set(prev)
            if (next.has(key)) next.delete(key)
            else next.add(key)
            return next
        })
    }

    /** 方格单元格样式（类目色 / free 空心 / buffer 中性反向斜纹） */
    const cellStyle = (kind: 'category' | 'free' | 'buffer', color?: string): React.CSSProperties => {
        const base: React.CSSProperties = {
            aspectRatio: '1',
            borderRadius: 2,
        }
        if (kind === 'free') {
            return { ...base, border: '1px solid rgba(128,128,128,0.3)' }
        }
        const c = kind === 'buffer' ? neutral : color!
        const angle = kind === 'buffer' ? 135 : 45
        return {
            ...base,
            backgroundColor: `${c}29`,
            backgroundImage: `repeating-linear-gradient(${angle}deg, ${c} 0 1.5px, transparent 1.5px 4px)`,
            boxShadow: `inset 0 0 0 1px ${c}99`,
        }
    }

    // 渲染顺序：类目（breakdown.categories 给定序）→ free → buffer（带 data-buffer-cell 钩子）
    const cells = [
        ...breakdown.categories.flatMap((c, i) =>
            Array.from({ length: categoryCounts[i] }, (_, j) => (
                <div key={`cat-${c.key}-${j}`} data-testid="waffle-cell" style={cellStyle('category', isDark ? CATEGORY_META[c.key].dark : CATEGORY_META[c.key].light)} />
            )),
        ),
        ...Array.from({ length: freeCells }, (_, j) => (
            <div key={`free-${j}`} data-testid="waffle-cell" style={cellStyle('free')} />
        )),
        ...(hasBuffer
            ? Array.from({ length: bufferCount }, (_, j) => (
                <div key={`buffer-${j}`} data-testid="waffle-cell" data-buffer-cell="" style={cellStyle('buffer')} />
            ))
            : []),
    ]

    /** 逐项明细数据源（按类目 key 取） */
    const detailItems = (key: ContextUsageCategoryKey): Array<{ name: string; tokens: number }> => {
        if (key === 'mcpTools') return breakdown.mcpTools
        if (key === 'skills') return breakdown.skills
        if (key === 'memoryFiles') return breakdown.memoryFiles.map((f) => ({ name: f.path, tokens: f.tokens }))
        return []
    }

    /** 数值尾对齐的行：label + token（minWidth 右对齐）+ 百分比（定宽右对齐） */
    const numericRow = (label: React.ReactNode, tokensText: string, pctText: string) => (
        <>
            <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</span>
            <span style={{ minWidth: 44, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{tokensText}</span>
            <span style={{ width: 38, textAlign: 'right', color: token.colorTextTertiary, fontVariantNumeric: 'tabular-nums' }}>{pctText}</span>
        </>
    )

    return (
        <div style={{ display: 'grid', gap: 10, fontFamily: 'var(--font-mono)' }}>
            {/* 方格网：20 列 × 5 行 = 100 格 */}
            <div
                style={{
                    display: 'grid',
                    gridTemplateColumns: `repeat(${GRID_COLUMNS}, 1fr)`,
                    gap: 2.5,
                }}
            >
                {cells}
            </div>

            {/* 类目列表 */}
            <div style={{ display: 'grid', gap: 4, fontSize: 12 }}>
                {breakdown.categories.map((c) => {
                    const meta = CATEGORY_META[c.key]
                    const color = isDark ? meta.dark : meta.light
                    const expandable = EXPANDABLE_KEYS.has(c.key) && detailItems(c.key).length > 0
                    const isOpen = expanded.has(c.key)
                    return (
                        <div key={c.key} style={{ display: 'grid', gap: 2 }}>
                            <div
                                style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: 6,
                                    cursor: expandable ? 'pointer' : undefined,
                                    userSelect: expandable ? 'none' : undefined,
                                }}
                                onClick={expandable ? () => toggle(c.key) : undefined}
                            >
                                {/* 展开指示：▶ 展开时旋转 90°；不可展开占位对齐 */}
                                <span style={{ width: 8, flexShrink: 0, fontSize: 8, color: token.colorTextTertiary, display: 'inline-flex', justifyContent: 'center', transition: 'transform 0.15s', transform: isOpen ? 'rotate(90deg)' : undefined }}>
                                    {expandable ? '▶' : ''}
                                </span>
                                <span style={stripeDotStyle(color)} />
                                {numericRow(meta.label, formatTokens(c.tokens), pct(c.tokens))}
                            </div>
                            {/* 逐项明细（展开后渲染） */}
                            {expandable && isOpen && (
                                <div style={{ display: 'grid', gap: 2, paddingLeft: 23 }}>
                                    {detailItems(c.key).map((item) => (
                                        <div key={item.name} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: token.colorTextTertiary }}>
                                            <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.name}</span>
                                            <span style={{ minWidth: 44, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{formatTokens(item.tokens)}</span>
                                            <span style={{ width: 38, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{pct(item.tokens)}</span>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    )
                })}

                {/* Free space：描边空心色点 */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ width: 8, flexShrink: 0 }} />
                    <span style={{ width: 9, height: 9, borderRadius: 2, flexShrink: 0, border: '1px solid rgba(128,128,128,0.5)' }} />
                    {numericRow('Free space', formatTokens(breakdown.freeTokens), pct(breakdown.freeTokens))}
                </div>

                {/* Autocompact buffer：有值才渲染（auto-compact 关闭时缺省） */}
                {hasBuffer && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <span style={{ width: 8, flexShrink: 0 }} />
                        <span style={stripeDotStyle(neutral, 135)} />
                        {numericRow('Autocompact buffer', formatTokens(breakdown.autocompactBufferTokens!), pct(breakdown.autocompactBufferTokens!))}
                    </div>
                )}
            </div>
        </div>
    )
}
