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

import type { AgentStatus } from '@/components/pixel-avatar/types'
import type { CacheStatus, GoalStatus } from '@mobi/shared'
import type { ClearRuntimeStateField } from '@/components/composer/ClearStateButton'
import { Tooltip, theme } from 'antd'
import { useTranslation } from 'react-i18next'
import { formatDuration, formatTokens } from '@/core/lib/metricsFormat'
import { AgentLoadingBubble } from './AgentLoadingBubble'
import { GoalBadge } from './GoalBadge'

interface StatusBarProps {
    /** Agent 标识（AgentLoadingBubble aria-label 用） */
    agentId: string
    /** Agent 运行状态（驱动 StatusDot 颜色/节奏）；running 时缺省则不渲染 loading */
    status?: AgentStatus
    /** 是否正在运行 */
    running: boolean
    /** 最近一次消息活动时间戳（毫秒），透传 AgentLoadingBubble 静默告警（agent 挂死可观测） */
    lastActivityAt?: number
    /** 本轮运行起点时间戳（毫秒，最后一条 user 消息），透传 AgentLoadingBubble 计时——刷新不归零 */
    startedAt?: number
    /** goal 状态（有值时渲染徽标） */
    goal?: GoalStatus | null
    /** 会话恢复时的 prompt cache 状态（expired 时渲染提示 chip；首 turn result 后 CLI 清空） */
    cacheStatus?: CacheStatus | null
    /** sessionId（goal 清理用，与 onClearGoal 同时传入） */
    sessionId?: string
    /** goal 清理回调（与 sessionId 同时传入时徽标带清理按钮） */
    onClearGoal?: (sid: string, fields: ClearRuntimeStateField[]) => Promise<void>
}

/**
 * 状态栏：composer 输入框上方一行，承载 goal 徽标、缓存过期提示与 loading 指示。
 *
 * 渲染规则：有 goal、cacheStatus（expired）或 running（含 status）时才渲染，否则返回 null 不占布局高度。
 * 布局：整行撑满 composer 内容宽——loading 气泡靠左，goal 徽标 / 缓存 chip 靠右（marginLeft:auto）。
 * 右侧多元素并存时依次排列；只 loading 时该元素落在左边。
 */
export function StatusBar({ agentId, status, running, lastActivityAt, startedAt, goal, cacheStatus, sessionId, onClearGoal }: StatusBarProps) {
    const { t } = useTranslation()
    const { token } = theme.useToken()
    const showGoal = goal != null
    const showCache = cacheStatus != null && cacheStatus.expired
    const showLoading = running && Boolean(status)
    if (!showGoal && !showCache && !showLoading) return null

    // 概要行：badge 短语 + 重缓存规模 + 成本（可选字段缺省省略）；Tooltip 补归因（距上次响应时长）
    const cacheDetailParts = [
        cacheStatus?.contextTokens !== undefined && t('session.cacheStatus.recache', { tokens: formatTokens(cacheStatus.contextTokens) }),
        cacheStatus?.estimatedCacheWriteUsd !== undefined && t('session.cacheStatus.cost', { usd: cacheStatus.estimatedCacheWriteUsd.toFixed(2) }),
    ].filter(Boolean) as string[]
    const cacheTooltip = cacheStatus?.secondsSinceLastResponse !== undefined
        ? t('session.cacheStatus.lastResponse', { duration: formatDuration(cacheStatus.secondsSinceLastResponse * 1000) })
        : undefined

    return (
        <div
            style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '4px 8px',
                width: '100%',
            }}
        >
            {showLoading ? <AgentLoadingBubble agentId={agentId} status={status!} lastActivityAt={lastActivityAt} startedAt={startedAt} /> : null}
            {showGoal || showCache ? (
                <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>
                    {showGoal ? (
                        <GoalBadge
                            goal={goal!}
                            sessionId={sessionId}
                            onClear={onClearGoal}
                        />
                    ) : null}
                    {showCache ? (
                        <Tooltip title={cacheTooltip}>
                            <span
                                data-testid="cache-status-chip"
                                style={{
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    gap: 5,
                                    padding: '2px 8px',
                                    borderRadius: 10,
                                    fontSize: 11,
                                    lineHeight: 1.6,
                                    color: token.colorWarning,
                                    background: token.colorWarningBg,
                                    cursor: 'default',
                                }}
                            >
                                ⚠ {t('session.cacheStatus.badge')}
                                {cacheDetailParts.length > 0 && <span>· {cacheDetailParts.join(' · ')}</span>}
                            </span>
                        </Tooltip>
                    ) : null}
                </div>
            ) : null}
        </div>
    )
}
