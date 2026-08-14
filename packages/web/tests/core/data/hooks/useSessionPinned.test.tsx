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
 * 回归守卫：置顶 API success 后本地缓存立即生效
 *
 * PATCH 成功瞬间分组成员 + pinned 标记当场翻转（不等 invalidate→refetch 的
 * 2-3s 收敛链路）；API 在途期间缓存不动（loading 由调用方展示）；失败不改缓存。
 * 用可控 deferred 模拟 API 时序：mutate 发出后、未 resolve 时断言缓存未动。
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor, act } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'

const setPinnedMock = vi.hoisted(() => vi.fn())
vi.mock('@/core/data/api/client', () => ({
    useMobiApi: () => ({ sessions: { setPinned: setPinnedMock } }),
}))

import { useSetSessionPinned } from '@/core/data/hooks/mutations/useSessionPinned'
import { queryKeys } from '@/core/lib/query-keys'
import type { Session } from '@/core/data/api/types'

function makeSession(id: string, overrides: Partial<Session> = {}): Session {
    return {
        id,
        namespace: 'ns',
        seq: 1,
        createdAt: 1,
        updatedAt: 1,
        active: false,
        activeAt: 1,
        metadata: { path: '/x', host: 'h', name: id },
        metadataVersion: 1,
        agentState: null,
        agentStateVersion: 1,
        running: false,
        runningAt: 1,
        ...overrides,
    } as Session
}

function makePages(ids: string[], total = ids.length) {
    return {
        pages: [{ sessionIds: ids, nextCursor: null, hasMore: false, total }],
        pageParams: [undefined],
    }
}

function setup() {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    // 预置缓存：项目 p1 内会话 s1（未置顶）
    qc.setQueryData<Session[]>(queryKeys.sessions, [makeSession('s1', { projectId: 'p1', pinned: false })])
    qc.setQueryData(queryKeys.projectSessions('p1'), makePages(['s1']))
    qc.setQueryData(queryKeys.recentSessions, makePages([]))
    qc.setQueryData(queryKeys.pinnedSessions, makePages([]))

    const wrapper = ({ children }: { children: ReactNode }) => (
        <QueryClientProvider client={qc}>{children}</QueryClientProvider>
    )
    const hook = renderHook(() => useSetSessionPinned(), { wrapper })
    return { qc, ...hook }
}

/** 可控 deferred：手动 resolve/reject 模拟 API 时序 */
function deferred() {
    let resolve!: (v: unknown) => void
    let reject!: (e: unknown) => void
    const promise = new Promise((res, rej) => { resolve = res; reject = rej })
    return { promise, resolve, reject }
}

describe('useSetSessionPinned success 后本地立即生效', () => {
    beforeEach(() => {
        vi.clearAllMocks()
    })

    it('pin：API 在途时缓存不动，success 瞬间翻转（进置顶区、离开项目组、pinned=true）', async () => {
        const { qc, result } = setup()
        const d = deferred()
        setPinnedMock.mockReturnValueOnce(d.promise)

        await act(async () => {
            void result.current.mutateAsync({ sessionId: 's1', pinned: true })
            // 让在途状态跑完微任务（API 仍挂起）
            await Promise.resolve()
        })

        // API 未返回：缓存保持原状（期间由调用方展示 loading）
        expect(qc.getQueryData<Session[]>(queryKeys.sessions)![0].pinned).toBe(false)
        expect(qc.getQueryData<any>(queryKeys.pinnedSessions)!.pages[0].sessionIds).toEqual([])

        d.resolve(undefined)
        await waitFor(() => expect(result.current.isSuccess).toBe(true))
        expect(setPinnedMock).toHaveBeenCalledWith('s1', true)

        // success 瞬间本地生效
        expect(qc.getQueryData<Session[]>(queryKeys.sessions)![0].pinned).toBe(true)
        expect(qc.getQueryData<any>(queryKeys.pinnedSessions)!.pages[0].sessionIds).toEqual(['s1'])
        expect(qc.getQueryData<any>(queryKeys.projectSessions('p1'))!.pages[0].sessionIds).toEqual([])
    })

    it('unpin：回填原项目组（projectId 有值）', async () => {
        // 预置 s1 已置顶、在置顶区
        const { qc, result } = setup()
        qc.setQueryData<Session[]>(queryKeys.sessions, [makeSession('s1', { projectId: 'p1', pinned: true })])
        qc.setQueryData(queryKeys.pinnedSessions, makePages(['s1']))
        qc.setQueryData(queryKeys.projectSessions('p1'), makePages([]))

        setPinnedMock.mockResolvedValueOnce(undefined)
        await act(async () => {
            await result.current.mutateAsync({ sessionId: 's1', pinned: false })
        })

        expect(qc.getQueryData<Session[]>(queryKeys.sessions)![0].pinned).toBe(false)
        expect(qc.getQueryData<any>(queryKeys.pinnedSessions)!.pages[0].sessionIds).toEqual([])
        expect(qc.getQueryData<any>(queryKeys.projectSessions('p1'))!.pages[0].sessionIds).toEqual(['s1'])
    })

    it('unpin：游离会话回填「最近」', async () => {
        const { qc, result } = setup()
        qc.setQueryData<Session[]>(queryKeys.sessions, [makeSession('s1', { projectId: null, pinned: true })])
        qc.setQueryData(queryKeys.pinnedSessions, makePages(['s1']))

        setPinnedMock.mockResolvedValueOnce(undefined)
        await act(async () => {
            await result.current.mutateAsync({ sessionId: 's1', pinned: false })
        })

        expect(qc.getQueryData<any>(queryKeys.recentSessions)!.pages[0].sessionIds).toEqual(['s1'])
    })

    it('API 失败：不做任何本地改动', async () => {
        const { qc, result } = setup()

        setPinnedMock.mockRejectedValueOnce(new Error('network'))
        await act(async () => {
            await result.current.mutateAsync({ sessionId: 's1', pinned: true }).catch(() => {})
        })

        // 缓存保持原状：pinned=false、仍在项目组、置顶区为空
        expect(qc.getQueryData<Session[]>(queryKeys.sessions)![0].pinned).toBe(false)
        expect(qc.getQueryData<any>(queryKeys.projectSessions('p1'))!.pages[0].sessionIds).toEqual(['s1'])
        expect(qc.getQueryData<any>(queryKeys.pinnedSessions)!.pages[0].sessionIds).toEqual([])
    })
})
