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

/**
 * 会话离场清理编排（架构审查候选 A）：单 id / 批量 id 的收口顺序、瞬态清理全集、
 * 列表维度失效（详情键只 remove 不 invalidate）。
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

const removeQueries = vi.fn()
const invalidateQueries = vi.fn().mockResolvedValue(undefined)
const invalidateWorkspaceViews = vi.fn().mockResolvedValue(undefined)
const clearMessageWindow = vi.fn()
const clearSessionResources = vi.fn()
const clearAttentionState = vi.fn()
const clearPromptSuggestion = vi.fn()

vi.mock('@tanstack/react-query', () => ({}))
vi.doMock('@/core/lib/invalidateViews', () => ({ invalidateWorkspaceViews }))
vi.doMock('@/core/data/stores/messageWindowStore', () => ({ clearMessageWindow }))
vi.doMock('@/core/lib/sessionResources', () => ({ clearSessionResources }))
vi.doMock('@/core/notifications/attentionFeedback', () => ({ clearAttentionState }))
vi.doMock('@/core/data/stores/promptSuggestionStore', () => ({
    usePromptSuggestionStore: { getState: () => ({ clearSession: clearPromptSuggestion }) },
}))
vi.doMock('@/core/lib/queryKeys', () => ({
    queryKeys: { session: (id: string) => ['session', id], sessions: ['sessions'] },
}))

const { evictSession } = await import('@/core/lib/sessionEviction')

function makeClient() {
    return { removeQueries, invalidateQueries } as unknown as import('@tanstack/react-query').QueryClient
}

describe('evictSession', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        invalidateQueries.mockResolvedValue(undefined)
        invalidateWorkspaceViews.mockResolvedValue(undefined)
    })

    it('单 id：详情移除 → 瞬态清理全集（窗口/资源/关注态/建议）→ 列表维度失效收尾', async () => {
        const order: string[] = []
        removeQueries.mockImplementation(() => { order.push('remove') })
        clearMessageWindow.mockImplementation(() => { order.push('window') })
        clearSessionResources.mockImplementation(() => { order.push('resources') })
        clearAttentionState.mockImplementation(() => { order.push('attention') })
        clearPromptSuggestion.mockImplementation(() => { order.push('suggestions') })
        invalidateQueries.mockImplementation(async () => { order.push('invalidate-list') })
        invalidateWorkspaceViews.mockImplementation(async () => { order.push('invalidate-views') })

        await evictSession(makeClient(), 'a')

        // 顺序约定：瞬态清理（含依赖 terminalId 的资源清理）必须在失效收尾前完成
        expect(order).toEqual(['remove', 'window', 'resources', 'attention', 'suggestions', 'invalidate-list', 'invalidate-views'])
        expect(removeQueries).toHaveBeenCalledWith({ queryKey: ['session', 'a'] })
        // 失效只走列表维度：['sessions'] + 工作区视图；详情键已 remove，不再 invalidate
        expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['sessions'] })
    })

    it('批量：逐条瞬态清理（去重），列表失效一次收口', async () => {
        await evictSession(makeClient(), ['a', 'b', 'a'])

        expect(removeQueries).toHaveBeenCalledTimes(2)
        expect(clearMessageWindow).toHaveBeenCalledTimes(2)
        expect(clearSessionResources).toHaveBeenCalledTimes(2)
        expect(clearAttentionState).toHaveBeenCalledTimes(2)
        expect(clearPromptSuggestion).toHaveBeenCalledTimes(2)
        expect(invalidateQueries).toHaveBeenCalledTimes(1)
        expect(invalidateWorkspaceViews).toHaveBeenCalledTimes(1)
    })

    it('await 语义：等列表失效完成后才 resolve（调用方可依赖离场完成时点）', async () => {
        let resolved = false
        invalidateWorkspaceViews.mockImplementation(() => new Promise(r => setTimeout(r, 10)))
        await evictSession(makeClient(), 'a').then(() => { resolved = true })
        expect(resolved).toBe(true)
    })
})
