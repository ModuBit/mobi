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
import { useTranslation } from 'react-i18next'
import type { ContextUsage } from '@mobi/shared'
import { CONTEXT_RING_TONES, type ContextRingTone } from '@/core/config/theme/tokens'
import { formatTokens } from '@/core/lib/formatTokens'
import { useIsMobile } from '@/core/data/hooks/useMediaQuery'
import { useUiStore, resolveTheme } from '@/core/data/stores/uiStore'
import { ContextBreakdown } from '@/ui/shared/ContextBreakdown'
import { Popover } from '@/ui/base/interactive/popover/Popover'
import { AppTooltip } from '@/ui/base/interactive/AppTooltip'
import { Button } from '@/ui/base/interactive/button/Button'

/** 砖红档（≥85% 压缩阈值）透明度脉冲（「马上要压缩」） */
const pulse = keyframes`0%,100%{opacity:1}50%{opacity:0.35}`

/** 环色档位（色值单一来源见 tokens.ts 的 CONTEXT_RING_TONES） */
export type RingTone = ContextRingTone

/** 弧长/百分比钳到 [0, 100] 并取整（环上不显示小数） */
function clampPct(value: number): number {
    return Math.max(0, Math.min(100, Math.round(value)))
}

/**
 * 颜色分档的驱动口径：自动压缩触发点（可写上限）。
 * 阈值未知（未启用 / 自动推导 / 旧 CLI）→ 回落到窗口；阈值超过窗口时窗口才是先撞到的限制。
 */
export function resolveRingLimit(usage: Pick<ContextUsage, 'maxTokens' | 'autoCompactAtTokens'>): number {
    const threshold = usage.autoCompactAtTokens
    return threshold !== undefined && threshold > 0 ? Math.min(threshold, usage.maxTokens) : usage.maxTokens
}

/**
 * 四档色（灰 / 石青 / 陶土 / 砖红+脉冲，色值见 tokens.ts 的 CONTEXT_RING_TONES）：
 * `<50%` 灰（无感）/ `50–70%` 石青（过半，但轮到示警还早）/ `70–85%` 陶土（该留意）/
 * `≥85%` 砖红+脉冲。
 * 分档比例**相对自动压缩触发点**（见 resolveRingLimit），不是相对窗口——否则阈值远小于
 * 窗口时（如 1m 窗口 / 350k 阈值）红档永远不出现；回落到窗口时与旧口径同义。
 * 弧长与展示百分比仍是窗口占用（`pct`）：环画「窗口用了多少」，颜色说「离压缩还有多远」，
 * 刻度线标出阈值位置，弧端靠近刻度即变红。
 */
export function resolveRingTone(
    usage: Pick<ContextUsage, 'totalTokens' | 'maxTokens' | 'percentage' | 'autoCompactAtTokens'>,
): { pct: number; tone: RingTone; limitUsage: number } {
    // 展示百分比沿用后端算好的 percentage（契约字段），不在此重算
    const pct = clampPct(Number.isFinite(usage.percentage) ? usage.percentage : 0)
    const limit = resolveRingLimit(usage)
    const limitUsage = limit > 0 ? (usage.totalTokens / limit) * 100 : 0
    const band = clampPct(limitUsage)
    const tone: RingTone = band >= 85 ? 'danger' : band >= 70 ? 'warn' : band >= 50 ? 'notice' : 'idle'
    return { pct, tone, limitUsage }
}

/** 圆环半径（viewBox 24，描边 2.5） */
const R = 10
const CIRC = 2 * Math.PI * R

/**
 * 自动压缩刻度位置。压缩触发点来自 CLI（summary.autoCompactThreshold），不由前端假设
 * 「200k/400k 开始衰减」——阈值随用户配置与模型窗口变化。在 ratio 角度处画一根中性短刻度线，
 * 它是颜色分档的「红线」：颜色按 resolveRingLimit 的比例分档，弧端靠近刻度即进入砖红档。
 * 阈值缺省（未启用 / 自动推导 / 未知）或 ratio 越界（≤0、≥1）时不画。
 */
const TICK_R_INNER = 7.5
const TICK_R_OUTER = 12.5

