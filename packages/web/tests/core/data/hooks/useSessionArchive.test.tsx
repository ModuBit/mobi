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
 * 回归守卫：归档 / 取消归档 success 后本地缓存立即生效（session-retention 票 05）
 *
 * 归档：status=archived、置顶清空、active 置 false，从所有主列表分组移除；
 * 取消归档：回原归属分组（工作区 / 最近），status 回 dormant、archivedAt 清空。
 * API 在途期间缓存不动；失败不做任何本地改动。
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor, act } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'

const archiveMock = vi.hoisted(() => vi.fn())
const unarchiveMock = vi.hoisted(() => vi.fn())
vi.mock('@/core/data/api/client', () => ({
    useMobiApi: () => ({ sessions: { archive: archiveMock, unarchive: unarchiveMock } }),
}))

import { useSessionArchive } from '@/core/data/hooks/mutations/useSessionArchive'
import { queryKeys } from '@/core/lib/queryKeys'
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
    // 预置缓存：工作区 p1 内已置顶的在线会话 s1
    qc.setQueryData<Session[]>(queryKeys.sessions, [makeSession('s1', { workspaceId: 'p1', pinned: true, active: true })])
    qc.setQueryData(queryKeys.workspaceSessions('p1'), makePages([]))
    qc.setQueryData(queryKeys.recentSessions, makePages([]))
    qc.setQueryData(queryKeys.pinnedSessions, makePages(['s1']))
    qc.setQueryData(queryKeys.session('s1'), makeSession('s1', { workspaceId: 'p1', pinned: true, active: true }))

    const wrapper = ({ children }: { children: ReactNode }) => (
        <QueryClientProvider client={qc}>{children}</QueryClientProvider>
    )
    const hook = renderHook(() => useSessionArchive(), { wrapper })
    return { qc, ...hook }
}

describe('useSessionArchive', () => {
    beforeEach(() => {
        vi.clearAllMocks()
    })

    it('archive：success 后 status=archived、pinned/active 清空、移出置顶区', async () => {
        const { qc, result } = setup()

        archiveMock.mockResolvedValueOnce(undefined)
        await act(async () => {
            await result.current.archive.mutateAsync('s1')
        })

        expect(archiveMock).toHaveBeenCalledWith('s1')
        const listed = qc.getQueryData<Session[]>(queryKeys.sessions)![0]
        expect(listed.status).toBe('archived')
        expect(listed.archivedAt).toBeTruthy()
        expect(listed.pinned).toBe(false)
        expect(listed.active).toBe(false)
        expect(qc.getQueryData<Session>(queryKeys.session('s1'))!.status).toBe('archived')
        expect(qc.getQueryData<any>(queryKeys.pinnedSessions)!.pages[0].sessionIds).toEqual([])
    })

    it('unarchive：回原工作区组，status 回 dormant、archivedAt 清空、置顶不恢复', async () => {
        const { qc, result } = setup()
        // 预置归档态：不在任何主列表分组
        qc.setQueryData<Session[]>(queryKeys.sessions, [makeSession('s1', { workspaceId: 'p1', pinned: false, status: 'archived', archivedAt: 123 })])

        unarchiveMock.mockResolvedValueOnce(undefined)
        await act(async () => {
            await result.current.unarchive.mutateAsync('s1')
        })

        expect(unarchiveMock).toHaveBeenCalledWith('s1')
        const listed = qc.getQueryData<Session[]>(queryKeys.sessions)![0]
        expect(listed.status).toBe('dormant')
        expect(listed.archivedAt).toBeNull()
        expect(listed.pinned).toBe(false)
        expect(qc.getQueryData<any>(queryKeys.workspaceSessions('p1'))!.pages[0].sessionIds).toEqual(['s1'])
    })

    it('unarchive：游离会话回填「最近」', async () => {
        const { qc, result } = setup()
        qc.setQueryData<Session[]>(queryKeys.sessions, [makeSession('s1', { workspaceId: null, status: 'archived', archivedAt: 123 })])

        unarchiveMock.mockResolvedValueOnce(undefined)
        await act(async () => {
            await result.current.unarchive.mutateAsync('s1')
        })

        expect(qc.getQueryData<any>(queryKeys.recentSessions)!.pages[0].sessionIds).toEqual(['s1'])
    })

    it('archive 失败：不做任何本地改动', async () => {
        const { qc, result } = setup()

        archiveMock.mockRejectedValueOnce(new Error('network'))
        await act(async () => {
            await result.current.archive.mutateAsync('s1').catch(() => {})
        })

        const listed = qc.getQueryData<Session[]>(queryKeys.sessions)![0]
        expect(listed.status).toBeUndefined()
        expect(listed.pinned).toBe(true)
        expect(listed.active).toBe(true)
        expect(qc.getQueryData<any>(queryKeys.pinnedSessions)!.pages[0].sessionIds).toEqual(['s1'])
    })
})
