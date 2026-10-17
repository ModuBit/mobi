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
 * 卡片网格面板（前台任务 + 后台任务 + 团队成员合并展示）
 * 三者是同一类呈现：头部（运行指示 + 标题 + 计数 + 清理）→ 96px 限高的卡片行
 * → 溢出渐变。合并前是 TasksPanel（前台/后台任务）+ TeamAgentPanel 两个逐行重复的
 * 组件，现在合并进同一块面板、同一条卡片流。
 *
 * - 前台任务读 runtime_state.foregroundTasks（daemon 消息投影落库，纯 DB 单源，
 *   展示与消息到达性解耦；foreground-tasks spec D2），点击打开 ToolDetailDrawer
 * - 后台任务复用 BackgroundTaskCard，标题旁显示闪电图标、运行中带停止按钮
 * - 团队成员读 teamAgentsStore（ChatContainer 同步 teamState），无 teamName 时不展示
 *
 * 排序：运行中在前；同状态按来源（前台 → 后台 → 团队）、再按启动时间倒序。
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import { theme } from 'antd'
import { Global, css } from '@emotion/react'
import { Loader } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useForegroundTasks } from '@/core/data/stores/foregroundTasksStore'
import { useBackgroundTasks } from '@/core/data/stores/backgroundTasksStore'
import { useTeamMembers, useTeamName } from '@/core/data/stores/teamAgentsStore'
import { AgentCard } from './AgentCard'
import { BackgroundTaskCard } from './BackgroundTaskCard'
import { TeamAgentCard } from './TeamAgentCard'
import type { BackgroundTask } from '@/domain/chat/types'
import type { ForegroundTaskItem, TeamMember } from '@mobi/shared/types'
import type { MobiApi } from '@/core/data/api/client'
import { ClearStateButton, type ClearRuntimeStateField } from '@/ui/base/interactive/ClearStateButton'

const spinKeyframes = css`
@keyframes tasks-panel-spin { from { transform: rotate(0deg) } to { transform: rotate(360deg) } }
`

/** 统一面板条目：前台任务 / 后台任务 / 团队成员 */
export type TaskListItem =
    | { kind: 'agent'; task: ForegroundTaskItem }
    | { kind: 'bg-task'; task: BackgroundTask }
    | { kind: 'team'; member: TeamMember }

/** 条目是否处于活跃态（运行中/前台任务恒运行） */
function isActive(item: TaskListItem): boolean {
    switch (item.kind) {
        case 'agent':
            return true
        case 'bg-task':
            return item.task.status === 'running'
        case 'team':
            return item.member.status === 'running'
                || item.member.status === 'active'
                || !item.member.status
    }
}

/** 同状态内的来源顺序：前台 → 后台 → 团队（保持合并前的视觉顺序） */
const GROUP_ORDER: Record<TaskListItem['kind'], number> = {
    agent: 0,
    'bg-task': 1,
    team: 2,
}

/** 条目启动时间；团队成员没有 startedAt，同组内保持原顺序 */
function startedAtOf(item: TaskListItem): number {
    return item.kind === 'team' ? 0 : item.task.startedAt
}

function sortItems(items: TaskListItem[]): TaskListItem[] {
    return [...items].sort((a, b) => {
        const activeDiff = Number(isActive(b)) - Number(isActive(a))
        if (activeDiff !== 0) return activeDiff
        const groupDiff = GROUP_ORDER[a.kind] - GROUP_ORDER[b.kind]
        if (groupDiff !== 0) return groupDiff
        return startedAtOf(b) - startedAtOf(a)
    })
}

/**
 * 面板数据源（合并三类条目并排序）。
 * 面板本体与 composer 气泡共用同一份合并/排序逻辑，避免两处口径漂移。
 */
export function useTasksPanelItems(sessionId: string) {
    const fgTasks = useForegroundTasks(sessionId)
    const bgTasks = useBackgroundTasks(sessionId)
    const members = useTeamMembers(sessionId)
    const teamName = useTeamName(sessionId)

    const { items, activeCount } = useMemo(() => {
        const list: TaskListItem[] = [
            ...fgTasks.map(task => ({ kind: 'agent' as const, task })),
            ...bgTasks.map(task => ({ kind: 'bg-task' as const, task })),
            // 无 teamName 时团队卡片无处可挂（与合并前 TeamAgentPanel 的守卫一致）
            ...(teamName ? members.map(member => ({ kind: 'team' as const, member })) : []),
        ]
        const sorted = sortItems(list)
        return { items: sorted, activeCount: sorted.filter(isActive).length }
    }, [fgTasks, bgTasks, members, teamName])

    return {
        items,
        teamName,
        hasTasks: fgTasks.length > 0 || bgTasks.length > 0,
        hasTeam: Boolean(teamName) && members.length > 0,
        activeCount,
    }
}