function compactTick(maxTokens: number, autoCompactAtTokens?: number): { x1: number; y1: number; x2: number; y2: number } | null {
    if (autoCompactAtTokens === undefined || maxTokens <= 0) return null
    const ratio = autoCompactAtTokens / maxTokens
    if (!Number.isFinite(ratio) || ratio <= 0 || ratio >= 1) return null
    const theta = ratio * 2 * Math.PI // 顶部起顺时针
    const sin = Math.sin(theta), cos = Math.cos(theta)
    return {
        x1: 12 + TICK_R_INNER * sin, y1: 12 - TICK_R_INNER * cos,
        x2: 12 + TICK_R_OUTER * sin, y2: 12 - TICK_R_OUTER * cos,
    }
}

interface ContextRingProps {
    usage: ContextUsage
    /** 圆环直径 px（PC 工具栏 20 / 移动 header 22，默认 20） */
    size?: number
    /** Popover 弹出方位（默认 top：PC composer 底部向上弹出不遮 composer；
     *  移动 header 环贴屏顶无空间，传 bottomRight 向下拉出如菜单） */
    placement?: 'top' | 'bottomRight' | 'bottom'
    /** 立即压缩（发 `/compact`）。仅在 ≥60% 有效上限且传入时展示 */
    onCompact?: () => void
    /** 压缩不可用（会话运行中）：按钮置灰 */
    compactDisabled?: boolean
}

/**
 * 压缩按钮的展示门槛（有效上限百分比，产品定稿 60）。
 * 与环色分档解耦：60% 时环仍是石青（50–70 档），但已经值得提供快捷入口。
 */
const COMPACT_SHOW_MIN = 60

/**
 * 上下文水位圆环（瞬时水位，数据来自 runtimeState.contextUsage）。
 * hover Tooltip 概要（已用/上限/百分比）；点击 Popover 详情（PC/移动统一，触屏支持点击触发）。
 * 无数据不渲染——由挂载方保证（contextUsage 为空不挂）。
 */
