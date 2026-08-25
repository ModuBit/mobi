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

/**
 * 已丢弃消息的用户清除记录（per-session）。
 *
 * 丢弃分区是「终态可见性」的 **UI 态**，不是数据：cancelled/discarded 行在 DB 永存
 * （lifecycle 终态不可逆），若不可清除，长会话中每次 turn 死亡连坐 / /clear 丢弃都会
 * 永久累积删除线卡片，且 ComposerInfoPanel 的 hasContent 门禁被恒钉住、面板再也无法收起。
 * 清除只改展示（此 store，内存态不持久化——刷新后可见性恢复是可接受的 trade-off），
 * 不写 DB。记录粒度 = 消息 id：清除后**新到达**的丢弃消息（id 不在集合）仍会展示，
 * 不会因「全部清除」错过新的终态事件。
 */

/** 稳定空集引用：无记录会话的 select 返回值（避免每渲染新 Set 触发下游 memo 失效） */
const EMPTY_SET = new Set<string>()

interface DiscardedDismissState {
    dismissedBySession: Record<string, Set<string>>
    /** 记录一批消息为已清除（幂等：全在集合中时返回原 state 不触发订阅通知） */
    dismiss: (sessionId: string, messageIds: string[]) => void
    /** 清空会话记录（会话切换 / 组件卸载语义） */
    resetSession: (sessionId: string) => void
}

export const useDiscardedDismissStore = create<DiscardedDismissState>()((set) => ({
    dismissedBySession: {},
    dismiss: (sessionId, messageIds) => set((state) => {
        const prev = state.dismissedBySession[sessionId] ?? EMPTY_SET
        if (messageIds.length === 0 || messageIds.every(id => prev.has(id))) return state
        const next = new Set(prev)
        for (const id of messageIds) next.add(id)
        return { dismissedBySession: { ...state.dismissedBySession, [sessionId]: next } }
    }),
    resetSession: (sessionId) => set((state) => {
        if (!state.dismissedBySession[sessionId]) return state
        const next = { ...state.dismissedBySession }
        delete next[sessionId]
        return { dismissedBySession: next }
    }),
}))

/** 订阅式读取某会话的已清除 id 集合（引用稳定，可作 memo/selector 依赖） */
export function useDiscardedDismissed(sessionId: string): Set<string> {
    return useDiscardedDismissStore((s) => s.dismissedBySession[sessionId] ?? EMPTY_SET)
}

/** 测试隔离：重置全部记录 */
export function __resetDiscardedDismissStoreForTest(): void {
    useDiscardedDismissStore.setState({ dismissedBySession: {} })
}
