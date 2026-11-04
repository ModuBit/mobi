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
 * 会话离场清理编排（架构审查候选 A）：单 id / 批量 id 的四步收口与顺序。
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

const removeQueries = vi.fn()
const invalidateSessionViews = vi.fn().mockResolvedValue(undefined)
const clearMessageWindow = vi.fn()
const clearSessionResources = vi.fn()

vi.mock('@tanstack/react-query', () => ({}))
vi.doMock('@/core/lib/invalidateViews', () => ({ invalidateSessionViews }))
vi.doMock('@/core/data/stores/messageWindowStore', () => ({ clearMessageWindow }))
vi.doMock('@/core/lib/sessionResources', () => ({ clearSessionResources }))
vi.doMock('@/core/lib/queryKeys', () => ({
    queryKeys: { session: (id: string) => ['session', id] },
}))

const { evictSession } = await import('@/core/lib/sessionEviction')

function makeClient() {
    return { removeQueries } as unknown as import('@tanstack/react-query').QueryClient
}

describe('evictSession', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        invalidateSessionViews.mockResolvedValue(undefined)
    })

    it('单 id：四步按序执行（详情移除 → 消息窗口 → 会话资源 → 视图失效收尾）', async () => {
        const order: string[] = []
        removeQueries.mockImplementation(() => { order.push('remove') })
        clearMessageWindow.mockImplementation(() => { order.push('window') })
        clearSessionResources.mockImplementation(() => { order.push('resources') })
        invalidateSessionViews.mockImplementation(async () => { order.push('invalidate') })

        await evictSession(makeClient(), 'a')

        expect(order).toEqual(['remove', 'window', 'resources', 'invalidate'])
        expect(removeQueries).toHaveBeenCalledWith({ queryKey: ['session', 'a'] })
        expect(invalidateSessionViews).toHaveBeenCalledWith(expect.anything(), ['a'])
    })

    it('批量：逐条清理各 store，视图失效一次收口且去重', async () => {
        await evictSession(makeClient(), ['a', 'b', 'a'])

        expect(removeQueries).toHaveBeenCalledTimes(2)
        expect(clearMessageWindow).toHaveBeenCalledTimes(2)
        expect(clearSessionResources).toHaveBeenCalledTimes(2)
        expect(invalidateSessionViews).toHaveBeenCalledTimes(1)
        expect(invalidateSessionViews).toHaveBeenCalledWith(expect.anything(), ['a', 'b'])
    })

    it('await 语义：等视图失效完成后才 resolve（调用方可依赖离场完成时点）', async () => {
        let resolved = false
        invalidateSessionViews.mockImplementation(() => new Promise(r => setTimeout(r, 10)))
        await evictSession(makeClient(), 'a').then(() => { resolved = true })
        expect(resolved).toBe(true)
    })
})
