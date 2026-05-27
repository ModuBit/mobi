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
import { PixelAvatar } from '@/components/pixel-avatar/PixelAvatar'
import { agentCardBg } from '@/components/composer/agentPalette'
import { useUiStore, resolveTheme } from '@/core/data/stores/uiStore'
import { formatDuration, formatTokens } from '@/core/lib/metricsFormat'
import type { RunningAgent } from '@/domain/chat/extractRunningAgents'
import type { AgentMetrics } from '@/domain/chat/types'

/** 格式化指标信息 */
function formatMetrics(metrics: AgentMetrics | undefined): string {
    if (!metrics) return ''
    const parts: string[] = []
    if (metrics.durationMs > 0) parts.push(formatDuration(metrics.durationMs))
    if (metrics.toolUses > 0) parts.push(`${metrics.toolUses} tools`)
    if (metrics.tokens > 0) parts.push(formatTokens(metrics.tokens))
    return parts.join(' · ') || 'pending'
}

/**
 * Agent 卡片组件
 * 展示单个 Agent 的状态、头像、描述和指标
 */
export function AgentCard({ agent, onClick }: {
    agent: RunningAgent
    onClick: () => void
}) {
    const { token } = theme.useToken()
    const isDark = useUiStore((s) => resolveTheme(s.theme) === 'dark')
    const { block } = agent
    const tool = block.tool
    const isPending = tool.state === 'pending'

    const status = isPending ? 'idle' : 'outputting'
    const metricsText = formatMetrics(tool.agentMetrics)
    const agentName = agent.description ?? agent.subagentType ?? tool.id ?? 'Agent'

    return (
        <div
            onClick={onClick}
            style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                width: 'var(--agent-card-width, 200px)',
                height: 40,
                padding: '4px 8px',
                borderRadius: 8,
                cursor: 'pointer',
                border: 'none',
                opacity: isPending ? 0.7 : 1,
                background: agentCardBg(agentName, isDark),
                transition: 'opacity 0.3s',
                boxSizing: 'border-box',
            }}
        >
            <div style={{ flexShrink: 0, lineHeight: 0 }}>
                <PixelAvatar
                    name={tool.id}
                    status={status}
                    size={24}
                />
            </div>
            <div style={{
                flex: 1,
                minWidth: 0,
                overflow: 'hidden',
                display: 'flex',
                flexDirection: 'column',
                gap: 1,
            }}>
                <div style={{
                    fontSize: 11,
                    color: token.colorTextSecondary,
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    lineHeight: '1.3',
                }}>
                    {agent.description ?? agent.subagentType ?? 'Agent'}
                </div>
                <div style={{
                    fontSize: 9,
                    color: token.colorTextQuaternary,
                    fontFamily: 'var(--font-mono)',
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    lineHeight: '1.3',
                }}>
                    {metricsText}
                </div>
            </div>
        </div>
    )
}
