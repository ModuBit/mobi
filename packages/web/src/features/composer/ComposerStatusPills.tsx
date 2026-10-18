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
 * （面板的平铺形态）。清理等动作只在详情里，避免气泡内点击冲突。
 *
 * 定位：浮在聊天区底部、composer 上方——上滚时消息从气泡后面穿过（毛玻璃背景），
 * 滚到底时列表尾部预留 STATUS_PILLS_SPACER_HEIGHT 的空间，最后一条消息落在气泡上方
 * （spacer 由 ChatContainer 追加到 bubbleItems 尾部，本组件只管浮层本身）。
 *
 * 布局：单行固定高度、整体水平居中；超出横向滚动（隐藏滚动条），两端按溢出情况渐隐。
 * 行内没有数据（两个面板都为空）时返回 null。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import styled from '@emotion/styled'
import { keyframes } from '@emotion/react'
import { ListChecks, ListTodo } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { TaskItem, TodoItem } from '@mobi/shared'
import type { MobiApi } from '@/core/data/api/client'
import { STATUS_DOT_COLORS } from '@/core/utils/statusColor'
import { Popover } from '@/ui/base/interactive/popover/Popover'
import type { ClearRuntimeStateField } from '@/ui/base/interactive/ClearStateButton'
import { buildChecklist, type ChecklistSummary } from './checklist'
import { TodoPanel } from './TodoPanel'
import { TasksPanel, useTasksPanelItems, type TaskListItem } from './TasksPanel'

/** 气泡固定高度；气泡行距底边距（Wrap 的 bottom） */
const PILL_HEIGHT = 28
const PILLS_BOTTOM_GAP = 8
/** 气泡行与最后一条消息之间的视觉间距 */
const PILLS_TO_MESSAGE_GAP = 12
/** 气泡行内衬：给胶囊阴影留出绘制空间。
 *  横向滚动容器（overflow-x: auto 会让另一轴的 visible 一并成为裁剪轴）只裁到自身盒边界，
 *  内衬小于阴影外扩范围时阴影会被齐平切断。内衬把气泡整体抬高，Wrap 的底距同步回退抵消。 */
const PILLS_SHADOW_ROOM = 12

/** 列表尾部为气泡让出的高度（由上面三个几何值派生，避免多处魔法数失配） */
export const STATUS_PILLS_SPACER_HEIGHT = PILL_HEIGHT + PILLS_BOTTOM_GAP + PILLS_TO_MESSAGE_GAP

const Wrap = styled.div`
    position: absolute;
    left: 0;
    right: 0;
    /* 内衬把气泡抬高 PILLS_SHADOW_ROOM，底距同步回退，气泡视觉位置不变 */
    bottom: ${PILLS_BOTTOM_GAP - PILLS_SHADOW_ROOM}px;
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

/** 滚动条隐藏走全局 .hide-scrollbar 工具类（与 TasksPanel 等一致） */
const Row = styled.div`
    display: flex;
    overflow-x: auto;
    overflow-y: hidden;
`

/** 内容居中；溢出时 width:max-content + auto margin 仍可完整横向滚动（不会裁掉左侧）。
 *  padding 是阴影绘制空间——裁剪边界在滚动容器的 padding box，必须由内容侧内衬提供。 */
const RowInner = styled.div`
    display: flex;
    align-items: center;
    gap: 8px;
    width: max-content;
    margin-inline: auto;
    padding: ${PILLS_SHADOW_ROOM}px;
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

/** 运行态底部光晕：2.6s 缓慢开合。只动 opacity，不重绘文字与阴影。 */
const ambientBreathe = keyframes`
    0%, 100% { opacity: 0.12; }
    50% { opacity: 0.52; }
`

