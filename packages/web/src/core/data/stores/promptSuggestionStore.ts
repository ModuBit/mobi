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
import { isObject } from '@mobi/shared'

interface PromptSuggestionState {
    /** sessionId → 最新建议文本(每轮一值, 新建议覆盖旧) */
    bySession: Map<string, string>
    /** SSEProvider 收到 prompt_suggestion 时写入 */
    setSuggestion: (sessionId: string, text: string) => void
    /** chip ✕ 关闭 / 采纳 / 用户发送消息时清空 */
    clearSession: (sessionId: string) => void
    /** 登出/换号时清空全部会话建议, 避免 SPA logout→login 残留上一用户状态 */
    clearAll: () => void
}

export const usePromptSuggestionStore = create<PromptSuggestionState>((set) => ({
    bySession: new Map(),

    setSuggestion: (sessionId, text) =>
        set((state) => {
            const next = new Map(state.bySession)
            next.set(sessionId, text)
            return { bySession: next }
        }),

    clearSession: (sessionId) =>
        set((state) => {
            if (!state.bySession.has(sessionId)) return state
            const next = new Map(state.bySession)
            next.delete(sessionId)
            return { bySession: next }
        }),

    clearAll: () =>
        set((state) => {
            if (state.bySession.size === 0) return state
            return { bySession: new Map() }
        }),
}))

/**
 * 读取指定 session 的当前建议文本。
 * Map.get 返回原始 string | undefined, zustand 用 Object.is 比较,
 * 缺失时返回稳定的 undefined, 不会触发多余重渲染。
 */
export function usePromptSuggestion(sessionId: string): string | undefined {
    return usePromptSuggestionStore((state) => state.bySession.get(sessionId))
}

/**
 * 从 DecryptedMessage.content 信封提取 prompt_suggestion 文本。
 * 结构: { role: 'agent', content: { type: 'output', data: { type: 'prompt_suggestion', suggestion } } }
 * 非 prompt_suggestion 消息返回 null(SSEProvider 据此决定走 store 还是正常 upsert)。
 */
export function extractPromptSuggestion(content: unknown): string | null {
    if (!isObject(content)) return null
    const inner = isObject(content.content) ? content.content : null
    if (!inner || inner.type !== 'output') return null
    const data = isObject(inner.data) ? inner.data : null
    if (!data || data.type !== 'prompt_suggestion') return null
    const suggestion = data.suggestion
    return typeof suggestion === 'string' && suggestion.length > 0 ? suggestion : null
}
