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
import { renderHook, act, waitFor, cleanup } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import type { MergeBackResult, WorktreeSummary } from '@mobi/shared'

// 稳定引用：useMobiApi 每次渲染返回同一对象（避免 effect 无限循环）
const api = vi.hoisted(() => ({
    worktrees: {
        list: vi.fn(),
        mergeBack: vi.fn(),
        discard: vi.fn()
    }
}))

vi.mock('@/core/data/api/client', () => ({
    useMobiApi: () => api
}))

import { useWorktrees } from '@/core/data/hooks/queries/useWorktrees'
import { useWorktreeActions } from '@/core/data/hooks/mutations/useWorktreeActions'
import { queryKeys } from '@/core/lib/queryKeys'

const SUMMARY: WorktreeSummary = {
    name: 'feat-a',
    branch: 'mobi/feat-a',
    worktreePath: '/repo-worktrees/feat-a',
    repoRoot: '/repo',
    state: 'dirty',
    dirtyFileCount: 1,
    sizeBytes: 10
}

function wrapperFor(qc: QueryClient) {
    return ({ children }: { children: ReactNode }) => (
        <QueryClientProvider client={qc}>{children}</QueryClientProvider>
    )
}

function newClient() {
    return new QueryClient({ defaultOptions: { queries: { retry: false } } })
}

describe('useWorktrees', () => {
    beforeEach(() => {
        api.worktrees.list.mockReset()
    })
    afterEach(() => cleanup())

    it('请求列表接口并返回 worktrees 数组', async () => {
        api.worktrees.list.mockResolvedValue({ data: { worktrees: [SUMMARY] } })
        const { result } = renderHook(() => useWorktrees(), { wrapper: wrapperFor(newClient()) })

        await waitFor(() => expect(result.current.isSuccess).toBe(true))
        expect(api.worktrees.list).toHaveBeenCalledTimes(1)
        expect(result.current.data).toEqual([SUMMARY])
    })

    it('enabled=false 时不发请求（会话无 worktree 元数据时省掉扫描）', async () => {
        const { result } = renderHook(() => useWorktrees({ enabled: false }), { wrapper: wrapperFor(newClient()) })
        expect(result.current.fetchStatus).toBe('idle')
        expect(api.worktrees.list).not.toHaveBeenCalled()
    })
})

describe('useWorktreeActions', () => {
    beforeEach(() => {
        api.worktrees.mergeBack.mockReset()
        api.worktrees.discard.mockReset()
    })
    afterEach(() => cleanup())

    it('mergeBack 透传入参并原样返回结果 union（拒绝不抛错）', async () => {
        const rejection: MergeBackResult = { ok: false, reason: 'main-dirty', files: ['a.ts'] }
        api.worktrees.mergeBack.mockResolvedValue({ data: rejection })
        const qc = newClient()
        const invalidateSpy = vi.spyOn(qc, 'invalidateQueries')
        const { result } = renderHook(() => useWorktreeActions(), { wrapper: wrapperFor(qc) })

        let outcome: MergeBackResult | undefined
        await act(async () => {
            outcome = await result.current.mergeBack({ worktreePath: SUMMARY.worktreePath, strategy: 'squash' })
        })

        expect(api.worktrees.mergeBack).toHaveBeenCalledWith({
            worktreePath: SUMMARY.worktreePath,
            strategy: 'squash'
        })
        expect(outcome).toEqual(rejection)
        // 动作后失效列表缓存（清理完成与否都会改变列表）
        expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: queryKeys.worktrees })
    })

    it('discard 按路径请求并失效列表缓存', async () => {
        api.worktrees.discard.mockResolvedValue({ data: { ok: true, worktreeRemoved: true, branchDeleted: true } })
        const qc = newClient()
        const invalidateSpy = vi.spyOn(qc, 'invalidateQueries')
        const { result } = renderHook(() => useWorktreeActions(), { wrapper: wrapperFor(qc) })

        await act(async () => {
            await result.current.discard(SUMMARY.worktreePath)
        })

        expect(api.worktrees.discard).toHaveBeenCalledWith(SUMMARY.worktreePath)
        expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: queryKeys.worktrees })
    })

    it('merging 在请求期间翻转，落定后回到 false', async () => {
        let release: (value: unknown) => void = () => {}
        api.worktrees.mergeBack.mockImplementation(() => new Promise((resolve) => { release = resolve }))
        const { result } = renderHook(() => useWorktreeActions(), { wrapper: wrapperFor(newClient()) })

        expect(result.current.merging).toBe(false)
        let pending: Promise<MergeBackResult> | undefined
        act(() => {
            pending = result.current.mergeBack({ worktreePath: SUMMARY.worktreePath })
        })
        await waitFor(() => expect(result.current.merging).toBe(true))

        await act(async () => {
            release({ data: { ok: true, strategy: 'no-ff', worktreeRemoved: true, branchDeleted: true } })
            await pending
        })
        await waitFor(() => expect(result.current.merging).toBe(false))
    })
})
