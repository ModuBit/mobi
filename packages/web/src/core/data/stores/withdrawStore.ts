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
 * 消息撤回请求 store（per-session keyed，SSEProvider 写入、ChatContainer 消费，spec §7.5）。
 *
 * 一次性信箱语义：SSE message-withdrawn 到达时落入 store，ChatContainer 消费即清除。
 * 对齐 rewindStore 的「SSE 层写、组件层读」外部 store 模式——不进 React state
 * （stale-state 纪律：可从 store 派生的对象不驻留组件状态），内存为覆盖制单值（D10 纪律）。
 */

/** 撤回回填请求：segments 结构化还原（失败为 null → 兜底 originalText 纯文本） */
export interface WithdrawRequest {
    localId: string
    segments: ComposerSegments | null
    originalText: string | null
    /** 单调递增，驱动 ChatContainer 的 nonce effect（并发旧请求被覆盖） */
    nonce: number
}

/** 模块级 nonce 计数器：进程内单调递增，保证后到请求可辨识 */
let withdrawNonceCounter = 0

/** 撤回请求 nonce：单调递增（每次调用 +1） */
export function nextWithdrawNonce(): number {
    return ++withdrawNonceCounter
}

interface WithdrawState {
    pendingBySession: Map<string, WithdrawRequest>
    /** SSE message-withdrawn → 落入请求（同会话旧请求被覆盖） */
    requestWithdraw: (sessionId: string, req: WithdrawRequest) => void
    /** 消费即清除（一次性信箱）；无请求返回 null */
    consumeWithdraw: (sessionId: string) => WithdrawRequest | null
    /** 清除滞留请求（会话视图挂载时丢弃打开前的陈旧请求 / 卸载清理） */
    clearSession: (sessionId: string) => void
}

export const useWithdrawStore = create<WithdrawState>((set) => ({
    pendingBySession: new Map(),

    requestWithdraw: (sessionId, req) =>
        set((state) => ({
            pendingBySession: new Map(state.pendingBySession).set(sessionId, req),
        })),

    consumeWithdraw: (sessionId) => {
        // holder 绕开 TS 对回调内赋值的控制流收窄（直接 return 捕获变量会被推断为 null）
        const consumed: { value: WithdrawRequest | null } = { value: null }
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

/** 指定会话的未消费撤回请求（无则 undefined——zustand Object.is 稳定） */
export function useWithdrawRequest(sessionId: string): WithdrawRequest | undefined {
    return useWithdrawStore((state) => state.pendingBySession.get(sessionId))
}

// 非组件侧（SSEProvider / 测试）使用的命令式入口：走 getState 转发 store action

/** 落入撤回请求（同会话旧请求被覆盖，nonce 由 nextWithdrawNonce 供给） */
export function requestWithdraw(sessionId: string, req: WithdrawRequest): void {
    useWithdrawStore.getState().requestWithdraw(sessionId, req)
}

/** 消费即清除（一次性信箱）；无请求返回 null */
export function consumeWithdraw(sessionId: string): WithdrawRequest | null {
    return useWithdrawStore.getState().consumeWithdraw(sessionId)
}

/** 清除滞留请求（会话视图挂载丢弃陈旧请求 / 卸载清理） */
export function clearSession(sessionId: string): void {
    useWithdrawStore.getState().clearSession(sessionId)
}

/** 测试用：清空所有状态（vitest 隔离） */
export function _resetForTest(): void {
    useWithdrawStore.setState({ pendingBySession: new Map() })
    withdrawNonceCounter = 0
}
