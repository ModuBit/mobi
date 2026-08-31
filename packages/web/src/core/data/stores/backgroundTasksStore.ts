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

import { create } from 'zustand'
import type { BackgroundTask } from '@/domain/chat/types'

/** 被移除的后台任务通知 */
export type BackgroundTaskRemovedNotification = {
    taskId: string
    description: string
    /** 与 BackgroundTask.toolName 同口径（'unknown' 为补建条目的诚实降级值） */
    toolName: BackgroundTask['toolName']
    status: 'completed' | 'failed' | 'stopped'
    /** 后台任务完成摘要 */
    summary?: string
}

interface BackgroundTasksState {
    tasksBySession: Map<string, BackgroundTask[]>
    /** 被移除的任务通知队列，组件通过 consumeRemoved 排空 */
    removedQueue: BackgroundTaskRemovedNotification[]
    setTasks: (sessionId: string, tasks: BackgroundTask[]) => void
    clearSession: (sessionId: string) => void
    consumeRemoved: () => BackgroundTaskRemovedNotification[]
}

const TERMINAL_STATUSES = new Set(['completed', 'failed', 'stopped'])

export const useBackgroundTasksStore = create<BackgroundTasksState>((set, get) => ({
    tasksBySession: new Map(),
    removedQueue: [],

    setTasks: (sessionId, tasks) =>
        set((state) => {
            const prev = state.tasksBySession.get(sessionId) ?? []
            const prevMap = new Map(prev.map(t => [t.taskId, t]))

            // 检测 status 从 running → terminal 的变化
            const completed: BackgroundTaskRemovedNotification[] = []
            for (const task of tasks) {
                const prevTask = prevMap.get(task.taskId)
                if (prevTask && prevTask.status === 'running' && TERMINAL_STATUSES.has(task.status)) {
                    completed.push({
                        taskId: task.taskId,
                        description: task.description,
                        toolName: task.toolName,
                        status: task.status as BackgroundTaskRemovedNotification['status'],
                        summary: task.summary,
                    })
                }
            }

            // 存储所有任务（包含终态），供 TasksPanel 展示
            const next = new Map(state.tasksBySession)
            next.set(sessionId, tasks)

            return {
                tasksBySession: next,
                removedQueue: completed.length > 0
                    ? [...state.removedQueue, ...completed]
                    : state.removedQueue,
            }
        }),

    clearSession: (sessionId) =>
        set((state) => {
            const next = new Map(state.tasksBySession)
            next.delete(sessionId)
            return { tasksBySession: next }
        }),

    consumeRemoved: () => {
        const queue = get().removedQueue
        if (queue.length === 0) return []
        set({ removedQueue: [] })
        return queue
    },
}))

// 空数组常量，避免每次 selector 返回新引用导致 React 19 无限渲染
const EMPTY_TASKS: BackgroundTask[] = []

export function useBackgroundTasks(sessionId: string): BackgroundTask[] {
    return useBackgroundTasksStore((state) => state.tasksBySession.get(sessionId) ?? EMPTY_TASKS)
}
