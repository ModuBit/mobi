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
 * 清单数据口径（todo + task 合并）单一来源
 * TodoPanel 详情与状态气泡摘要都消费本模块——过滤 deleted、合并顺序、状态排序、
 * 计数与进行中文案只有一份，避免摘要数字与展开详情静默漂移。
 */

import type { TaskItem, TodoItem } from '@mobi/shared'

export type ChecklistStatus = 'in_progress' | 'pending' | 'completed'

/** 统一清单条目：todo 与 task 同一呈现，保留原始对象供行内渲染 */
export type ChecklistEntry =
    | { kind: 'todo'; key: string; status: ChecklistStatus; todo: TodoItem }
    | { kind: 'task'; key: string; status: ChecklistStatus; task: TaskItem }

export type ChecklistSummary = {
    /** 按状态排序后的条目（in_progress → pending → completed） */
    items: ChecklistEntry[]
    total: number
    pending: number
    inProgress: number
    completed: number
    allDone: boolean
    /** 进行中文案：todo 优先，其次 task 的 activeForm ?? subject */
    activeText: string | undefined
}

const STATUS_ORDER: Record<ChecklistStatus, number> = {
    in_progress: 0,
    pending: 1,
    completed: 2,
}

export function buildChecklist(todos?: TodoItem[], tasks?: TaskItem[]): ChecklistSummary {
    // 过滤掉 deleted 状态
    const visibleTasks = tasks?.filter(task => task.status !== 'deleted') ?? []

    // 同一状态内先 todo 后 task：ES2019 起 sort 稳定，合并顺序即兜底顺序
    const items: ChecklistEntry[] = [
        ...(todos ?? []).map(todo => ({
            kind: 'todo' as const,
            key: `todo:${todo.content}`,
            status: todo.status,
            todo,
        })),
        ...visibleTasks.map(task => ({
            kind: 'task' as const,
            key: `task:${task.id}`,
            status: task.status as ChecklistStatus,
            task,
        })),
    ].sort((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status])

    let pending = 0, inProgress = 0, completed = 0
    for (const item of items) {
        if (item.status === 'completed') completed++
        else if (item.status === 'in_progress') inProgress++
        else pending++
    }

    const activeTodo = todos?.find(todo => todo.status === 'in_progress')
    const activeTask = visibleTasks.find(task => task.status === 'in_progress')

    return {
        items,
        total: items.length,
        pending,
        inProgress,
        completed,
        allDone: items.length > 0 && completed === items.length,
        activeText: activeTodo
            ? activeTodo.activeForm
            : activeTask
                ? (activeTask.activeForm ?? activeTask.subject)
                : undefined,
    }
}
