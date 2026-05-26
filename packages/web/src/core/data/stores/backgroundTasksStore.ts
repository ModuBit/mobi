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

interface BackgroundTasksState {
    tasksBySession: Map<string, BackgroundTask[]>
    setTasks: (sessionId: string, tasks: BackgroundTask[]) => void
    clearSession: (sessionId: string) => void
}

export const useBackgroundTasksStore = create<BackgroundTasksState>((set) => ({
    tasksBySession: new Map(),

    setTasks: (sessionId, tasks) =>
        set((state) => {
            const next = new Map(state.tasksBySession)
            next.set(sessionId, tasks)
            return { tasksBySession: next }
        }),

    clearSession: (sessionId) =>
        set((state) => {
            const next = new Map(state.tasksBySession)
            next.delete(sessionId)
            return { tasksBySession: next }
        }),
}))

// 空数组常量，避免每次 selector 返回新引用导致 React 19 无限渲染
const EMPTY_TASKS: BackgroundTask[] = []

export function useBackgroundTasks(sessionId: string): BackgroundTask[] {
    return useBackgroundTasksStore((state) => state.tasksBySession.get(sessionId) ?? EMPTY_TASKS)
}
