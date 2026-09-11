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
import type { ForegroundTaskItem } from '@mobi/shared/types'

interface ForegroundTasksState {
    tasksBySession: Map<string, ForegroundTaskItem[]>
    setTasks: (sessionId: string, tasks: ForegroundTaskItem[]) => void
    clearSession: (sessionId: string) => void
}

/**
 * 前台执行中任务清单的客户端缓存（foreground-tasks spec）：
 * 数据源是 session.runtimeState.foregroundTasks（hub 消息投影落库，经 SSE 同步），
 * ChatContainer 仿照 backgroundTasks 装配到 store，供「运行中任务」面板订阅。
 * 纯 DB 单源——不再从消息 blocks 现算，展示与消息到达性解耦。
 */
export const useForegroundTasksStore = create<ForegroundTasksState>((set) => ({
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
const EMPTY_TASKS: ForegroundTaskItem[] = []

export function useForegroundTasks(sessionId: string): ForegroundTaskItem[] {
    return useForegroundTasksStore((state) => state.tasksBySession.get(sessionId) ?? EMPTY_TASKS)
}
