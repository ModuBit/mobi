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
 * 回归守卫：membership 变更**不在本端**失效任何缓存。
 *
 * daemon 对置顶/归属变更广播 `affects: 'membership'`，SSE 侧据此失效工作区视图；
 * 本端同一变更再失效一遍就会把全部工作区分组重拉两次（2026-10-28 实测一次操作
 * 19 个请求）。工作区实体 CRUD 只重拉工作区列表这一个小键，仍保留本地失效。
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'

const assignMock = vi.hoisted(() => vi.fn())
const removeMock = vi.hoisted(() => vi.fn())
const createMock = vi.hoisted(() => vi.fn())

vi.mock('@/core/data/api/client', () => ({
    useMobiApi: () => ({
        workspaces: {
            assignSession: assignMock,
            remove: removeMock,
            create: createMock,
        },
    }),
}))

import {
    useAssignSessionWorkspace,
    useCreateWorkspace,
    useDeleteWorkspace,
} from '@/core/data/hooks/mutations/useWorkspaceMutations'

function setup<T>(useHook: () => T) {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const invalidateSpy = vi.spyOn(qc, 'invalidateQueries')
    const wrapper = ({ children }: { children: ReactNode }) => (
        <QueryClientProvider client={qc}>{children}</QueryClientProvider>
    )
    return { qc, invalidateSpy, hook: renderHook(useHook, { wrapper }) }
}

describe('workspace mutations 的本地失效范围', () => {
    beforeEach(() => {
        vi.clearAllMocks()
    })

    it('assign（归入/移出工作区）success 后不失效任何查询——membership 由 SSE 收敛', async () => {
        assignMock.mockResolvedValueOnce(undefined)
        const { invalidateSpy, hook } = setup(() => useAssignSessionWorkspace())

        await hook.result.current.mutateAsync({ sessionId: 's1', workspaceId: 'p1' })
        await waitFor(() => expect(hook.result.current.isSuccess).toBe(true))

        expect(assignMock).toHaveBeenCalledWith('s1', 'p1')
        expect(invalidateSpy).not.toHaveBeenCalled()
    })

    it('delete workspace success 后不失效任何查询——workspace-removed + membership 由 SSE 收敛', async () => {
        removeMock.mockResolvedValueOnce(undefined)
        const { invalidateSpy, hook } = setup(() => useDeleteWorkspace())

        await hook.result.current.mutateAsync('p1')
        await waitFor(() => expect(hook.result.current.isSuccess).toBe(true))

        expect(invalidateSpy).not.toHaveBeenCalled()
    })

    it('create workspace success 后只失效工作区列表（建完立刻可见）', async () => {
        createMock.mockResolvedValueOnce({ data: { workspace: { id: 'p9' } } })
        const { invalidateSpy, hook } = setup(() => useCreateWorkspace())

        await hook.result.current.mutateAsync({ name: 'w', folders: [] })
        await waitFor(() => expect(hook.result.current.isSuccess).toBe(true))

        expect(invalidateSpy).toHaveBeenCalledTimes(1)
        expect(invalidateSpy.mock.calls[0][0]).toEqual({ queryKey: ['workspaces'] })
    })
})
