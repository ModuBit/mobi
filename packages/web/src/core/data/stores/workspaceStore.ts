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
import { uuid } from '@/core/lib/uuid'

/** tab 类型；'terminal' | 'review' 暂不接入（占位） */
export type InspectorTabKind = 'files'

/** 单个 tab：文件树视图或已打开的文件 */
export interface InspectorTabEntry {
    id: string
    kind: 'files'
    mode: 'tree' | 'file'
    /** mode='file'：相对路径（去重 key + tooltip） */
    filePath?: string
    /** mode='file'：tab 显示名 */
    fileName?: string
}

/** 单个 session 的检视面板状态 */
export interface SessionInspectorState {
    /** 检视面板是否展开 */
    expanded: boolean
    /** 左侧占比 0~1 */
    splitRatio: number
    /** 检视面板是否最大化（聊天归零；仅桌面生效） */
    chatHidden: boolean
    /** 打开的 tab 列表（编辑器风格，按需新增） */
    tabs: InspectorTabEntry[]
    /** 当前激活的 tab id；无 tab 时为 null */
    activeTabId: string | null
}

/**
 * 默认状态：首次打开即收起，tabs 为空。
 * freeze 防止外部直接修改污染全局默认值。
 */
export const DEFAULT_INSPECTOR_STATE: Readonly<SessionInspectorState> = Object.freeze({
    expanded: false,
    splitRatio: 0.5,
    chatHidden: false,
    tabs: [],
    activeTabId: null,
})

interface WorkspaceState {
    sessions: Map<string, SessionInspectorState>
    getSession: (sessionId: string) => SessionInspectorState
    setExpanded: (sessionId: string, expanded: boolean) => void
    setSplitRatio: (sessionId: string, ratio: number) => void
    setChatHidden: (sessionId: string, chatHidden: boolean) => void
    /** 「文件」动作：新增一个文件树 tab 并激活 */
    openFileTreeTab: (sessionId: string) => void
    /**
     * 在某个 tab 内打开文件：
     * 若该 filePath 已存在于其它 tab → 仅切激活（去重）；
     * 否则把当前 tab 由 tree 转为 file。
     */
    openFileInTab: (sessionId: string, tabId: string, filePath: string, fileName: string) => void
    /** 关闭 tab；归空则收起 inspector；关的是 active 则激活相邻 */
    closeTab: (sessionId: string, tabId: string) => void
    setActiveTab: (sessionId: string, tabId: string) => void
    clearSession: (sessionId: string) => void
    clearAll: () => void
}

/** 内部辅助：按 session 合并补丁并做值相等短路（仅对 primitive 字段短路）。 */
function applyPatch<K extends keyof SessionInspectorState>(
    state: WorkspaceState,
    sessionId: string,
    patch: Pick<SessionInspectorState, K>,
): WorkspaceState | { sessions: Map<string, SessionInspectorState> } {
    const cur = state.sessions.get(sessionId)
    if (cur) {
        let unchanged = true
        for (const key in patch) {
            if (cur[key] !== patch[key]) {
                unchanged = false
                break
            }
        }
        if (unchanged) return state
    }
    const next = new Map(state.sessions)
    next.set(sessionId, { ...(cur ?? DEFAULT_INSPECTOR_STATE), ...patch })
    return { sessions: next }
}

export const useWorkspaceStore = create<WorkspaceState>((set, get) => ({
    sessions: new Map(),

    getSession: (sessionId) => get().sessions.get(sessionId) ?? DEFAULT_INSPECTOR_STATE,

    setExpanded: (sessionId, expanded) => set((state) => applyPatch(state, sessionId, { expanded })),

    setSplitRatio: (sessionId, splitRatio) => set((state) => applyPatch(state, sessionId, { splitRatio })),

    setChatHidden: (sessionId, chatHidden) => set((state) => applyPatch(state, sessionId, { chatHidden })),

    /** 「文件」动作：新增一个文件树 tab 并激活；已有 tree tab 则直接激活（全局唯一） */
    openFileTreeTab: (sessionId) =>
        set((state) => {
            const cur = state.sessions.get(sessionId) ?? DEFAULT_INSPECTOR_STATE
            // 已有「打开文件」(tree) tab → 直接激活，不重复创建
            const existedTree = cur.tabs.find((t) => t.mode === 'tree')
            if (existedTree) {
                if (cur.activeTabId === existedTree.id) return state
                const next = new Map(state.sessions)
                next.set(sessionId, { ...cur, activeTabId: existedTree.id })
                return { sessions: next }
            }
            const entry: InspectorTabEntry = { id: uuid(), kind: 'files', mode: 'tree' }
            const tabs = [...cur.tabs, entry]
            const next = new Map(state.sessions)
            next.set(sessionId, { ...cur, tabs, activeTabId: entry.id })
            return { sessions: next }
        }),

    openFileInTab: (sessionId, tabId, filePath, fileName) =>
        set((state) => {
            const cur = state.sessions.get(sessionId) ?? DEFAULT_INSPECTOR_STATE
            // 去重：同 filePath 已存在 → 切激活
            const existed = cur.tabs.find((t) => t.mode === 'file' && t.filePath === filePath)
            if (existed) {
                if (cur.activeTabId === existed.id) return state
                const next = new Map(state.sessions)
                next.set(sessionId, { ...cur, activeTabId: existed.id })
                return { sessions: next }
            }
            const tabs = cur.tabs.map((t) =>
                t.id === tabId ? { ...t, mode: 'file' as const, filePath, fileName } : t,
            )
            const next = new Map(state.sessions)
            next.set(sessionId, { ...cur, tabs, activeTabId: tabId })
            return { sessions: next }
        }),

    closeTab: (sessionId, tabId) =>
        set((state) => {
            const cur = state.sessions.get(sessionId) ?? DEFAULT_INSPECTOR_STATE
            const idx = cur.tabs.findIndex((t) => t.id === tabId)
            if (idx === -1) return state
            const tabs = cur.tabs.filter((t) => t.id !== tabId)

            // 归空：收起 inspector，清 active
            if (tabs.length === 0) {
                const next = new Map(state.sessions)
                next.set(sessionId, { ...cur, tabs, activeTabId: null, expanded: false })
                return { sessions: next }
            }
            // active 切相邻
            let activeTabId = cur.activeTabId
            if (cur.activeTabId === tabId) {
                activeTabId = tabs[Math.min(idx, tabs.length - 1)].id
            }
            const next = new Map(state.sessions)
            next.set(sessionId, { ...cur, tabs, activeTabId })
            return { sessions: next }
        }),

    setActiveTab: (sessionId, tabId) =>
        set((state) => applyPatch(state, sessionId, { activeTabId: tabId })),

    clearSession: (sessionId) =>
        set((state) => {
            if (!state.sessions.has(sessionId)) return state
            const next = new Map(state.sessions)
            next.delete(sessionId)
            return { sessions: next }
        }),

    clearAll: () => set({ sessions: new Map() }),
}))
