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
 * 清单面板（todo + task 合并展示）
 * CLI 的 TodoWrite 清单（todos）与任务清单（tasks）是同一类呈现，合并进一个折叠面板：
 * 一个头行（图标 + 进行中文案 + 合并完成统计 + 清理）+ 一条按状态排序的勾选列表。
 * - todo 行显示 content
 * - task 行显示 `id: subject`，副行 description，过滤 deleted 状态
 * 同一状态内先 todo 后 task，保持合并前「todo 在上、task 在下」的阅读顺序。
 * 合并前是 TodoPanel / TaskPanel 两个逐行重复的组件。
 */

import { useState, type ReactNode } from 'react'
import { Collapse, Checkbox, Typography, theme } from 'antd'
import { Lightbulb } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import styled from '@emotion/styled'
import type { TodoItem, TaskItem } from '@mobi/shared'
import { ClearStateButton, type ClearRuntimeStateField } from '@/ui/base/interactive/ClearStateButton'
import { ShinyText } from '@/ui/base/motion/ShinyText'

/** 任务橙色，参考 Claude Code */
const CHECKLIST_ORANGE = '#e8825c'
const CHECKLIST_GREEN = '#52c41a'

type ChecklistStatus = 'in_progress' | 'pending' | 'completed'

interface ChecklistItem {
    key: string
    status: ChecklistStatus
    /** 行主文案（已按状态着色的渲染结果） */
    content: ReactNode
    /** 副文案（可选，有值时行改为顶部对齐的两行布局） */
    description?: ReactNode
}

const STATUS_ORDER: Record<ChecklistStatus, number> = {
    in_progress: 0,
    pending: 1,
    completed: 2,
}

const StyledCheckbox = styled(Checkbox)`
    .ant-checkbox-inner {
        border-radius: var(--radius-square);
    }
    &.ant-checkbox-checked .ant-checkbox-inner {
        background-color: ${CHECKLIST_GREEN};
        border-color: ${CHECKLIST_GREEN};
    }
    &.ant-checkbox-indeterminate .ant-checkbox-inner {
        background-color: ${CHECKLIST_ORANGE};
        border-color: ${CHECKLIST_ORANGE};
    }
    &.ant-checkbox-indeterminate .ant-checkbox-inner::after {
        background: #fff;
    }
`

export type TodoPanelProps = {
    todos: TodoItem[] | undefined
    tasks: TaskItem[] | undefined
    sessionId: string
    onClear: (sessionId: string, clearFields: ClearRuntimeStateField[]) => Promise<void>
    /**
     * 呈现形态：panel = 折叠面板（默认，composer 内联用）；
     * flat = 不要 Collapse 壳、头行 + 列表直接平铺（气泡 Popover 详情用）
     */
    variant?: 'panel' | 'flat'
}

