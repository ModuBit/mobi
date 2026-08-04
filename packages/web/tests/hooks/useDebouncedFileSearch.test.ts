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

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor, act } from '@testing-library/react'
import { useDebouncedFileSearch } from '@/core/data/hooks/queries/useDebouncedFileSearch'

vi.mock('@/core/data/api/client', () => ({ useMobiApi: vi.fn() }))

import { useMobiApi } from '@/core/data/api/client'
const mockedUseMobiApi = vi.mocked(useMobiApi)

function mockApi(searchFiles: ReturnType<typeof vi.fn>) {
    mockedUseMobiApi.mockReturnValue({ sessions: { searchFiles } } as any)
}

/** 可手动 resolve/reject 的 deferred，用于精细控制请求时序 */
function createDeferred<T = unknown>() {
    let resolve!: (v: T) => void
    let reject!: (e: unknown) => void
    const promise = new Promise<T>((res, rej) => {
        resolve = res
        reject = rej
    })
    return { promise, resolve, reject }
}

describe('useDebouncedFileSearch', () => {
    beforeEach(() => mockedUseMobiApi.mockReset())

    it('空 query → 不搜索，results 空', () => {
        const searchFiles = vi.fn()
        mockApi(searchFiles)

        const { result } = renderHook(() => useDebouncedFileSearch('s1', ''))

        expect(result.current.results).toEqual([])
        expect(result.current.isLoading).toBe(false)
        expect(searchFiles).not.toHaveBeenCalled()
    })

    it('query 非空 → 防抖后以 type="file" 调 searchFiles', async () => {
        const searchFiles = vi.fn(async () => ({
            data: { success: true, entries: [{ name: 'a.ts', type: 'file' as const, path: 'a.ts' }] },
        }))
        mockApi(searchFiles)

        const { result } = renderHook(() => useDebouncedFileSearch('s1', 'foo'))

        await waitFor(() => expect(result.current.results).toHaveLength(1))
        expect(searchFiles).toHaveBeenCalledWith('s1', 'foo', 'file', expect.any(Object))
        expect(result.current.results[0]).toMatchObject({ name: 'a.ts', path: 'a.ts', type: 'file' })
    })

    it('仅保留 file（即使后端混入 directory 也过滤）', async () => {
        const searchFiles = vi.fn(async () => ({
            data: {
                success: true,
                entries: [
                    { name: 'a.ts', type: 'file' as const, path: 'a.ts' },
                    { name: 'src', type: 'directory' as const, path: 'src' },
                ],
            },
        }))
        mockApi(searchFiles)

        const { result } = renderHook(() => useDebouncedFileSearch('s1', 'foo'))

        await waitFor(() => expect(result.current.results).toHaveLength(1))
        expect(result.current.results[0].type).toBe('file')
    })

    it('前端 cap 50（防御性，即便后端返回更多）', async () => {
        const entries = Array.from({ length: 60 }, (_, i) => ({
            name: `f${i}.ts`, type: 'file' as const, path: `f${i}.ts`,
        }))
        const searchFiles = vi.fn(async () => ({ data: { success: true, entries } }))
        mockApi(searchFiles)

        const { result } = renderHook(() => useDebouncedFileSearch('s1', 'foo'))

        await waitFor(() => expect(result.current.results).toHaveLength(50))
    })

    it('防抖：query 快速变化只搜最后一次', async () => {
        const searchFiles = vi.fn(async () => ({ data: { success: true, entries: [] } }))
        mockApi(searchFiles)

        const { rerender } = renderHook(({ q }) => useDebouncedFileSearch('s1', q), {
            initialProps: { q: 'a' },
        })
        rerender({ q: 'ab' })
        rerender({ q: 'abc' })

        await waitFor(() => expect(searchFiles).toHaveBeenCalled())
        expect(searchFiles).toHaveBeenCalledTimes(1)
        expect(searchFiles).toHaveBeenCalledWith('s1', 'abc', 'file', expect.any(Object))
    })

    it('success:false → results 空，不抛错', async () => {
        const searchFiles = vi.fn(async () => ({ data: { success: false, error: 'boom' } }))
        mockApi(searchFiles)

        const { result } = renderHook(() => useDebouncedFileSearch('s1', 'foo'))

        await waitFor(() => expect(result.current.results).toEqual([]))
        expect(result.current.isLoading).toBe(false)
    })

    it('refetch → 以同一 query 重新发起搜索', async () => {
        const searchFiles = vi.fn(async () => ({
            data: { success: true, entries: [{ name: 'a.ts', type: 'file' as const, path: 'a.ts' }] },
        }))
        mockApi(searchFiles)

        const { result } = renderHook(() => useDebouncedFileSearch('s1', 'foo'))
        await waitFor(() => expect(searchFiles).toHaveBeenCalledTimes(1))

        act(() => result.current.refetch())

        await waitFor(() => expect(searchFiles).toHaveBeenCalledTimes(2))
        expect(searchFiles).toHaveBeenLastCalledWith('s1', 'foo', 'file', expect.any(Object))
    })

    it('refetch 不等防抖（query 未变 → 立即发起）', async () => {
        vi.useFakeTimers()
        const searchFiles = vi.fn(async () => ({ data: { success: true, entries: [] } }))
        mockApi(searchFiles)

        const { result } = renderHook(() => useDebouncedFileSearch('s1', 'foo'))
        // 首次输入仍走 300ms 防抖
        await act(async () => { await vi.advanceTimersByTimeAsync(300) })
        expect(searchFiles).toHaveBeenCalledTimes(1)

        // refetch：query 未变，无需再等防抖，推进 0ms 即应发起
        act(() => result.current.refetch())
        await act(async () => { await vi.advanceTimersByTimeAsync(0) })
        expect(searchFiles).toHaveBeenCalledTimes(2)

        vi.useRealTimers()
    })

    it('空 query 时 refetch 不发请求', async () => {
        const searchFiles = vi.fn()
        mockApi(searchFiles)

        const { result } = renderHook(() => useDebouncedFileSearch('s1', ''))
        act(() => result.current.refetch())

        await waitFor(() => expect(result.current.results).toEqual([]))
        expect(searchFiles).not.toHaveBeenCalled()
    })

    it('旧请求 finally 不复位新请求的 loading（generation 守卫，防 spinner 误熄）', async () => {
        // fake timers 确定性控制防抖/loading 定时器，避免 real timer 下时序 flaky
        vi.useFakeTimers()
        const deferredA = createDeferred()
        const deferredB = createDeferred()
        let calls = 0
        const searchFiles = vi.fn(() => {
            calls++
            return calls === 1 ? deferredA.promise : deferredB.promise
        })
        mockApi(searchFiles)

        const { result, rerender } = renderHook(({ q }) => useDebouncedFileSearch('s1', q), {
            initialProps: { q: 'a' },
        })

        // 推进防抖 300ms → A 发起（generation=1）
        await act(async () => { await vi.advanceTimersByTimeAsync(300) })
        expect(searchFiles).toHaveBeenCalledTimes(1)

        // 切到 'ab'：B 接管，A 被 abort（generation=2）
        rerender({ q: 'ab' })
        await act(async () => { await vi.advanceTimersByTimeAsync(300) })
        expect(searchFiles).toHaveBeenCalledTimes(2)

        // 推进 B 的 loading 定时器（LOADING_DELAY=400ms）→ isLoading=true
        await act(async () => { await vi.advanceTimersByTimeAsync(400) })
        expect(result.current.isLoading).toBe(true)

        // A 被拒绝（模拟 abort reject）→ A 的 finally 因 generation 不匹配不应复位 loading
        await act(async () => {
            deferredA.reject(new Error('aborted'))
            await vi.advanceTimersByTimeAsync(0)
        })
        expect(result.current.isLoading).toBe(true)

        // B 成功 → B 的 finally（generation 匹配）复位 loading
        await act(async () => {
            deferredB.resolve({ data: { success: true, entries: [] } })
            await vi.advanceTimersByTimeAsync(0)
        })
        expect(result.current.isLoading).toBe(false)

        vi.useRealTimers()
    })
})
