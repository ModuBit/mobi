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

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act, cleanup } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'

// abort 的 api 与「窗口 store」动作均为观测点：onMutate 乐观移除 / onSettled refetch
const abortSpy = vi.hoisted(() => vi.fn().mockResolvedValue(undefined))
const fetchLatestSpy = vi.hoisted(() => vi.fn())
const removeQueuedSpy = vi.hoisted(() => vi.fn())
const setEffortSpy = vi.hoisted(() => vi.fn().mockResolvedValue(undefined))
const renameSpy = vi.hoisted(() => vi.fn().mockResolvedValue(undefined))

vi.mock('@/core/data/api/client', () => ({
    useMobiApi: () => ({
        sessions: {
            abort: abortSpy,
            setEffort: setEffortSpy,
            rename: renameSpy,
        },
    }),
}))
vi.mock('@/core/data/stores/messageWindowStore', () => ({
    fetchLatestMessages: fetchLatestSpy,
    removeQueuedMessages: removeQueuedSpy,
    clearMessageWindow: vi.fn(),
}))
vi.mock('@/core/lib/sessionResources', () => ({
    clearSessionResources: vi.fn(),
}))
vi.mock('@tanstack/react-router', () => ({
    useNavigate: () => vi.fn(),
    useLocation: () => ({ pathname: '/' }),
}))

import { useSessionActions } from '@/core/data/hooks/mutations/useSessionActions'

function renderActions() {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const wrapper = ({ children }: { children: ReactNode }) => (
        <QueryClientProvider client={qc}>{children}</QueryClientProvider>
    )
    return { ...renderHook(() => useSessionActions('s1'), { wrapper }), qc }
}

describe('useSessionActions abortSession —— onSettled refetch 仅清队列档触发', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        abortSpy.mockResolvedValue(undefined)
    })
    afterEach(() => cleanup())

    it('点按路径（无入参，默认 turn）→ 不发 refetch（普通停止由 SSE 增量到位）', async () => {
        const { result } = renderActions()
        await act(async () => { await result.current.abortSession() })
        expect(abortSpy).toHaveBeenCalledWith('s1', undefined)
        expect(fetchLatestSpy).not.toHaveBeenCalled()
    })

    it("stopKind='turn' → 不发 refetch", async () => {
        const { result } = renderActions()
        await act(async () => { await result.current.abortSession('turn') })
        expect(fetchLatestSpy).not.toHaveBeenCalled()
    })

    it("清队列档 'turn-queue' → onMutate 乐观移除 + onSettled refetch 对账", async () => {
        const { result } = renderActions()
        await act(async () => { await result.current.abortSession('turn-queue') })
        expect(removeQueuedSpy).toHaveBeenCalledWith('s1')
        expect(fetchLatestSpy).toHaveBeenCalledTimes(1)
    })

    it("含后台任务档 'turn-queue-tasks' → 同样 refetch", async () => {
        const { result } = renderActions()
        await act(async () => { await result.current.abortSession('turn-queue-tasks') })
        expect(fetchLatestSpy).toHaveBeenCalledTimes(1)
    })
})

describe('useSessionActions 配置切换 —— 失效范围', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        setEffortSpy.mockResolvedValue(undefined)
        renameSpy.mockResolvedValue(undefined)
    })
    afterEach(() => cleanup())

    const invalidatedKeys = (spy: { mock: { calls: unknown[][] } }) =>
        spy.mock.calls.map(call => JSON.stringify((call[0] as { queryKey?: unknown })?.queryKey))

    it('setEffort 只失效会话详情，不重拉全量会话列表', async () => {
        // ['sessions'] 返回本 namespace 全部会话（无 limit），配置切换不改成员与排序，
        // 列表条目由 SSE patchSessionCache 就地更新——重拉纯属浪费
        const { result, qc } = renderActions()
        const invalidate = vi.spyOn(qc, 'invalidateQueries')

        await act(async () => { await result.current.setEffort('high') })

        const keys = invalidatedKeys(invalidate)
        expect(keys).toContain(JSON.stringify(['session', 's1']))
        expect(keys).not.toContain(JSON.stringify(['sessions']))
    })

    it('rename 仍失效会话列表（名称是列表可见字段）', async () => {
        const { result, qc } = renderActions()
        const invalidate = vi.spyOn(qc, 'invalidateQueries')

        await act(async () => { await result.current.renameSession('新名字') })

        const keys = invalidatedKeys(invalidate)
        expect(keys).toContain(JSON.stringify(['session', 's1']))
        expect(keys).toContain(JSON.stringify(['sessions']))
    })
})