export type TasksPanelProps = {
    sessionId: string
    api: MobiApi
    /** 卡片点击统一入口：按 toolUseId 打开详情抽屉（解析与「查不到就不开」的守卫由调用方内聚） */
    onOpenToolUseId: (toolUseId: string | null | undefined) => void
    onClear: (sessionId: string, clearFields: ClearRuntimeStateField[]) => Promise<void>
    /**
     * 呈现形态：panel = 限高卡片行 + 溢出渐变（默认，composer 内联用）；
     * flat = 不限高、全部卡片纵向平铺（气泡 Popover 详情用）
     */
    variant?: 'panel' | 'flat'
}

export function TasksPanel({
    sessionId,
    api,
    onOpenToolUseId,
    onClear,
    variant = 'panel',
}: TasksPanelProps) {
    const { t } = useTranslation()
    const { token } = theme.useToken()
    const { items, teamName, hasTasks, hasTeam, activeCount } = useTasksPanelItems(sessionId)
    const wrapperRef = useRef<HTMLDivElement>(null)
    const scrollRef = useRef<HTMLDivElement>(null)
    const [showFade, setShowFade] = useState(false)
    const [narrow, setNarrow] = useState(false)

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

    const handleStop = async (task: BackgroundTask) => {
        try {
            await api.sessions.stopTask(sessionId, task.taskId)
        } catch { /* 静默忽略 */ }
    }

    if (items.length === 0) return null

    // 面板级清理：清掉本面板展示的全部来源（foreground-tasks spec D6）
    // items 非空 ⇒ 至少命中一类，三元分支保证非空元组（ClearStateButton 要求）
    const clearFields: [ClearRuntimeStateField, ...ClearRuntimeStateField[]] = hasTasks && hasTeam
        ? ['foregroundTasks', 'backgroundTasks', 'teamState']
        : hasTasks
            ? ['foregroundTasks', 'backgroundTasks']
            : ['teamState']

    const header = (
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 4 }}>
            {activeCount > 0 && (
                <Loader size={12} style={{
                    color: token.colorTextQuaternary,
                    animation: 'tasks-panel-spin 1s linear infinite',
                }} />
            )}
            <span style={{ fontSize: 11, color: token.colorTextTertiary }}>
                {hasTasks
                    ? t('chat.runningTasks.panelTitle', 'Running Tasks')
                    : `${t('chat.team.panelTitle', 'Team')}: ${teamName}`}
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
                clearFields={clearFields}
                confirmKey={hasTasks ? 'chat.clearState.runningTasks' : undefined}
                onClear={onClear}
            />
        </div>
    )

    const renderCard = (item: TaskListItem) => {
        switch (item.kind) {
            case 'agent':
                return (
                    <AgentCard
                        key={`agent:${item.task.toolUseId}`}
                        name={item.task.description ?? item.task.subagentType ?? 'Agent'}
                        seed={item.task.toolUseId}
                        onClick={() => onOpenToolUseId(item.task.toolUseId)}
                    />
                )
            case 'bg-task':
                return (
                    <BackgroundTaskCard
                        key={`bg:${item.task.taskId}`}
                        task={item.task}
                        // 不可点（toolUseId=null）的守卫由 BackgroundTaskCard 内聚，此处无条件透传
                        onClick={() => onOpenToolUseId(item.task.toolUseId)}
                        onStop={item.task.status === 'running' ? () => handleStop(item.task) : undefined}
                    />
                )
            case 'team':
                return (
                    <TeamAgentCard
                        key={`team:${item.member.name}`}
                        member={item.member}
                        teamName={teamName!}
                    />
                )
        }
    }

    // flat：气泡 Popover 详情——不限高、全部卡片纵向平铺，清理由头行承担
    // 外衬（纵向 flex / 间距 / 最小宽）由气泡详情容器提供
    if (variant === 'flat') {
        return (
            <>
                {/* 头行 Loader 的动画在两种形态下都要生效 */}
                <Global styles={spinKeyframes} />
                {header}
                <div style={{
                    display: 'flex', flexDirection: 'column', gap: 6,
                    '--agent-card-width': '100%',
                } as React.CSSProperties}>
                    {items.map(renderCard)}
                </div>
            </>
        )
    }

    return (
        <div ref={wrapperRef} style={{ position: 'relative' }}>
            <Global styles={spinKeyframes} />
            {header}
            <div
                ref={scrollRef}
                className={hasTasks ? 'hide-scrollbar' : undefined}
                style={{ maxHeight: 96, overflow: hasTasks ? 'auto' : 'hidden', position: 'relative' }}
            >
                <div style={{
                    display: 'flex', gap: 6, flexWrap: 'wrap',
                    flexDirection: narrow ? 'column' : 'row',
                    '--agent-card-width': narrow ? '100%' : '200px',
                } as React.CSSProperties}>
                    {items.map(renderCard)}
                </div>
                {showFade && (
                    <div style={{
                        position: 'absolute', bottom: hasTasks ? 4 : 0, left: 0, right: 0,
                        height: 24,
                        background: `linear-gradient(transparent, ${hasTasks ? token.colorBgLayout : token.colorBgContainer})`,
                        pointerEvents: 'none',
                    }} />
                )}
            </div>
        </div>
    )
}
