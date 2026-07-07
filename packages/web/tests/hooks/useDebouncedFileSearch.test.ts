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
import { renderHook, waitFor } from '@testing-library/react'
import { useDebouncedFileSearch } from '@/core/data/hooks/queries/useDebouncedFileSearch'

vi.mock('@/core/data/api/client', () => ({ useMobiApi: vi.fn() }))

import { useMobiApi } from '@/core/data/api/client'
const mockedUseMobiApi = vi.mocked(useMobiApi)

function mockApi(searchFiles: ReturnType<typeof vi.fn>) {
    mockedUseMobiApi.mockReturnValue({ sessions: { searchFiles } } as any)
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
})
