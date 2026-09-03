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
import type { ComposerSegments } from '@/domain/chat/composerSegments'

/**
 * Composer 回填请求 store（per-session keyed，多生产方、ChatContainer 单消费方）。
 *
 * 一次性信箱语义：请求方落入 store，ChatContainer 消费即清除。
 * 对齐 rewindStore 的「请求层写、组件层读」外部 store 模式——不进 React state
 * （stale-state 纪律：可从 store 派生的对象不驻留组件状态），内存为覆盖制单值（D10 纪律）。
 *
 * 为什么信箱承载回填：请求方（SSE 层 / QueuedMessagesBar）可能先于回填发生卸载——
 * 排队消息编辑经 mutate 的 per-call 回调回填时，onMutate 乐观移除会让悬浮条在
 * mutation settle 前卸载，回调被 react-query 静默丢弃（MutationObserver#notify 的
 * hasListeners 守卫）→ 取消成功但 composer 永不回填。写 store + 长命组件消费
 * 切断对请求方生命周期的依赖。
 *
 * 生产方：
 * - SSE message-withdrawn（撤回 #53 / spec §7.5）：SSEProvider 写入，segments 为
 *   结构化还原（失败为 null → 兜底 originalText 纯文本）
 * - 排队消息编辑取消成功（useCancelQueuedMessage）：cancelled → 回填分段；
 *   submitted → notice 提示（消息已被 agent 处理，不可编辑）
 */

/** Composer 回填请求：segments 结构化还原（null → 兜底 originalText 纯文本） */
export interface ComposerBackfillRequest {
    localId: string
    segments: ComposerSegments | null
    originalText: string | null
    /** 请求落 store 时刻（store 盖章）：会话视图以挂载时刻为基线甄别陈旧请求，
     *  早于基线的丢弃、晚于基线（含 render→effect 窗口新到的）照常回填 */
    createdAt: number
    /** 回填之外的一次性用户反馈（消费方渲染 toast）：alreadySubmitted = 消息已被
     *  agent 处理、取消被拒（编辑语义下不回填，仅提示） */
    notice?: 'alreadySubmitted'
}

type ComposerBackfillInput = Omit<ComposerBackfillRequest, 'createdAt'>

interface ComposerBackfillState {
    pendingBySession: Map<string, ComposerBackfillRequest>
    /** 请求落入信箱（同会话旧请求被覆盖；createdAt 由 store 盖章） */
    requestComposerBackfill: (sessionId: string, req: ComposerBackfillInput) => void
    /** 消费即清除（一次性信箱）；无请求返回 null */
    consumeComposerBackfill: (sessionId: string) => ComposerBackfillRequest | null
    /** 清除滞留请求（会话视图挂载时丢弃打开前的陈旧请求 / 卸载清理） */
    clearSession: (sessionId: string) => void
}

export const useComposerBackfillStore = create<ComposerBackfillState>((set) => ({
    pendingBySession: new Map(),

    requestComposerBackfill: (sessionId, req) =>
        set((state) => ({
            pendingBySession: new Map(state.pendingBySession).set(sessionId, { ...req, createdAt: Date.now() }),
        })),

    consumeComposerBackfill: (sessionId) => {
        // holder 绕开 TS 对回调内赋值的控制流收窄（直接 return 捕获变量会被推断为 null）
        const consumed: { value: ComposerBackfillRequest | null } = { value: null }
        set((state) => {
            const req = state.pendingBySession.get(sessionId) ?? null
            if (!req) return state
            consumed.value = req
            const next = new Map(state.pendingBySession)
            next.delete(sessionId)
            return { pendingBySession: next }
        })
        return consumed.value
    },

    clearSession: (sessionId) =>
        set((state) => {
            if (!state.pendingBySession.has(sessionId)) return state
            const next = new Map(state.pendingBySession)
            next.delete(sessionId)
            return { pendingBySession: next }
        }),
}))

/** 指定会话的未消费回填请求（无则 undefined——zustand Object.is 稳定） */
export function useComposerBackfillRequest(sessionId: string): ComposerBackfillRequest | undefined {
    return useComposerBackfillStore((state) => state.pendingBySession.get(sessionId))
}

// 非组件侧（SSEProvider / mutation hook / 测试）使用的命令式入口：走 getState 转发 store action

/** 落入回填请求（同会话旧请求被覆盖，createdAt 由 store 盖章） */
export function requestComposerBackfill(sessionId: string, req: ComposerBackfillInput): void {
    useComposerBackfillStore.getState().requestComposerBackfill(sessionId, req)
}

/** 消费即清除（一次性信箱）；无请求返回 null */
export function consumeComposerBackfill(sessionId: string): ComposerBackfillRequest | null {
    return useComposerBackfillStore.getState().consumeComposerBackfill(sessionId)
}

/** 清除滞留请求（会话视图挂载丢弃陈旧请求 / 卸载清理） */
export function clearSession(sessionId: string): void {
    useComposerBackfillStore.getState().clearSession(sessionId)
}

/** 测试用：清空所有状态（vitest 隔离） */
export function _resetForTest(): void {
    useComposerBackfillStore.setState({ pendingBySession: new Map() })
}
