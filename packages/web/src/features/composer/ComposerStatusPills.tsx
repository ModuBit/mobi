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
 * composer 状态气泡行（浮层）
 * 把 TodoPanel（todo + task 清单）与 TasksPanel（前台/后台任务 + 团队成员）收成
 * 一行状态气泡：气泡只放「一眼判断状态」的摘要，点击用 Popover 展示平铺详情
 * （面板的 variant="flat"）。清理等动作只在详情里，避免气泡内点击冲突。
 *
 * 定位：浮在聊天区底部、composer 上方——上滚时消息从气泡后面穿过（毛玻璃背景），
 * 滚到底时列表尾部预留 STATUS_PILLS_SPACER_HEIGHT 的空间，最后一条消息落在气泡上方
 * （spacer 由 ChatContainer 追加到 bubbleItems 尾部，本组件只管浮层本身）。
 *
 * 布局：单行固定高度、整体水平居中；超出横向滚动（隐藏滚动条），两端按溢出情况渐隐。
 * 行内没有数据（两个面板都为空）时返回 null。
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { Popover } from 'antd'
import styled from '@emotion/styled'
import { ListChecks, ListTodo } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { TaskItem, TodoItem } from '@mobi/shared'
import type { MobiApi } from '@/core/data/api/client'
import type { BackgroundTask, ToolCallBlock } from '@/domain/chat/types'
import type { ClearRuntimeStateField } from '@/ui/base/interactive/ClearStateButton'
import { TodoPanel } from './TodoPanel'
import { TasksPanel, useTasksPanelItems } from './TasksPanel'

/**
 * 列表尾部为气泡让出的高度：气泡行高 24 + 距底 8 + 与最后一条消息的间距 12。
 * 与气泡行样式同源维护（改高度时两边一起改）。
 */
export const STATUS_PILLS_SPACER_HEIGHT = 44

const Wrap = styled.div`
    position: absolute;
    left: 0;
    right: 0;
    bottom: 8px;
    z-index: 9;
    display: flex;
    justify-content: center;
    pointer-events: none;
`

const Box = styled.div`
    position: relative;
    max-width: 100%;
    pointer-events: none;
`

const Row = styled.div`
    display: flex;
    overflow-x: auto;
    overflow-y: hidden;
    scrollbar-width: none;
    &::-webkit-scrollbar {
        display: none;
    }
`

/** 内容居中；溢出时 width:max-content + auto margin 仍可完整横向滚动（不会裁掉左侧） */
const RowInner = styled.div`
    display: flex;
    align-items: center;
    gap: 8px;
    width: max-content;
    margin-inline: auto;
    padding: 2px;
    pointer-events: none;
`

/** 两端渐隐：只在该侧确实还有内容时出现 */
const Edge = styled.div<{ $side: 'left' | 'right' }>`
    position: absolute;
    top: 0;
    bottom: 0;
    width: 24px;
    pointer-events: none;
    ${({ $side }) => ($side === 'left' ? 'left: 0;' : 'right: 0;')}
    background: linear-gradient(
        to ${({ $side }) => ($side === 'left' ? 'right' : 'left')},
        var(--ant-color-bg-layout),
        transparent
    );
`

/** 毛玻璃气泡：半透明底 + backdrop blur，消息从后面穿过时保持可读 */
const Pill = styled.button`
    display: inline-flex;
    align-items: center;
    gap: 6px;
    flex: none;
    height: 24px;
    padding: 0 10px;
    border: 1px solid color-mix(in srgb, var(--ant-color-border-secondary) 80%, transparent);
    border-radius: 12px;
    background: color-mix(in srgb, var(--ant-color-bg-container) 70%, transparent);
    backdrop-filter: blur(12px) saturate(1.4);
    -webkit-backdrop-filter: blur(12px) saturate(1.4);
    box-shadow: 0 1px 4px rgb(0 0 0 / 8%);
    color: var(--ant-color-text-secondary);
    font-size: 12px;
    line-height: 1;
    white-space: nowrap;
    cursor: pointer;
    pointer-events: auto;
    transition: background var(--mobi-duration-fast) ease, border-color var(--mobi-duration-fast) ease;
    &:hover {
        background: color-mix(in srgb, var(--ant-color-bg-container) 88%, transparent);
    }
    &:focus-visible {
        outline: 2px solid var(--mobi-primary);
        outline-offset: 1px;
    }
    @media (prefers-reduced-motion: reduce) {
        transition: none;
    }
`

