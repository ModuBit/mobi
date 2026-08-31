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

import { useEffect, useRef, useState } from 'react'
import { theme, Popconfirm, Drawer, Button } from 'antd'
import { LoadingOutlined } from '@ant-design/icons'
import { AppTooltip } from '@/components/ui/AppTooltip'
import type { GlobalToken } from 'antd/es/theme/interface'
import { Terminal, CircleStop, Eye, Zap, CircleDashed } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { PixelAvatar } from '@/components/pixel-avatar/PixelAvatar'
import { agentCardBg } from '@/components/composer/agentPalette'
import { useUiStore, resolveTheme } from '@/core/data/stores/uiStore'
import { useIsMobile } from '@/core/data/hooks/useMediaQuery'
import { formatDuration, formatTokens } from '@/core/lib/metricsFormat'
import type { BackgroundTask } from '@/domain/chat/types'
import type { AgentStatus } from '@/components/pixel-avatar/types'

/** 格式化后台任务指标信息 */
function formatMetrics(task: BackgroundTask): string {
    if (!task.metrics) return ''
    const parts: string[] = []
    if (task.metrics.durationMs > 0) parts.push(formatDuration(task.metrics.durationMs))
    if (task.metrics.tokens > 0) parts.push(formatTokens(task.metrics.tokens))
    return parts.join(' · ') || 'pending'
}

function taskAvatarStatus(status: BackgroundTask['status']): AgentStatus {
    return status === 'running' ? 'outputting' : 'inactive'
}

/** 终态色板：completed=success、failed=error、其余（stopped 等）=primary 淡档（与运行中 loading 同色系，自然过渡） */
function terminalStatusPalette(status: BackgroundTask['status'], token: GlobalToken): { bg: string; fg: string } {
    if (status === 'completed') return { bg: token.colorSuccessBg, fg: token.colorSuccess }
    if (status === 'failed') return { bg: token.colorErrorBg, fg: token.colorError }
    return { bg: token.colorPrimaryBg, fg: token.colorTextTertiary }
}

/**
 * 后台任务卡片组件
 * 展示单个后台任务的状态、图标、描述和指标
 * 无 sidechain 数据（toolUseId=null）的任务不可点击打开 drawer（单点语义收敛在本组件）：
 * cursor 降级 + opacity 微降，让「不可点」有视觉反馈
 */