/** 毛玻璃气泡：半透明底 + backdrop blur，消息从后面穿过时保持可读 */
const Pill = styled.button`
    position: relative;
    isolation: isolate;
    display: inline-flex;
    align-items: center;
    gap: 8px;
    flex: none;
    height: ${PILL_HEIGHT}px;
    padding: 0 12px;
    border: 1px solid var(--ant-color-border-secondary);
    border-radius: calc(${PILL_HEIGHT}px / 2);
    background: color-mix(in srgb, var(--ant-color-bg-container) 86%, transparent);
    backdrop-filter: blur(12px) saturate(1.4);
    -webkit-backdrop-filter: blur(12px) saturate(1.4);
    box-shadow: 0 2px 8px rgb(0 0 0 / 10%);
    color: var(--ant-color-text-secondary);
    font-size: 13px;
    line-height: 1;
    white-space: nowrap;
    cursor: pointer;
    pointer-events: auto;
    transition: background var(--mobi-duration-fast) ease, border-color var(--mobi-duration-fast) ease;
    /* 运行态：底部一抹运行蓝缓慢开合，像内部有能量在流动。
       只在 running 时生成伪元素；z-index: -1 让它落在文案之下、气泡底色之上。 */
    &[data-running]::before {
        content: "";
        position: absolute;
        inset: 0;
        z-index: -1;
        border-radius: inherit;
        background: radial-gradient(
            120% 190% at 50% 120%,
            color-mix(in srgb, ${STATUS_DOT_COLORS.running} 60%, transparent),
            transparent 62%
        );
        pointer-events: none;
        will-change: opacity;
        animation: ${ambientBreathe} 2.6s ease-in-out infinite;
    }
    &:hover {
        background: color-mix(in srgb, var(--ant-color-bg-container) 94%, transparent);
    }
    &:focus-visible {
        outline: 2px solid var(--mobi-primary);
        outline-offset: 1px;
    }
    @media (prefers-reduced-motion: reduce) {
        transition: none;
        /* 停转时保留一层常亮微光作为静态线索 */
        &[data-running]::before {
            animation: none;
            opacity: 0.3;
        }
    }
`

const PillIcon = styled.span`
    display: inline-flex;
    flex: none;
    color: var(--ant-color-text-tertiary);
`

/** 运行中气泡的主文案加粗一档，作为“在动”之外的静态线索 */
const PillLabel = styled.span<{ $strong?: boolean }>`
    font-weight: ${({ $strong }) => ($strong ? 600 : 500)};
    color: var(--ant-color-text);
    font-variant-numeric: tabular-nums;
`

const PillExtra = styled.span`
    color: var(--ant-color-text-tertiary);
    font-weight: 600;
    font-variant-numeric: tabular-nums;
`

const Separator = styled.span`
    color: var(--ant-color-text-quaternary);
`

/** Popover 详情容器：平铺面板的外衬 + 限高内滚（滚到边界不带动背后的页面） */
const DetailScroll = styled.div`
    display: flex;
    flex-direction: column;
    gap: 6px;
    min-width: 260px;
    max-height: 60vh;
    overflow-y: auto;
    overscroll-behavior: contain;
`

export type ComposerStatusSummary = {
    showTodo: boolean
    showTasks: boolean
    taskItems: TaskListItem[]
    activeCount: number
    checklist: ChecklistSummary
}

/**
 * 气泡摘要口径（单次计算，ChatContainer 与气泡本体共用）：
 * - 清单 = buildChecklist（todo + 未删除 task 的合并口径，与 TodoPanel 详情同源）
 * - 任务 = useTasksPanelItems 的合并排序结果（任务 + 团队成员）
 */
export function useComposerStatusSummary(
    sessionId: string,
    todos: TodoItem[] | undefined,
    tasks: TaskItem[] | undefined,
): ComposerStatusSummary {
    const checklist = useMemo(() => buildChecklist(todos, tasks), [todos, tasks])
    const { items: taskItems, activeCount } = useTasksPanelItems(sessionId)

    return useMemo(() => ({
        checklist,
        taskItems,
        activeCount,
        showTodo: checklist.total > 0,
        showTasks: taskItems.length > 0,
    }), [checklist, taskItems, activeCount])
}

export type ComposerStatusPillsProps = {
    summary: ComposerStatusSummary
    todos: TodoItem[] | undefined
    tasks: TaskItem[] | undefined
    sessionId: string
    api: MobiApi
    /** 任务卡片点击：按 toolUseId 打开工具详情（解析与守卫由 useToolDetailDrawer 承担） */
    onOpenToolUseId: (toolUseId: string | null | undefined) => void
    onClear: (sessionId: string, clearFields: ClearRuntimeStateField[]) => Promise<void>
}

type PillKey = 'tasks' | 'todo'

