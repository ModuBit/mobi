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

/** 检视面板 Tab；后续可扩展 'browser' 等 */
export type InspectorTab = 'files' | 'git' | 'terminal'

/** 单个 session 的检视面板状态 */
export interface SessionInspectorState {
    /** 检视面板是否展开 */
    expanded: boolean
    /** 左侧占比 0~1 */
    splitRatio: number
    /** 当前激活的 Tab */
    activeTab: InspectorTab
}

/**
 * 默认状态：首次打开即收起，满足"默认 leftPanel 100%"。
 * freeze 防止外部直接修改污染全局默认值（参考 notificationBadgeStore 的 EMPTY_BADGE 私有化思路）。
 */
export const DEFAULT_INSPECTOR_STATE: Readonly<SessionInspectorState> = Object.freeze({
    expanded: false,
    splitRatio: 0.5,
    activeTab: 'files',
})

interface WorkspaceState {
    sessions: Map<string, SessionInspectorState>
    /** 读取某 session 状态，无记录返回默认值 */
    getSession: (sessionId: string) => SessionInspectorState
    setExpanded: (sessionId: string, expanded: boolean) => void
    setSplitRatio: (sessionId: string, ratio: number) => void
    setActiveTab: (sessionId: string, tab: InspectorTab) => void
    /** session 删除时清理 */
    clearSession: (sessionId: string) => void
    /** 清空全部（登出时） */
    clearAll: () => void
}

export const useWorkspaceStore = create<WorkspaceState>((set, get) => ({
    sessions: new Map(),

    getSession: (sessionId) => get().sessions.get(sessionId) ?? DEFAULT_INSPECTOR_STATE,

    setExpanded: (sessionId, expanded) =>
        set((state) => {
            const next = new Map(state.sessions)
            next.set(sessionId, { ...(next.get(sessionId) ?? DEFAULT_INSPECTOR_STATE), expanded })
            return { sessions: next }
        }),

    setSplitRatio: (sessionId, splitRatio) =>
        set((state) => {
            const next = new Map(state.sessions)
            next.set(sessionId, { ...(next.get(sessionId) ?? DEFAULT_INSPECTOR_STATE), splitRatio })
            return { sessions: next }
        }),

    setActiveTab: (sessionId, activeTab) =>
        set((state) => {
            const next = new Map(state.sessions)
            next.set(sessionId, { ...(next.get(sessionId) ?? DEFAULT_INSPECTOR_STATE), activeTab })
            return { sessions: next }
        }),

    clearSession: (sessionId) =>
        set((state) => {
            if (!state.sessions.has(sessionId)) return state
            const next = new Map(state.sessions)
            next.delete(sessionId)
            return { sessions: next }
        }),

    clearAll: () => set({ sessions: new Map() }),
}))