export function BackgroundTaskCard({ task, onClick, onStop }: {
    task: BackgroundTask
    onClick: () => void
    onStop?: (e: React.MouseEvent) => void
}) {
    const { t } = useTranslation()
    const { token } = theme.useToken()
    const isDark = useUiStore((s) => resolveTheme(s.theme) === 'dark')
    const isMobile = useIsMobile()
    const isRunning = task.status === 'running'
    // 无 sidechain 数据（toolUseId=null）的任务打开不了 drawer——点击守卫由本组件内聚，
    // 调用方无需（也不应）再判 toolUseId
    const clickable = task.toolUseId != null
    const name = task.description ?? 'Background task'

    const [stopHovered, setStopHovered] = useState(false)
    const [drawerOpen, setDrawerOpen] = useState(false)
    const [stopping, setStopping] = useState(false)

    const prevSummaryRef = useRef(task.summary)
    const [displaySummary, setDisplaySummary] = useState(task.summary)

    useEffect(() => {
        if (task.summary !== prevSummaryRef.current) {
            setDisplaySummary(task.summary)
            prevSummaryRef.current = task.summary
        }
    }, [task.summary])

    const handleStop = (e: React.MouseEvent) => {
        e.stopPropagation()
        if (!onStop) return
        if (isMobile) {
            setDrawerOpen(true)
        }
    }

    const doStop = async () => {
        if (!onStop) return
        setStopping(true)
        try {
            // 构造一个模拟事件给外部 handler
            await onStop({ stopPropagation: () => {} } as React.MouseEvent)
        } finally {
            setStopping(false)
            setDrawerOpen(false)
        }
    }

    // stop 按钮（仅运行中任务显示）
    const showStop = onStop && isRunning

    // stop 确认 Drawer（移动端）
    const stopDrawer = isMobile && showStop ? (
        <Drawer
            placement="bottom"
            open={drawerOpen}
            onClose={() => { if (!stopping) setDrawerOpen(false) }}
            closable={false}
            styles={{
                wrapper: { height: 'auto' },
                body: { padding: '8px 0', paddingBottom: 'max(24px, env(safe-area-inset-bottom))' },
            }}
        >
            <div style={{ padding: '12px 20px', fontSize: 14, color: token.colorTextSecondary }}>
                {t('chat.backgroundTask.stopConfirm')}
            </div>
            <Button
                type="text" block danger loading={stopping}
                style={{ height: 48, justifyContent: 'flex-start', paddingInline: 20 }}
                onClick={doStop}
            >
                {t('chat.backgroundTask.stop')}
            </Button>
            <Button
                type="text" block disabled={stopping}
                style={{ height: 48, justifyContent: 'flex-start', paddingInline: 20 }}
                onClick={() => setDrawerOpen(false)}
            >
                {t('chat.clearState.cancel')}
            </Button>
        </Drawer>
    ) : null

    // stop 按钮区域：桌面端用 Popconfirm 包裹，移动端直接渲染按钮
    const stopElement = !showStop ? null : isMobile ? (
        <div
            onClick={handleStop}
            style={{
                flexShrink: 0, width: 22, height: 22,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                borderRadius: 4, cursor: 'pointer',
            }}
        >
            <CircleStop size={14} style={{ color: token.colorTextQuaternary }} />
        </div>
    ) : (
        <AppTooltip title={t('chat.backgroundTask.stop')} mouseEnterDelay={0.5}>
            <Popconfirm
                title={t('chat.backgroundTask.stopConfirm')}
                onConfirm={doStop}
                okText={t('chat.backgroundTask.stop')}
                cancelText={t('chat.clearState.cancel')}
                okButtonProps={{ danger: true, loading: stopping }}
                onCancel={(e) => e?.stopPropagation()}
            >
                <div
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
            </Popconfirm>
        </AppTooltip>
    )

    return (
        <>
            <div
                data-testid={`bg-task-card-${task.taskId}`}
                style={{
                    display: 'flex', alignItems: 'center', gap: 6,
                    width: 'var(--agent-card-width, 200px)', height: 40,
                    padding: '4px 8px', borderRadius: 8,
                    cursor: clickable ? 'pointer' : 'default',
                    border: 'none', background: agentCardBg(name, isDark),
                    boxSizing: 'border-box',
                    // 不可点击的卡片再降一档 opacity（比终态淡出更弱），让「不可点」可感知
                    opacity: clickable ? (isRunning ? 1 : 0.75) : 0.55,
                }}
                onClick={() => { if (!clickable) return; onClick() }}
            >
                <div style={{ flexShrink: 0, lineHeight: 0 }}>
                    {task.toolName === 'Agent' ? (
                        <PixelAvatar name={task.taskId} status={taskAvatarStatus(task.status)} size={24} />
                    ) : (
                        <ToolIcon toolName={task.toolName} status={task.status} />
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
                        textDecoration: !isRunning ? 'line-through' : 'none',
                        display: 'flex', alignItems: 'center', gap: 4,
                    }}>
                        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {name}
                        </span>
                        {/* 后台任务闪电标签：与 bubble list ToolCallBlock 的 isBgAgent 闪电样式一致 */}
                        <Zap size={12} style={{ flexShrink: 0, color: '#f5b800' }} />
                    </div>
                    <AppTooltip title={displaySummary || undefined} placement="top" mouseEnterDelay={0.5}>
                        <div style={{
                            fontSize: 9, color: token.colorTextQuaternary,
                            fontFamily: 'var(--font-mono)', whiteSpace: 'nowrap',
                            overflow: 'hidden', textOverflow: 'ellipsis', lineHeight: '1.3',
                        }}>
                            {displaySummary
                                ? `${task.metrics?.durationMs != null ? formatDuration(task.metrics.durationMs) : ''} · ${displaySummary}`
                                : formatMetrics(task)}
                        </div>
                    </AppTooltip>
                </div>
                {stopElement}
                {stopDrawer}
            </div>
        </>
    )
}

/**
 * 非Agent工具图标
 * unknown = CircleDashed 中性图形（补建条目无法确证工具类型，诚实降级，不冒充 Bash 终端）
 * running = LoadingOutlined 转圈（通用 loading，小尺寸内联位用品牌动画会糊）
 * 终态 = 柔色底圆 + 浓色 Terminal 图标（语义：bash 工具的结果）
 */
function ToolIcon({ toolName, status }: { toolName: string; status: BackgroundTask['status'] }) {
    const { token } = theme.useToken()

    if (toolName === 'unknown') {
        return (
            <div style={{
                width: 24, height: 24, display: 'flex',
                alignItems: 'center', justifyContent: 'center',
            }}>
                <CircleDashed size={16} style={{ color: token.colorTextTertiary }} />
            </div>
        )
    }

    if (toolName === 'Monitor') {
        return (
            <div style={{
                width: 24, height: 24, display: 'flex',
                alignItems: 'center', justifyContent: 'center',
                borderRadius: 4,
            }}>
                <Eye size={16} style={{ color: terminalStatusPalette(status, token).fg }} />
            </div>
        )
    }

    if (status === 'running') {
        return (
            <div style={{
                width: 24, height: 24, display: 'flex',
                alignItems: 'center', justifyContent: 'center',
            }}>
                <LoadingOutlined spin style={{ fontSize: 16, color: token.colorPrimary }} />
            </div>
        )
    }

    // 终态：柔色底圆 + 浓色 Terminal
    const { bg, fg } = terminalStatusPalette(status, token)
    return (
        <div style={{
            width: 22, height: 22, borderRadius: '50%',
            background: bg,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
            <Terminal size={12} style={{ color: fg }} />
        </div>
    )
}
