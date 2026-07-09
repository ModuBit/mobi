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

/** 每 session 终端数上限（与后端 DEFAULT_MAX_TERMINALS 对齐） */
export const MAX_TERMINALS_PER_SESSION = 3

/** 单个 tab：文件树视图、已打开的文件或终端 */
export interface InspectorTabEntry {
    id: string
    mode: 'tree' | 'file' | 'terminal'
    /** mode='file'：相对路径（去重 key + tooltip） */
    filePath?: string
    /** mode='file'：tab 显示名 */
    fileName?: string
    /** mode='terminal'：后端 PTY id（前端 uuid 生成） */
    terminalId?: string
    /** mode='terminal'：默认序号（终端 1/2/3，不重用） */
    terminalSeq?: number
    /** mode='terminal'：自定义名（双击重命名）；空则显示"终端 N" */
    title?: string
    /**
     * 该 tab 的视图状态（切走再切回恢复）。挂 tab 上：closeTab 自动清；新类型只需扩字段。
     * 通用 scrollRatio（所有可滚动类型共用）+ 按需扩展（scale 仅可缩放类型如 PDF）。
     */
    viewState?: TabViewState
}

/**
 * tab 视图状态：跨 session 切换恢复用。各类型按需扩展（PDF 加 scale；未来 markdown/代码复用 scrollRatio）。
 * 用比例（scrollRatio）而非绝对 scrollTop：scrollHeight 含缩放/换行变化，绝对像素会偏；比例稳定。
 */
export interface TabViewState {
    /** 滚动比例 scrollTop/scrollHeight（[0,1]），所有可滚动类型通用 */
    scrollRatio?: number
    /** 缩放（1=100%），仅可缩放类型（如 PDF） */
    scale?: number
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
    /** 终端序号计数器（只增不减，不重用，仿 VSCode） */
    nextTerminalSeq: number
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
    nextTerminalSeq: 1,
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
    /** 「终端」动作：新建一个终端 tab 并激活；返回新 tab id */
    openTerminalTab: (sessionId: string) => string
    /** 重命名终端 tab（title 去空白后为空则回退默认"终端 N"） */
    renameTerminalTab: (sessionId: string, tabId: string, title: string) => void
    /** 关闭 tab；归空则收起 inspector；关的是 active 则激活相邻 */
    closeTab: (sessionId: string, tabId: string) => void
    setActiveTab: (sessionId: string, tabId: string) => void
    /** 记住某 tab 的视图状态（滚动比例/缩放等）；patch 与现有值逐字段合并，同值短路 */
    setTabViewState: (sessionId: string, tabId: string, patch: Partial<TabViewState>) => void
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
            const entry: InspectorTabEntry = { id: uuid(), mode: 'tree' }
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
            // 转换：把 tabId 指向的 tab 转为 file（tree→file 或 file→换文件）。
            // 关键：换文件时必须清旧 viewState——viewState 属于上一个文件的内容（缩放/滚动），
            // 同 tab 切到新文件（含 pdf↔pdf、pdf↔非pdf、非pdf↔非pdf）旧值已失效，
            // 残留会导致新文件继承旧文件的缩放/滚动位置。
            const tabs = cur.tabs.map((t) =>
                t.id === tabId ? { ...t, mode: 'file' as const, filePath, fileName, viewState: undefined } : t,
            )
            const next = new Map(state.sessions)
            next.set(sessionId, { ...cur, tabs, activeTabId: tabId })
            return { sessions: next }
        }),

    openTerminalTab: (sessionId) => {
        // 先生成 tab id，便于 set 后返回（闭包变量）
        const newTabId = uuid()
        set((state) => {
            const cur = state.sessions.get(sessionId) ?? DEFAULT_INSPECTOR_STATE
            const entry: InspectorTabEntry = {
                id: newTabId,
                mode: 'terminal',
                terminalId: uuid(),
                terminalSeq: cur.nextTerminalSeq,
            }
            const tabs = [...cur.tabs, entry]
            const next = new Map(state.sessions)
            next.set(sessionId, {
                ...cur,
                tabs,
                activeTabId: entry.id,
                nextTerminalSeq: cur.nextTerminalSeq + 1,
            })
            return { sessions: next }
        })
        return newTabId
    },

    renameTerminalTab: (sessionId, tabId, title) =>
        set((state) => {
            const cur = state.sessions.get(sessionId) ?? DEFAULT_INSPECTOR_STATE
            const idx = cur.tabs.findIndex((t) => t.id === tabId && t.mode === 'terminal')
            if (idx === -1) return state
            const trimmed = title.trim()
            const nextTitle = trimmed.length > 0 ? trimmed : undefined
            // 同值短路（避免高频双击重命名触发订阅组件无谓 re-render）
            if (cur.tabs[idx].title === nextTitle) return state
            const tabs = cur.tabs.slice()
            tabs[idx] = { ...tabs[idx], title: nextTitle }
            const next = new Map(state.sessions)
            next.set(sessionId, { ...cur, tabs })
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

    setTabViewState: (sessionId, tabId, patch) =>
        set((state) => {
            const cur = state.sessions.get(sessionId) ?? DEFAULT_INSPECTOR_STATE
            const idx = cur.tabs.findIndex((t) => t.id === tabId)
            if (idx === -1) return state
            const tab = cur.tabs[idx]
            const prev = tab.viewState ?? {}
            // 逐字段同值短路（避免高频写入触发订阅组件 re-render）
            const same = Object.keys(patch).every(
                (k) => (prev as Record<string, unknown>)[k] === (patch as Record<string, unknown>)[k],
            )
            if (same) return state
            const tabs = cur.tabs.slice()
            tabs[idx] = { ...tab, viewState: { ...prev, ...patch } }
            const next = new Map(state.sessions)
            next.set(sessionId, { ...cur, tabs })
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