const PillIcon = styled.span`
    display: inline-flex;
    flex: none;
    color: var(--ant-color-text-tertiary);
`

const PillLabel = styled.span`
    font-weight: 500;
    color: var(--ant-color-text);
    font-variant-numeric: tabular-nums;
`

const PillExtra = styled.span`
    color: var(--ant-color-text-tertiary);
    font-variant-numeric: tabular-nums;
`

const Separator = styled.span`
    color: var(--ant-color-text-quaternary);
`

/** Popover 详情容器：限高内滚，滚到边界不带动背后的页面 */
const DetailScroll = styled.div`
    max-height: 60vh;
    overflow-y: auto;
    overscroll-behavior: contain;
`

type PillSummary = {
    showTodo: boolean
    showTasks: boolean
    taskItems: ReturnType<typeof useTasksPanelItems>['items']
    activeCount: number
    checklistTotal: number
    checklistPending: number
    checklistInProgress: number
    checklistAllDone: boolean
}

/**
 * 气泡摘要口径（与两个面板同源）：
 * - 清单 = todos + 未删除 tasks（TodoPanel 的合并口径）
 * - 任务 = useTasksPanelItems 的合并排序结果（任务 + 团队成员）
 */
function usePillSummary(
    sessionId: string,
    todos: TodoItem[] | undefined,
    tasks: TaskItem[] | undefined,
): PillSummary {
    const { items: taskItems, activeCount } = useTasksPanelItems(sessionId)

    const visibleTasks = tasks?.filter(task => task.status !== 'deleted') ?? []
    const checklist = [...(todos ?? []), ...visibleTasks]
    const checklistTotal = checklist.length
    const checklistPending = checklist.filter(item => item.status === 'pending').length
    const checklistInProgress = checklist.filter(item => item.status === 'in_progress').length
    const checklistDone = checklist.filter(item => item.status === 'completed').length

    return {
        showTodo: checklistTotal > 0,
        showTasks: taskItems.length > 0,
        taskItems,
        activeCount,
        checklistTotal,
        checklistPending,
        checklistInProgress,
        checklistAllDone: checklistTotal > 0 && checklistDone === checklistTotal,
    }
}

/** 气泡行是否有内容（ChatContainer 用它决定是否在列表尾部追加让位 spacer） */
export function useStatusPillsVisibility(
    sessionId: string,
    todos: TodoItem[] | undefined,
    tasks: TaskItem[] | undefined,
): boolean {
    const { showTodo, showTasks } = usePillSummary(sessionId, todos, tasks)
    return showTodo || showTasks
}

export type ComposerStatusPillsProps = {
    todos: TodoItem[] | undefined
    tasks: TaskItem[] | undefined
    sessionId: string
    api: MobiApi
    onAgentClick: (block: ToolCallBlock) => void
    onTaskClick: (task: BackgroundTask) => void
    onClear: (sessionId: string, clearFields: ClearRuntimeStateField[]) => Promise<void>
}

