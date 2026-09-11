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

export interface SessionScopedState<T> {
    bySession: Map<string, T>
    set: (sessionId: string, value: T) => void
    clearSession: (sessionId: string) => void
}

/**
 * 「Map<sessionId, T> + 整体替换 + 清除 + 空值哨兵」的会话级缓存 store 工厂。
 * 各镜像 store（前台任务、消息 byId 索引等）此前逐字手抄同一套样板，此处收口：
 * - set 为 REPLACE 语义（调用方负责算好整值，工厂不做合并）
 * - 空值哨兵（empty）必须是稳定引用，避免 selector 每次返回新引用导致 React 19 无限渲染
 * - 需要跨 set 维护附加状态（如 backgroundTasksStore 的终态通知队列）时不适用，仍手写
 */
export function createSessionScopedStore<T>(empty: T) {
    const useStore = create<SessionScopedState<T>>((set) => ({
        bySession: new Map(),

        set: (sessionId, value) =>
            set((state) => {
                const next = new Map(state.bySession)
                next.set(sessionId, value)
                return { bySession: next }
            }),

        clearSession: (sessionId) =>
            set((state) => {
                const next = new Map(state.bySession)
                next.delete(sessionId)
                return { bySession: next }
            }),
    }))

    /** 会话级 selector：无数据时返回稳定空值哨兵 */
    function useSessionScoped(sessionId: string): T {
        return useStore((state) => state.bySession.get(sessionId) ?? empty)
    }

    return { useStore, useSessionScoped }
}
