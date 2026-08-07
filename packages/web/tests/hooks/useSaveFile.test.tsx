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
import '@testing-library/jest-dom/vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import React from 'react'

// mock useMobiApi：files.save 返回可控 axios-like 响应
const saveMock = vi.fn()
vi.mock('@/core/data/api/client', () => ({
    useMobiApi: () => ({ files: { save: saveMock } }),
}))

import { useSaveFile } from '@/core/data/hooks/mutations/useSaveFile'

function Wrapper({ children }: { children: React.ReactNode }) {
    return (
        <QueryClientProvider client={new QueryClient({ defaultOptions: { mutations: { retry: false } } })}>
            {children}
        </QueryClientProvider>
    )
}

describe('useSaveFile', () => {
    beforeEach(() => { saveMock.mockReset() })

    it('成功（200）→ { etag, conflict:false }', async () => {
        saveMock.mockResolvedValueOnce({ status: 200, data: { success: true, etag: 'new-etag' } })
        const { result } = renderHook(() => useSaveFile('s1'), { wrapper: Wrapper })
        await act(async () => {
            const r = await result.current.mutateAsync({ path: 'a.md', content: new TextEncoder().encode('x'), baseEtag: 'old' })
            expect(r).toEqual({ etag: 'new-etag', conflict: false })
        })
    })

    it('冲突（409）→ { conflict:true, currentEtag }，不抛错', async () => {
        saveMock.mockResolvedValueOnce({ status: 409, data: { success: false, conflict: true, currentEtag: 'cur' } })
        const { result } = renderHook(() => useSaveFile('s1'), { wrapper: Wrapper })
        await act(async () => {
            const r = await result.current.mutateAsync({ path: 'a.md', content: new TextEncoder().encode('x'), baseEtag: 'old' })
            expect(r).toEqual({ conflict: true, currentEtag: 'cur' })
        })
    })

    it('其他失败 → { conflict:false, error }', async () => {
        saveMock.mockResolvedValueOnce({ status: 200, data: { success: false, error: 'boom' } })
        const { result } = renderHook(() => useSaveFile('s1'), { wrapper: Wrapper })
        await act(async () => {
            const r = await result.current.mutateAsync({ path: 'a.md', content: new TextEncoder().encode('x'), baseEtag: 'old' })
            expect(r).toEqual({ conflict: false, error: 'boom' })
        })
    })

    it('force=true → 传空 baseEtag（跳过 OCC）', async () => {
        saveMock.mockResolvedValueOnce({ status: 200, data: { success: true, etag: 'e2' } })
        const { result } = renderHook(() => useSaveFile('s1'), { wrapper: Wrapper })
        await act(async () => {
            await result.current.mutateAsync({ path: 'a.md', content: new TextEncoder().encode('x'), baseEtag: 'old', force: true })
        })
        await waitFor(() => {
            // 第 4 参 baseEtag 应为空字符串
            expect(saveMock.mock.calls[0][3]).toBe('')
        })
    })
})
