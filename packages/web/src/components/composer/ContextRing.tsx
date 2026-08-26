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

import { theme, Popover } from 'antd'
import { keyframes } from '@emotion/react'
import { useTranslation } from 'react-i18next'
import type { ContextUsage } from '@mobi/shared'
import { formatTokens } from '@/core/lib/formatTokens'

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
 * 瞬时水位的缓存命中率（cacheRead / (input+cacheCreation+cacheRead)，与 turn 概要同口径、
 * 同精度一位小数）。无细分字段（compact 路径 post_tokens 只有总量）或分母 0 → undefined 不展示。
 */
export function resolveCacheHitRate(usage: ContextUsage): number | undefined {
    if (usage.inputTokens === undefined || usage.cacheReadTokens === undefined) return undefined
    const totalInput = usage.inputTokens + (usage.cacheCreationTokens ?? 0) + usage.cacheReadTokens
    if (totalInput <= 0) return undefined
    return Math.round((usage.cacheReadTokens / totalInput) * 1000) / 10
}

/**
 * 上下文质量衰减线（绝对值）：超过该值长上下文召回/效果开始变差，与窗口大小无关。
 * 在环上 200k/maxTokens 角度处画一根静态橙色短刻度线（仪表红线隐喻），弧越过即「进衰减区」；
 * 仅作位置标注、不参与变色——环色仍由窗口百分比四档决定，两维度零冲突。
 * ratio ≥ 1（如 200k 窗口模型）时线与满弧终点重合，无意义，不画。
 */
const DEGRADATION_THRESHOLD_TOKENS = 200_000
/** 刻度线径向范围（略跨环带出头，r7.5→r12.5） */
const TICK_R_INNER = 7.5
const TICK_R_OUTER = 12.5

/** 计算 200k 刻度线两端坐标；不满足显示条件返回 null */
function degradationTick(maxTokens: number): { x1: number; y1: number; x2: number; y2: number } | null {
    const ratio = DEGRADATION_THRESHOLD_TOKENS / maxTokens
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
}

/**
 * 上下文水位圆环（瞬时水位，数据来自 runtimeState.contextUsage）。
 * 弧长 = 已用比例；点击 Popover 详情（PC/移动统一，触屏支持点击触发）。
 * 无数据不渲染——由挂载方保证（contextUsage 为空不挂）。
 */
export function ContextRing({ usage, size = 20 }: ContextRingProps) {
    const { t } = useTranslation()
    const { token } = theme.useToken()
    const { pct, tone } = resolveRingTone(usage.percentage)
    const color = tone === 'danger' ? token.colorError
        : tone === 'warn' ? '#fa541c' // volcano-6 橙红（主题无此档，显式色值）
        : tone === 'notice' ? token.colorWarning
        : token.colorTextTertiary
    const remaining = Math.max(0, usage.maxTokens - usage.totalTokens)
    const tick = degradationTick(usage.maxTokens)
    const hitRate = resolveCacheHitRate(usage)
    // 细分四项随 assistant 路径上报；compact 路径只有总量 → 整组隐藏
    const hasBreakdown = usage.inputTokens !== undefined && usage.outputTokens !== undefined
        && usage.cacheReadTokens !== undefined && usage.cacheCreationTokens !== undefined

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
            {/* 200k 衰减刻度线：画在进度弧之上（后画），横跨环带出头，弧越过即进衰减区 */}
            {tick && (
                <line x1={tick.x1} y1={tick.y1} x2={tick.x2} y2={tick.y2}
                    stroke="#fa8c16" strokeWidth="1.4" strokeLinecap="round" />
            )}
        </svg>
    )

    return (
        <Popover
            trigger="click"
            placement="topRight"
            styles={{ content: { minWidth: 'min(280px, 80vw)' } }}
            content={(
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: 12, display: 'grid', gap: 4, padding: '4px 2px' }}>
                    <div style={{ fontWeight: 600, marginBottom: 2 }}>{t('session.contextUsage.title')}</div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16 }}>
                        <span style={{ color: token.colorTextTertiary }}>{t('session.contextUsage.used')}</span>
                        <span style={{ fontVariantNumeric: 'tabular-nums' }}>
                            {formatTokens(usage.totalTokens)} / {formatTokens(usage.maxTokens)} ({pct}%)
                        </span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16 }}>
                        <span style={{ color: token.colorTextTertiary }}>{t('session.contextUsage.remaining')}</span>
                        <span style={{ fontVariantNumeric: 'tabular-nums' }}>{formatTokens(remaining)}</span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16 }}>
                        <span style={{ color: token.colorTextTertiary }}>{t('session.contextUsage.cost')}</span>
                        <span style={{ fontVariantNumeric: 'tabular-nums' }}>${usage.costUsd.toFixed(2)}</span>
                    </div>
                    {/* 瞬时请求细分（compact 路径无细分整组隐藏）：四项 token + 缓存命中率 */}
                    {hasBreakdown && (
                        <>
                            <div style={{ marginTop: 4, borderTop: `1px solid ${token.colorBorderSecondary}`, paddingTop: 4, display: 'flex', justifyContent: 'space-between', gap: 16 }}>
                                <span style={{ color: token.colorTextTertiary }}>{t('session.contextUsage.input')}</span>
                                <span style={{ fontVariantNumeric: 'tabular-nums' }}>{formatTokens(usage.inputTokens!)}</span>
                            </div>
                            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16 }}>
                                <span style={{ color: token.colorTextTertiary }}>{t('session.contextUsage.output')}</span>
                                <span style={{ fontVariantNumeric: 'tabular-nums' }}>{formatTokens(usage.outputTokens!)}</span>
                            </div>
                            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16 }}>
                                <span style={{ color: token.colorTextTertiary }}>{t('session.contextUsage.cacheRead')}</span>
                                <span style={{ fontVariantNumeric: 'tabular-nums' }}>{formatTokens(usage.cacheReadTokens!)}</span>
                            </div>
                            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16 }}>
                                <span style={{ color: token.colorTextTertiary }}>{t('session.contextUsage.cacheWrite')}</span>
                                <span style={{ fontVariantNumeric: 'tabular-nums' }}>{formatTokens(usage.cacheCreationTokens!)}</span>
                            </div>
                            {hitRate !== undefined && (
                                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16 }}>
                                    <span style={{ color: token.colorTextTertiary }}>{t('session.contextUsage.cacheHit')}</span>
                                    <span style={{ fontVariantNumeric: 'tabular-nums' }}>{hitRate.toFixed(1)}%</span>
                                </div>
                            )}
                        </>
                    )}
                </div>
            )}
        >
            {ring}
        </Popover>
    )
}