export function TodoPanel({ todos, tasks, sessionId, onClear, variant = 'panel' }: TodoPanelProps) {
    const { token } = theme.useToken()
    const { t } = useTranslation()
    const [activeKeys, setActiveKeys] = useState<string[]>([])

    // 过滤掉 deleted 状态
    const visibleTasks = tasks?.filter(task => task.status !== 'deleted') ?? []

    const items: ChecklistItem[] = [
        ...(todos ?? []).map(todo => ({
            key: `todo:${todo.content}`,
            status: todo.status,
            content: <TodoText todo={todo} />,
        })),
        ...visibleTasks.map(task => ({
            key: `task:${task.id}`,
            status: task.status as ChecklistStatus,
            content: <TaskText task={task} />,
            description: task.description ? <TaskDescription task={task} /> : undefined,
        })),
    ]

    if (items.length === 0) return null

    const sortedItems = items
        .map((item, idx) => ({ item, idx }))
        .sort((a, b) => STATUS_ORDER[a.item.status] - STATUS_ORDER[b.item.status] || a.idx - b.idx)
        .map(({ item }) => item)

    let completed = 0, inProgress = 0
    for (const item of items) {
        if (item.status === 'completed') completed++
        else if (item.status === 'in_progress') inProgress++
    }
    const total = items.length

    // 进行中文案：todo 用 activeForm，task 用 activeForm ?? subject；两者都有时取 todo（同列表顺序）
    const activeTodo = todos?.find(todo => todo.status === 'in_progress')
    const activeTask = visibleTasks.find(task => task.status === 'in_progress')
    const activeText = activeTodo
        ? activeTodo.activeForm
        : activeTask
            ? (activeTask.activeForm ?? activeTask.subject)
            : undefined

    const header = (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
            <Lightbulb size={14} color={CHECKLIST_ORANGE} />
            {activeText ? (
                <ShinyText solid style={{ color: CHECKLIST_ORANGE }}>
                    {activeText}
                </ShinyText>
            ) : completed === total ? (
                <span style={{ color: CHECKLIST_GREEN, fontWeight: 500 }}>✓ {t('chat.todo.allCompleted')}</span>
            ) : (
                <span style={{ color: token.colorTextTertiary }}>
                    {t('chat.task.pendingCount', { count: total - completed })}
                </span>
            )}
            <span style={{ fontSize: 12, color: token.colorTextTertiary, marginLeft: 4 }}>
                <span style={{ color: token.colorTextSecondary, fontWeight: 500 }}>{completed}/{total}</span> {t('chat.todo.completed')}
                {inProgress > 0 && (
                    <>
                        {' · '}
                        <span style={{ color: CHECKLIST_ORANGE, fontWeight: 500 }}>{inProgress}</span> {t('chat.todo.inProgress')}
                    </>
                )}
            </span>
            <ClearStateButton
                sessionId={sessionId}
                clearFields={["todos", "tasks"]}
                onClear={onClear}
            />
        </div>
    )

    const list = (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {sortedItems.map((item) => (
                <div
                    key={item.key}
                    style={{
                        display: 'flex',
                        alignItems: item.description ? 'flex-start' : 'center',
                        gap: 8,
                        fontSize: 13,
                    }}
                >
                    <StyledCheckbox
                        checked={item.status === 'completed'}
                        indeterminate={item.status === 'in_progress'}
                        disabled
                        style={item.description ? { lineHeight: '22px' } : undefined}
                    />
                    {item.description ? (
                        <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
                            {item.content}
                            {item.description}
                        </div>
                    ) : item.content}
                </div>
            ))}
        </div>
    )

    // flat：气泡 Popover 详情——不要折叠壳，头行与列表直接平铺
    if (variant === 'flat') {
        return (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 260 }}>
                {header}
                {list}
            </div>
        )
    }

    return (
        <Collapse
            activeKey={activeKeys}
            onChange={(keys) => setActiveKeys(Array.isArray(keys) ? keys : [keys])}
            bordered={false}
            size="small"
            items={[{ key: 'checklist', label: header, children: list }]}
        />
    )
}

function TodoText({ todo }: { todo: TodoItem }) {
    const { token } = theme.useToken()

    if (todo.status === 'in_progress') {
        return (
            <ShinyText solid style={{ color: CHECKLIST_ORANGE, fontWeight: 600 }}>
                {todo.content}
            </ShinyText>
        )
    }

    if (todo.status === 'completed') {
        return (
            <span style={{ textDecoration: 'line-through', color: token.colorTextQuaternary }}>
                {todo.content}
            </span>
        )
    }

    return <span style={{ color: token.colorTextTertiary }}>{todo.content}</span>
}

function taskLabel(task: TaskItem) {
    return `${task.id}: ${task.subject}`
}

function TaskText({ task }: { task: TaskItem }) {
    const { token } = theme.useToken()
    const label = taskLabel(task)

    if (task.status === 'in_progress') {
        return (
            <ShinyText solid style={{ color: CHECKLIST_ORANGE, fontWeight: 600 }}>
                {label}
            </ShinyText>
        )
    }

    if (task.status === 'completed') {
        return (
            <span style={{ textDecoration: 'line-through', color: token.colorTextQuaternary }}>
                {label}
            </span>
        )
    }

    return <span style={{ color: token.colorTextTertiary }}>{label}</span>
}

const { Text } = Typography

function TaskDescription({ task }: { task: TaskItem }) {
    const { token } = theme.useToken()

    return (
        <Text
            style={{
                fontSize: 12,
                color: token.colorTextQuaternary,
                lineHeight: '18px',
                textDecoration: task.status === 'completed' ? 'line-through' : 'none',
            }}
            ellipsis
        >
            {task.description}
        </Text>
    )
}