export function ComposerStatusPills({
    todos,
    tasks,
    sessionId,
    api,
    onAgentClick,
    onTaskClick,
    onClear,
}: ComposerStatusPillsProps) {
    const { t } = useTranslation()
    const summary = usePillSummary(sessionId, todos, tasks)
    const rowRef = useRef<HTMLDivElement>(null)
    const [edges, setEdges] = useState({ left: false, right: false })
    // 两个气泡的详情互斥：同时打开会叠在一起（2026-10-17 验收实拍）。
    // 收尾时只有「当前打开的那一个」能关自己——点另一个气泡会先触发本气泡的
    // 点外关闭、再触发对方的打开，若盲目 null 化会把刚到手的打开态冲掉。
    const [openPill, setOpenPill] = useState<'tasks' | 'todo' | null>(null)

    // 每次渲染后量一次边沿（气泡文案/数量变化都会改变宽度），只在状态变化时 setState
    const updateEdges = useCallback(() => {
        const el = rowRef.current
        if (!el) return
        const left = el.scrollLeft > 1
        const right = el.scrollLeft + el.clientWidth < el.scrollWidth - 1
        setEdges(prev => (prev.left === left && prev.right === right ? prev : { left, right }))
    }, [])

    useEffect(() => {
        updateEdges()
    })

    useEffect(() => {
        const el = rowRef.current
        if (!el) return
        const observer = new ResizeObserver(updateEdges)
        observer.observe(el)
        el.addEventListener('scroll', updateEdges, { passive: true })
        return () => {
            observer.disconnect()
            el.removeEventListener('scroll', updateEdges)
        }
    }, [updateEdges])

    if (!summary.showTodo && !summary.showTasks) return null

    return (
        <Wrap>
            <Box>
                <Row ref={rowRef} data-testid="composer-status-pills" aria-label={t('chat.statusPills.label', 'Status')}>
                    <RowInner>
                        {summary.showTasks && (
                            <Popover
                                trigger="click"
                                placement="top"
                                open={openPill === 'tasks'}
                                onOpenChange={(open) => setOpenPill(prev => open ? 'tasks' : prev === 'tasks' ? null : prev)}
                                content={(
                                    <DetailScroll>
                                        <TasksPanel
                                            sessionId={sessionId}
                                            api={api}
                                            onAgentClick={onAgentClick}
                                            onTaskClick={onTaskClick}
                                            onClear={onClear}
                                            variant="flat"
                                        />
                                    </DetailScroll>
                                )}
                            >
                                <Pill type="button" data-testid="status-pill-tasks">
                                    <PillIcon aria-hidden="true"><ListChecks size={14} /></PillIcon>
                                    <PillLabel>
                                        {summary.activeCount > 0
                                            ? t('chat.statusPills.tasksExecuting', {
                                                active: summary.activeCount,
                                                total: summary.taskItems.length,
                                            })
                                            : t('chat.statusPills.tasksTotal', { total: summary.taskItems.length })}
                                    </PillLabel>
                                </Pill>
                            </Popover>
                        )}

                        {summary.showTodo && (
                            <Popover
                                trigger="click"
                                placement="top"
                                open={openPill === 'todo'}
                                onOpenChange={(open) => setOpenPill(prev => open ? 'todo' : prev === 'todo' ? null : prev)}
                                content={(
                                    <DetailScroll>
                                        <TodoPanel
                                            todos={todos}
                                            tasks={tasks}
                                            sessionId={sessionId}
                                            onClear={onClear}
                                            variant="flat"
                                        />
                                    </DetailScroll>
                                )}
                            >
                                <Pill type="button" data-testid="status-pill-todo">
                                    <PillIcon aria-hidden="true"><ListTodo size={14} /></PillIcon>
                                    <PillLabel>
                                        {summary.checklistAllDone
                                            ? t('chat.statusPills.allDone')
                                            : t('chat.statusPills.todoPending', {
                                                pending: summary.checklistPending,
                                                total: summary.checklistTotal,
                                            })}
                                    </PillLabel>
                                    {!summary.checklistAllDone && summary.checklistInProgress > 0 && (
                                        <>
                                            <Separator aria-hidden="true">·</Separator>
                                            <PillExtra>
                                                {t('chat.statusPills.executing', { count: summary.checklistInProgress })}
                                            </PillExtra>
                                        </>
                                    )}
                                </Pill>
                            </Popover>
                        )}
                    </RowInner>
                </Row>
                {edges.left && <Edge $side="left" aria-hidden="true" />}
                {edges.right && <Edge $side="right" aria-hidden="true" />}
            </Box>
        </Wrap>
    )
}
