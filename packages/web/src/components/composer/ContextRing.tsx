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
import { theme, Popover, Tooltip } from 'antd'
import { keyframes } from '@emotion/react'
import { useTranslation } from 'react-i18next'
import type { ContextUsage } from '@mobi/shared'
import { formatTokens } from '@/core/lib/formatTokens'
import { useIsMobile } from '@/core/data/hooks/useMediaQuery'
import { ContextBreakdown } from './ContextBreakdown'

/** ≥90% 透明度脉冲（「马上要压缩」） */
const pulse = keyframes`0%,100%{opacity:1}50%{opacity:0.35}`

export type RingTone = 'idle' | 'notice' | 'warn' | 'danger'

/**
 * 四档色（灰/橙/橙红/红，参照 codex/qoder 低调风格）：
 * <50 灰（日常几乎无感）/ 50-75 橙（开始注意）/ 75-90 橙红（该考虑压缩）/ ≥90 红+脉冲
 */
export function resolveRingTone(percentage: number): { pct: number; tone: RingTone } {
    const pct = Math.max(0, Math.min(100, Math.round(percentage)))
    const tone: RingTone = pct >= 90 ? 'danger' : pct >= 75 ? 'warn' : pct >= 50 ? 'notice' : 'idle'
    return { pct, tone }
}

/** 圆环半径（viewBox 24，描边 2.5） */
const R = 10
const CIRC = 2 * Math.PI * R

/**
 * 上下文质量衰减线（绝对值集合）：超过该值长上下文召回/效果开始变差，与窗口大小无关。
 * 在环上各 threshold/maxTokens 角度处画一根静态橙色短刻度线（仪表红线隐喻），弧越过即
 * 「进衰减区」；仅作位置标注、不参与变色——环色仍由窗口百分比四档决定，两维度零冲突。
 * ratio ≥ 1（如窗口 ≤ 该档位）时线与满弧终点重合/越界，无意义，不画。
 */
const DEGRADATION_THRESHOLDS = [200_000, 400_000]
/** 刻度线径向范围（略跨环带出头，r7.5→r12.5） */
const TICK_R_INNER = 7.5
const TICK_R_OUTER = 12.5

/** 计算各阈值刻度线两端坐标；ratio 无效或 ≥1 的档位跳过 */
function degradationTicks(maxTokens: number): Array<{ x1: number; y1: number; x2: number; y2: number }> {
    return DEGRADATION_THRESHOLDS.flatMap((threshold) => {
        const ratio = threshold / maxTokens
        if (!Number.isFinite(ratio) || ratio <= 0 || ratio >= 1) return []
        const theta = ratio * 2 * Math.PI // 顶部起顺时针
        const sin = Math.sin(theta), cos = Math.cos(theta)
        return [{
            x1: 12 + TICK_R_INNER * sin, y1: 12 - TICK_R_INNER * cos,
            x2: 12 + TICK_R_OUTER * sin, y2: 12 - TICK_R_OUTER * cos,
        }]
    })
}

interface ContextRingProps {
    usage: ContextUsage
    /** 圆环直径 px（PC 工具栏 20 / 移动 header 22，默认 20） */
    size?: number
    /** Popover 弹出方位（默认 top：PC composer 底部向上弹出不遮 composer；
     *  移动 header 环贴屏顶无空间，传 bottomRight 向下拉出如菜单） */
    placement?: 'top' | 'bottomRight' | 'bottom'
}

/**
 * 上下文水位圆环（瞬时水位，数据来自 runtimeState.contextUsage）。
 * hover Tooltip 概要（已用/上限/百分比）；点击 Popover 详情（PC/移动统一，触屏支持点击触发）。
 * 无数据不渲染——由挂载方保证（contextUsage 为空不挂）。
 */
export function ContextRing({ usage, size = 20, placement = 'top' }: ContextRingProps) {
    const { t } = useTranslation()
    const { token } = theme.useToken()
    const { pct, tone } = resolveRingTone(usage.percentage)
    const color = tone === 'danger' ? token.colorError
        : tone === 'warn' ? '#fa541c' // volcano-6 橙红（主题无此档，显式色值）
        : tone === 'notice' ? token.colorWarning
        : token.colorTextTertiary
    const remaining = Math.max(0, usage.maxTokens - usage.totalTokens)
    const ticks = degradationTicks(usage.maxTokens)
    const usedSummary = `${formatTokens(usage.totalTokens)} / ${formatTokens(usage.maxTokens)} (${pct}%)`
    // 受控 Popover：打开期间隐藏 hover Tooltip（两者同屏重叠）；移动端无 hover，整体禁用。
    // 关闭 Popover 后抑制 Tooltip 直至鼠标离开环——antd 在 hover 上下文未销毁时会因
    // title 从 undefined 恢复立即重弹，造成「关掉 Popover 又冒出 Tooltip」
    const isMobile = useIsMobile()
    const [popoverOpen, setPopoverOpen] = useState(false)
    const [suppressTooltip, setSuppressTooltip] = useState(false)
    const tooltipTitle = isMobile || popoverOpen || suppressTooltip ? undefined : usedSummary

    const ring = (
        <svg
            role="button"
            aria-label={`${pct}%`}
            width={size}
            height={size}
            viewBox="0 0 24 24"
            onMouseLeave={() => setSuppressTooltip(false)}
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
            {/* 衰减刻度线（200k/400k 档位）：画在进度弧之上（后画），横跨环带出头，弧越过即进衰减区 */}
            {ticks.map((tick, i) => (
                <line key={i} x1={tick.x1} y1={tick.y1} x2={tick.x2} y2={tick.y2}
                    stroke="#fa8c16" strokeWidth="1.4" strokeLinecap="round" />
            ))}
        </svg>
    )

    return (
        <Popover
            trigger="click"
            // top + 箭头指向触发中心：topRight 的箭头锚在弹出层角上，与圆环错位
            placement={placement}
            arrow={{ pointAtCenter: true }}
            open={popoverOpen}
            onOpenChange={(open) => {
                setPopoverOpen(open)
                if (!open) setSuppressTooltip(true)
            }}
            /* 定宽（视口约束）：明细长路径 nowrap 会撑爆固有宽度致横向溢出屏幕，
               固定 width 让 ellipsis 生效（纵向限高滚动在内容层 hide-scrollbar） */
            styles={{
                content: {
                    width: 'min(300px, calc(100vw - 32px))',
                },
            }}
            content={(
                <div
                    className="hide-scrollbar"
                    style={{ fontFamily: 'var(--font-mono)', fontSize: 12, display: 'grid', gridTemplateColumns: 'minmax(0, 1fr)', gap: 4, padding: '4px 2px', maxHeight: 'min(420px, 65dvh)', overflowY: 'auto' }}
                >
                    <div style={{ fontWeight: 600, marginBottom: 2 }}>{t('session.contextUsage.title')}</div>
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
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16 }}>
                        <span style={{ color: token.colorTextTertiary }}>{t('session.contextUsage.cost')}</span>
                        <span style={{ fontVariantNumeric: 'tabular-nums' }}>${usage.costUsd.toFixed(2)}</span>
                    </div>
                    <ContextBreakdown usage={usage} />
                </div>
            )}
        >
            {/* hover=Tooltip 概要 / click=Popover 详情：触发分离；移动端与 Popover 打开期间不弹 Tooltip */}
            <Tooltip title={tooltipTitle} placement="top" mouseEnterDelay={0.15}>
                {ring}
            </Tooltip>
        </Popover>
    )
}
