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

/**
 * 执行中任务面板
 * 统一展示前台 Agent 与后台任务（Bash/Agent/Monitor），弱化前后台区分：
 * - 前台 Agent 复用 AgentCard，点击打开 ToolDetailDrawer
 * - 后台任务复用 BackgroundTaskCard，标题旁显示闪电图标、运行中带停止按钮
 * - 合并前是 AgentPanel（前台）+ BackgroundTaskPanel（后台）两个独立面板；
 *   识别修复后同一任务不再双渲染，此处统一为一处
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import { theme } from 'antd'
import { Global, css } from '@emotion/react'
import { Loader } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useRunningAgents } from '@/core/data/stores/runningAgentsStore'
import { useBackgroundTasks } from '@/core/data/stores/backgroundTasksStore'
import { AgentCard } from './AgentCard'
import { BackgroundTaskCard } from './BackgroundTaskCard'
import type { BackgroundTask } from '@/domain/chat/types'
import type { RunningAgent } from '@/domain/chat/extractRunningAgents'
import type { ToolCallBlock } from '@/domain/chat/types'
import type { MobiApi } from '@/core/data/api/client'
import { ClearStateButton, type ClearRuntimeStateField } from './ClearStateButton'

const spinKeyframes = css`
@keyframes tasks-panel-spin { from { transform: rotate(0deg) } to { transform: rotate(360deg) } }
`

/** 统一面板条目：前台 Agent 或后台任务 */
type TaskListItem =
    | { kind: 'agent'; agent: RunningAgent }
    | { kind: 'bg-task'; task: BackgroundTask }

/** 条目排序：running/pending 在前；同状态按启动时间倒序（新的在前） */
function sortItems(items: TaskListItem[]): TaskListItem[] {
    const statusRank = (item: TaskListItem): number => {
        const status = item.kind === 'agent' ? item.agent.block.tool.state : item.task.status
        return status === 'running' || status === 'pending' ? 0 : 1
    }
    const startedAt = (item: TaskListItem): number => {
        if (item.kind === 'agent') return item.agent.block.tool.startedAt ?? item.agent.block.createdAt
        return item.task.startedAt
    }
    return [...items].sort((a, b) => {
        const rankDiff = statusRank(a) - statusRank(b)
        if (rankDiff !== 0) return rankDiff
        return startedAt(b) - startedAt(a)
    })
}

/**
 * 执行中任务面板
 */
export function TasksPanel({ sessionId, api, onAgentClick, onClear }: {
    sessionId: string
    api: MobiApi
    onAgentClick: (block: ToolCallBlock) => void
    onClear: (sessionId: string, clearFields: ClearRuntimeStateField[]) => Promise<void>
}) {
    const { t } = useTranslation()
    const { token } = theme.useToken()
    const agents = useRunningAgents(sessionId)
    const bgTasks = useBackgroundTasks(sessionId)
    const wrapperRef = useRef<HTMLDivElement>(null)
    const scrollRef = useRef<HTMLDivElement>(null)
    const [showFade, setShowFade] = useState(false)
    const [narrow, setNarrow] = useState(false)

    // 合并前台 agent + 后台任务
    const items = useMemo<TaskListItem[]>(() => {
        const list: TaskListItem[] = [
            ...agents.map(agent => ({ kind: 'agent' as const, agent })),
            ...bgTasks.map(task => ({ kind: 'bg-task' as const, task })),
        ]
        return sortItems(list)
    }, [agents, bgTasks])

    const hasRunning = items.some(item => {
        if (item.kind === 'agent') return item.agent.block.tool.state === 'running' || item.agent.block.tool.state === 'pending'
        return item.task.status === 'running'
    })

    // 监听容器宽度，窄于阈值时卡片撑满纵向排列
    useEffect(() => {
        const el = wrapperRef.current
        if (!el) return
        const observer = new ResizeObserver(() => {
            setNarrow(el.clientWidth < 460)
        })
        observer.observe(el)
        return () => observer.disconnect()
    }, [])

    // 监听容器尺寸变化和条目数量变化，判断是否需要渐变遮罩
    useEffect(() => {
        const el = scrollRef.current
        if (!el) return
        const checkOverflow = () => setShowFade(el.scrollHeight > el.clientHeight)
        checkOverflow()
        const observer = new ResizeObserver(checkOverflow)
        observer.observe(el)
        return () => observer.disconnect()
    }, [items.length])

    const handleStop = async (e: React.MouseEvent, task: BackgroundTask) => {
        e.stopPropagation()
        try {
            await api.sessions.stopTask(sessionId, task.taskId)
        } catch { /* 静默忽略 */ }
    }

    if (items.length === 0) return null

    return (
        <div ref={wrapperRef} style={{ position: 'relative' }}>
            <Global styles={spinKeyframes} />
            <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 4 }}>
                {hasRunning && (
                    <Loader size={12} style={{
                        color: token.colorTextQuaternary,
                        animation: 'tasks-panel-spin 1s linear infinite',
                    }} />
                )}
                <span style={{ fontSize: 11, color: token.colorTextTertiary }}>
                    {t('chat.runningTasks.panelTitle', 'Running Tasks')}
                </span>
                <span style={{
                    fontSize: 10, color: token.colorTextQuaternary,
                    background: token.colorBgTextHover,
                    padding: '0 4px', borderRadius: 4,
                }}>
                    {items.length}
                </span>
                <ClearStateButton
                    sessionId={sessionId}
                    clearField="backgroundTasks"
                    onClear={onClear}
                />
            </div>
            <div
                ref={scrollRef}
                className="hide-scrollbar"
                style={{ maxHeight: 96, overflowY: 'auto', position: 'relative' }}
            >
                <div style={{
                    display: 'flex', gap: 6, flexWrap: 'wrap',
                    flexDirection: narrow ? 'column' : 'row',
                    '--agent-card-width': narrow ? '100%' : '200px',
                } as React.CSSProperties}>
                    {items.map(item => item.kind === 'agent'
                        ? <AgentCard key={item.agent.block.id} agent={item.agent} onClick={() => onAgentClick(item.agent.block)} />
                        : <BackgroundTaskCard key={item.task.taskId} task={item.task} onClick={() => {}} onStop={item.task.status === 'running' ? (e) => handleStop(e, item.task) : undefined} />)}
                </div>
            </div>
            {showFade && (
                <div style={{
                    position: 'absolute', bottom: 4, left: 0, right: 0,
                    height: 24,
                    background: `linear-gradient(transparent, ${token.colorBgLayout})`,
                    pointerEvents: 'none',
                }} />
            )}
        </div>
    )
}