export function ComposerStatusPills({
    summary,
    todos,
    tasks,
    sessionId,
    api,
    onOpenToolUseId,
    onClear,
}: ComposerStatusPillsProps) {
    const { t } = useTranslation()
    const rowRef = useRef<HTMLDivElement>(null)
    const innerRef = useRef<HTMLDivElement>(null)
    const [edges, setEdges] = useState({ left: false, right: false })
    // 两个气泡的详情互斥：同时打开会叠在一起（2026-10-17 验收实拍）。
    // 收尾时只有「当前打开的那一个」能关自己——点另一个气泡会先触发本气泡的
    // 点外关闭、再触发对方的打开，若盲目 null 化会把刚到手的打开态冲掉。
    const [openPill, setOpenPill] = useState<PillKey | null>(null)

    // 边沿测量：滚动与尺寸变化都会改可达范围，只在状态变化时 setState
    const updateEdges = useCallback(() => {
        const el = rowRef.current
        if (!el) return
        const left = el.scrollLeft > 1
        const right = el.scrollLeft + el.clientWidth < el.scrollWidth - 1
        setEdges(prev => (prev.left === left && prev.right === right ? prev : { left, right }))
    }, [])

    // 首帧可能因无数据返回 null（Row 未挂载、rowRef 为 null）；数据到达后 Row 才挂上，
    // 因此 effect 必须随可见性重跑，否则 observer 永不挂载、渐隐恒不出现。
    const visible = summary.showTodo || summary.showTasks
    useEffect(() => {
        if (!visible) return
        const el = rowRef.current
        if (!el) return
        // 同时观察外框（容器宽度）与内容（文案/气泡数量导致的宽度变化），
        // 不再依赖「每次渲染后量一次」的强制布局读取
        const observer = new ResizeObserver(updateEdges)
        observer.observe(el)
        if (innerRef.current) observer.observe(innerRef.current)
        el.addEventListener('scroll', updateEdges, { passive: true })
        updateEdges()
        return () => {
            observer.disconnect()
            el.removeEventListener('scroll', updateEdges)
        }
    }, [updateEdges, visible])

    // 气泡消失（清单/任务被清空）时丢弃打开态：受控 Popover 卸载不会回调 onOpenChange，
    // 若不清空，气泡下次出现会以 open=true 直接弹出或残留到另一类气泡上。
    useEffect(() => {
        setOpenPill(prev => {
            if (prev === 'todo' && !summary.showTodo) return null
            if (prev === 'tasks' && !summary.showTasks) return null
            return prev
        })
    }, [summary.showTodo, summary.showTasks])

    /** 同一时刻最多一个详情打开：open 由单一 key 推导，关闭只响应自己 */
    const bindPopover = (key: PillKey) => ({
        open: openPill === key,
        onOpenChange: (open: boolean) =>
            setOpenPill(prev => (open ? key : prev === key ? null : prev)),
    })

    if (!visible) return null

    // 运行态：任务气泡看活跃任务数；清单气泡看进行中项数（全部完成时恒为 0）
    const tasksRunning = summary.activeCount > 0
    const todoRunning = summary.checklist.inProgress > 0

    return (
        <Wrap>
            <Box>
                <Row
                    ref={rowRef}
                    className="hide-scrollbar"
                    data-testid="composer-status-pills"
                    aria-label={t('chat.statusPills.label', 'Status')}
                >
                    <RowInner ref={innerRef}>
                        {summary.showTasks && (
                            <Popover
                                trigger="click"
                                side="top"
                                {...bindPopover('tasks')}
                                content={(
                                    <DetailScroll>
                                        <TasksPanel
                                            sessionId={sessionId}
                                            api={api}
                                            onOpenToolUseId={onOpenToolUseId}
                                            onClear={onClear}
                                        />
                                    </DetailScroll>
                                )}
                            >
                                <Pill type="button" data-testid="status-pill-tasks" data-running={tasksRunning || undefined}>
                                    <PillIcon aria-hidden="true"><ListChecks size={16} /></PillIcon>
                                    <PillLabel $strong={tasksRunning}>
                                        {tasksRunning
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
                                side="top"
                                {...bindPopover('todo')}
                                content={(
                                    <DetailScroll>
                                        <TodoPanel
                                            todos={todos}
                                            tasks={tasks}
                                            sessionId={sessionId}
                                            onClear={onClear}
                                        />
                                    </DetailScroll>
                                )}
                            >
                                <Pill type="button" data-testid="status-pill-todo" data-running={todoRunning || undefined}>
                                    <PillIcon aria-hidden="true"><ListTodo size={16} /></PillIcon>
                                    <PillLabel>
                                        {summary.checklist.allDone
                                            ? t('chat.statusPills.allDone')
                                            : t('chat.statusPills.todoCompleted', {
                                                completed: summary.checklist.completed,
                                                total: summary.checklist.total,
                                            })}
                                    </PillLabel>
                                    {todoRunning && (
                                        <>
                                            <Separator aria-hidden="true">·</Separator>
                                            <PillExtra>
                                                {t('chat.statusPills.executing', { count: summary.checklist.inProgress })}
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
