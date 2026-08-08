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
import '@testing-library/jest-dom/vitest'
import { renderHook, act } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { App as AntdApp } from 'antd'
import React from 'react'

// mock useSaveFile：mutateAsync 可控
const mutateAsync = vi.fn()
vi.mock('@/core/data/hooks/mutations/useSaveFile', () => ({
    useSaveFile: () => ({ mutateAsync }),
}))

import { useFileEditor } from '@/components/files/useFileEditor'
import { AUTOSAVE_DEBOUNCE_MS } from '@/core/config/editConfig'

function Wrapper({ children }: { children: React.ReactNode }) {
    return (
        <QueryClientProvider client={new QueryClient({ defaultOptions: { mutations: { retry: false } } })}>
            <AntdApp>{children}</AntdApp>
        </QueryClientProvider>
    )
}

function renderEditor(initial = { text: 'old', etag: 'e0' }) {
    return renderHook(() => useFileEditor('s', 'a.md', initial), { wrapper: Wrapper })
}

describe('useFileEditor', () => {
    beforeEach(() => {
        vi.useFakeTimers()
        mutateAsync.mockReset()
    })
    afterEach(() => { vi.useRealTimers() })

    it('初始：draft=baseText，dirty=false', () => {
        mutateAsync.mockResolvedValue({ etag: 'e1', conflict: false })
        const { result } = renderEditor()
        expect(result.current.draft).toBe('old')
        expect(result.current.dirty).toBe(false)
    })

    it('update → dirty=true，draft 更新', () => {
        mutateAsync.mockResolvedValue({ etag: 'e1', conflict: false })
        const { result } = renderEditor()
        act(() => result.current.update('new'))
        expect(result.current.draft).toBe('new')
        expect(result.current.dirty).toBe(true)
    })

    it('update 后 debounce 到期 → 触发保存（path/baseEtag/content 正确）', async () => {
        mutateAsync.mockResolvedValue({ etag: 'e1', conflict: false })
        const { result } = renderEditor()
        await act(async () => {
            result.current.update('edited')
            await vi.advanceTimersByTimeAsync(AUTOSAVE_DEBOUNCE_MS)
        })
        expect(mutateAsync).toHaveBeenCalledTimes(1)
        const call = mutateAsync.mock.calls[0][0]
        expect(call.path).toBe('a.md')
        expect(call.baseEtag).toBe('e0')
        expect(call.force).toBe(false)
        expect(Array.from(call.content as Uint8Array)).toEqual(Array.from(new TextEncoder().encode('edited')))
    })

    it('保存成功 → dirty 归 false，draft 回到新 baseText', async () => {
        mutateAsync.mockResolvedValue({ etag: 'e1', conflict: false })
        const { result } = renderEditor()
        await act(async () => {
            result.current.update('edited')
            await vi.advanceTimersByTimeAsync(AUTOSAVE_DEBOUNCE_MS)
        })
        expect(result.current.dirty).toBe(false)
        expect(result.current.draft).toBe('edited')
    })

    it('saveNow → 立即保存（不等 debounce）', async () => {
        mutateAsync.mockResolvedValue({ etag: 'e1', conflict: false })
        const { result } = renderEditor()
        act(() => result.current.update('edited'))
        await act(async () => {
            const r = await result.current.saveNow()
            expect(r.ok).toBe(true)
        })
        expect(mutateAsync).toHaveBeenCalledTimes(1)
    })

    it('冲突 → conflict 态 + ok:false', async () => {
        mutateAsync.mockResolvedValue({ conflict: true, currentEtag: 'cur-etag' })
        const { result } = renderEditor()
        act(() => result.current.update('edited'))
        await act(async () => {
            const r = await result.current.saveNow()
            expect(r.ok).toBe(false)
        })
        expect(result.current.conflict).toEqual({ currentEtag: 'cur-etag' })
    })

    it('业务错误（error，非 conflict）→ ok:false + dirty 保持，可重试', async () => {
        mutateAsync.mockResolvedValue({ conflict: false, error: 'boom' })
        const { result } = renderEditor()
        act(() => result.current.update('edited'))
        await act(async () => {
            const r = await result.current.saveNow()
            expect(r.ok).toBe(false)
        })
        // 失败不推进 baseText、不清 draft → dirty 保持，用户可重试或手动处理
        expect(result.current.dirty).toBe(true)
        expect(result.current.conflict).toBeNull()
    })

    it('forceOverwrite → mutateAsync force:true', async () => {
        mutateAsync.mockResolvedValue({ etag: 'e1', conflict: false })
        const { result } = renderEditor()
        act(() => result.current.update('edited'))
        await act(async () => { await result.current.forceOverwrite() })
        expect(mutateAsync.mock.calls[0][0].force).toBe(true)
    })

    it('reload → 丢弃 draft，dirty=false', () => {
        mutateAsync.mockResolvedValue({ etag: 'e1', conflict: false })
        const { result } = renderEditor()
        act(() => result.current.update('edited'))
        expect(result.current.dirty).toBe(true)
        act(() => result.current.reload())
        expect(result.current.draft).toBe('old')
        expect(result.current.dirty).toBe(false)
    })
})
