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
import { Terminal, CircleStop, Eye } from 'lucide-react'
import { PixelAvatar } from '@/components/pixel-avatar/PixelAvatar'
import { agentCardBg } from '@/components/composer/agentPalette'
import { useUiStore, resolveTheme } from '@/core/data/stores/uiStore'
import { formatDuration, formatTokens } from '@/core/lib/metricsFormat'
import type { BackgroundTask } from '@/domain/chat/types'

/** 格式化后台任务指标信息 */
function formatMetrics(task: BackgroundTask): string {
    if (!task.metrics) return ''
    const parts: string[] = []
    if (task.metrics.durationMs > 0) parts.push(formatDuration(task.metrics.durationMs))
    if (task.metrics.tokens > 0) parts.push(formatTokens(task.metrics.tokens))
    return parts.join(' · ') || 'pending'
}

/**
 * 后台任务卡片组件
 * 展示单个后台任务的状态、图标、描述和指标
 */
export function BackgroundTaskCard({ task, onClick, onStop }: {
    task: BackgroundTask
    onClick: () => void
    onStop: (e: React.MouseEvent) => void
}) {
    const { token } = theme.useToken()
    const isDark = useUiStore((s) => resolveTheme(s.theme) === 'dark')
    const name = task.description ?? 'Background task'
    const [stopHovered, setStopHovered] = useState(false)

    return (
        <div style={{
            display: 'flex', alignItems: 'center', gap: 6,
            width: 'var(--agent-card-width, 200px)', height: 40,
            padding: '4px 8px', borderRadius: 8, cursor: 'pointer',
            border: 'none', background: agentCardBg(name, isDark),
            boxSizing: 'border-box',
        }} onClick={onClick}>
            <div style={{ flexShrink: 0, lineHeight: 0 }}>
                {task.toolName === 'Agent' ? (
                    <PixelAvatar name={task.taskId} status="outputting" size={24} />
                ) : (
                    <div style={{
                        width: 24, height: 24, display: 'flex',
                        alignItems: 'center', justifyContent: 'center',
                        borderRadius: 4,
                    }}>
                        {task.toolName === 'Monitor'
                            ? <Eye size={16} style={{ color: token.colorTextSecondary }} />
                            : <Terminal size={16} style={{ color: token.colorTextSecondary }} />}
                    </div>
                )}
            </div>
            <div style={{
                flex: 1, minWidth: 0, overflow: 'hidden',
                display: 'flex', flexDirection: 'column', gap: 1,
            }}>
                <div style={{
                    fontSize: 11, color: token.colorTextSecondary,
                    whiteSpace: 'nowrap', overflow: 'hidden',
                    textOverflow: 'ellipsis', lineHeight: '1.3',
                }}>
                    {name}
                </div>
                <div style={{
                    fontSize: 9, color: token.colorTextQuaternary,
                    fontFamily: 'var(--font-mono)', whiteSpace: 'nowrap',
                    overflow: 'hidden', textOverflow: 'ellipsis', lineHeight: '1.3',
                }}>
                    {formatMetrics(task)}
                </div>
            </div>
            <div
                onClick={onStop}
                onMouseEnter={() => setStopHovered(true)}
                onMouseLeave={() => setStopHovered(false)}
                style={{
                    flexShrink: 0, width: 22, height: 22,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    borderRadius: 4, cursor: 'pointer', transition: 'background 0.2s',
                    background: stopHovered ? token.colorErrorBg : 'transparent',
                }}
            >
                <CircleStop size={14} style={{
                    color: stopHovered ? token.colorError : token.colorTextQuaternary,
                    transition: 'color 0.2s',
                }} />
            </div>
        </div>
    )
}