export function ContextRing({ usage, size = 20, placement = 'top', onCompact, compactDisabled = false }: ContextRingProps) {
    const { t } = useTranslation()
    const { token } = theme.useToken()
    // 环色档位值按主题取（与 ContextBreakdown 同款判定：uiStore 是主题单一来源）
    const isDark = useUiStore((state) => resolveTheme(state.theme, state.systemIsDark) === 'dark')
    const { pct, tone, limitUsage } = resolveRingTone(usage)
    const color = CONTEXT_RING_TONES[isDark ? 'dark' : 'light'][tone]
    const showCompact = onCompact !== undefined && Math.round(limitUsage) >= COMPACT_SHOW_MIN
    const remaining = Math.max(0, usage.maxTokens - usage.totalTokens)
    const tick = compactTick(usage.maxTokens, usage.autoCompactAtTokens)
    const usedSummary = `${formatTokens(usage.totalTokens)} / ${formatTokens(usage.maxTokens)} (${pct}%)`
    // 受控 Popover：打开期间隐藏 hover Tooltip（两者同屏重叠）；移动端无 hover，整体禁用。
    // 关闭 Popover 后 title 恢复但 AppTooltip 的内部打开态已被清空（title 清空时同步复位），
    // 不会再冒出来，需重新悬停
    const isMobile = useIsMobile()
    const [popoverOpen, setPopoverOpen] = useState(false)
    const tooltipTitle = isMobile || popoverOpen ? undefined : usedSummary

    const ring = (
        <svg
            role="button"
            aria-label={`${pct}%`}
            width={size}
            height={size}
            viewBox="0 0 24 24"
            style={{ display: 'block', cursor: 'pointer', animation: tone === 'danger' ? `${pulse} 1.3s ease-in-out infinite` : undefined }}
        >
            <circle cx="12" cy="12" r={R} fill="none" stroke={token.colorBorderSecondary} strokeWidth="2.5" />
            <circle
                cx="12" cy="12" r={R} fill="none" stroke={color} strokeWidth="2.5"
                strokeLinecap="round"
                strokeDasharray={CIRC}
                strokeDashoffset={CIRC * (1 - pct / 100)}
                transform="rotate(-90 12 12)"
            />
            {/* 自动压缩刻度（后画、压在弧上）：横跨环带出头，弧端靠近它即进入砖红档 */}
            {tick && (
                <line x1={tick.x1} y1={tick.y1} x2={tick.x2} y2={tick.y2}
                    stroke={token.colorTextTertiary} strokeWidth="1.4" strokeLinecap="round" />
            )}
        </svg>
    )

    return (
        <Popover
            trigger="click"
            // 箭头指向触发中心：align="center" 让面板与箭头锚在圆环中心（antd placement 的等价映射）
            side={placement === 'top' ? 'top' : 'bottom'}
            align={placement === 'bottomRight' ? 'end' : 'center'}
            arrow
            open={popoverOpen}
            onOpenChange={(open) => {
                setPopoverOpen(open)
            }}
            /* 定宽（视口约束）：明细长路径 nowrap 会撑爆固有宽度致横向溢出屏幕，
               固定 width 让 ellipsis 生效（纵向限高滚动在内容层 hide-scrollbar） */
            panelStyle={{ width: 'min(300px, calc(100vw - 32px))' }}
            content={(
                <div
                    className="hide-scrollbar"
                    style={{ fontFamily: 'var(--font-mono)', fontSize: 12, display: 'grid', gridTemplateColumns: 'minmax(0, 1fr)', gap: 4, padding: '4px 2px', maxHeight: 'min(420px, 65dvh)', overflowY: 'auto' }}
                >
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 2 }}>
                        <span style={{ fontWeight: 600 }}>{t('session.contextUsage.title')}</span>
                        {/* 低水位不展示（压缩收益低）；点击后收起面板，进度交给聊天区的压缩气泡 */}
                        {showCompact && (
                            <Button
                                variant="ghost"
                                size="sm"
                                disabled={compactDisabled}
                                onClick={() => {
                                    setPopoverOpen(false)
                                    onCompact?.()
                                }}
                            >
                                {t('session.contextUsage.compact')}
                            </Button>
                        )}
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16 }}>
                        <span style={{ color: token.colorTextTertiary }}>{t('session.contextUsage.used')}</span>
                        <span style={{ fontVariantNumeric: 'tabular-nums' }}>{usedSummary}</span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16 }}>
                        <span style={{ color: token.colorTextTertiary }}>{t('session.contextUsage.remaining')}</span>
                        <span style={{ fontVariantNumeric: 'tabular-nums' }}>{formatTokens(remaining)}</span>
                    </div>
                    {/* 模型最大窗口：信息展示（分母是 CC 有效窗口，含 autocompact 阈值）；两者一致时省略 */}
                    {usage.modelContextTokens != null && usage.modelContextTokens !== usage.maxTokens && (
                        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16 }}>
                            <span style={{ color: token.colorTextTertiary }}>{t('session.contextUsage.modelLimit')}</span>
                            <span style={{ fontVariantNumeric: 'tabular-nums' }}>{formatTokens(usage.modelContextTokens)}</span>
                        </div>
                    )}
                    {/* 自动压缩阈值：颜色分档的驱动口径（环色按它算比例），
                        让「百分比不高却已变红」有据可查 */}
                    {usage.autoCompactAtTokens != null && (
                        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16 }}>
                            <span style={{ color: token.colorTextTertiary }}>{t('session.contextUsage.autoCompact')}</span>
                            <span style={{ fontVariantNumeric: 'tabular-nums' }}>{formatTokens(usage.autoCompactAtTokens)}</span>
                        </div>
                    )}
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16 }}>
                        <span style={{ color: token.colorTextTertiary }}>{t('session.contextUsage.cost')}</span>
                        <span style={{ fontVariantNumeric: 'tabular-nums' }}>${usage.costUsd.toFixed(2)}</span>
                    </div>
                    <ContextBreakdown usage={usage} />
                </div>
            )}
        >
            {/* hover=Tooltip 概要 / click=Popover 详情：触发分离；移动端与 Popover 打开期间不弹 Tooltip。
                Popover 需要一个真实 DOM 节点作锚，AppTooltip 的 wrapper 是 display:contents，
                这里用 inline-flex span 包一层，布局尺寸随圆环 */}
            <span style={{ display: 'inline-flex' }}>
                <AppTooltip title={tooltipTitle} placement="top" mouseEnterDelay={0.15}>
                    {ring}
                </AppTooltip>
            </span>
        </Popover>
    )
}
