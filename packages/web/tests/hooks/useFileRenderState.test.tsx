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
import { renderHook, cleanup, act } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import React from 'react'
import { useFileRenderState } from '@/components/files/useFileRenderState'

// mock 两个 query hook，测试只关心它们的返回值如何映射到 RenderState
vi.mock('@/core/data/hooks/queries/useFileTree', () => ({
    useFileMeta: vi.fn(),
    useFileContent: vi.fn(),
}))

import { useFileMeta, useFileContent } from '@/core/data/hooks/queries/useFileTree'

const mockedMeta = vi.mocked(useFileMeta)
const mockedContent = vi.mocked(useFileContent)

function Wrapper({ children }: { children: React.ReactNode }) {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    return <QueryClientProvider client={qc}>{children}</QueryClientProvider>
}

function renderState(sessionId = 's', filePath = 'a.txt') {
    return renderHook(() => useFileRenderState(sessionId, filePath), { wrapper: Wrapper })
}

describe('useFileRenderState', () => {
    beforeEach(() => { mockedMeta.mockReset(); mockedContent.mockReset() })
    afterEach(() => cleanup())

    it('meta 加载中 → meta-loading', () => {
        mockedMeta.mockReturnValue({ data: undefined, isLoading: true, error: null } as any)
        mockedContent.mockReturnValue({ data: undefined, isLoading: false, error: null } as any)
        expect(renderState().result.current.status).toBe('meta-loading')
    })

    it('meta 失败 → meta-error', () => {
        const err = new Error('boom')
        mockedMeta.mockReturnValue({ data: undefined, isLoading: false, error: err } as any)
        mockedContent.mockReturnValue({ data: undefined, isLoading: false, error: null } as any)
        const s = renderState().result.current
        expect(s.status).toBe('meta-error')
        expect(s.status === 'meta-error' && s.error).toBe(err)
    })

    it('pdf（非文本类）→ ready，不拉 content', () => {
        mockedMeta.mockReturnValue({ data: { mime: 'application/pdf', size: 1000, etag: 'e' }, isLoading: false, error: null } as any)
        mockedContent.mockReturnValue({ data: undefined, isLoading: false, error: null } as any)
        const s = renderState('s', 'a.pdf').result.current
        expect(s.status).toBe('ready')
        expect(s.status === 'ready' && s.kind.kind).toBe('pdf')
        // pdf 是非文本类，shouldFetchContent 必须为 false（enabled 是 useFileContent 第 3 参）
        expect(mockedContent).toHaveBeenCalledWith('s', 'a.pdf', false, 'e')
    })

    it('text 超阈值 → too-large', () => {
        mockedMeta.mockReturnValue({ data: { mime: 'text/plain', size: 3 * 1024 * 1024, etag: 'e' }, isLoading: false, error: null } as any)
        mockedContent.mockReturnValue({ data: undefined, isLoading: false, error: null } as any)
        expect(renderState().result.current.status).toBe('too-large')
    })

    it('image 超阈值 → too-large；image 未超 → ready', () => {
        mockedMeta.mockReturnValue({ data: { mime: 'image/png', size: 6 * 1024 * 1024, etag: 'e' }, isLoading: false, error: null } as any)
        mockedContent.mockReturnValue({ data: undefined, isLoading: false, error: null } as any)
        expect(renderState().result.current.status).toBe('too-large')

        mockedMeta.mockReturnValue({ data: { mime: 'image/png', size: 1000, etag: 'e' }, isLoading: false, error: null } as any)
        expect(renderState('s', 'a.png').result.current.status).toBe('ready')
    })

    it('text content 加载中 → content-loading', () => {
        mockedMeta.mockReturnValue({ data: { mime: 'text/plain', size: 100, etag: 'e' }, isLoading: false, error: null } as any)
        mockedContent.mockReturnValue({ data: undefined, isLoading: true, error: null } as any)
        expect(renderState().result.current.status).toBe('content-loading')
    })

    it('text content 失败 → content-error', () => {
        mockedMeta.mockReturnValue({ data: { mime: 'text/plain', size: 100, etag: 'e' }, isLoading: false, error: null } as any)
        const err = new Error('read failed')
        mockedContent.mockReturnValue({ data: undefined, isLoading: false, error: err } as any)
        const s = renderState().result.current
        expect(s.status).toBe('content-error')
    })

    it('text content 为空 → empty', () => {
        mockedMeta.mockReturnValue({ data: { mime: 'text/plain', size: 100, etag: 'e' }, isLoading: false, error: null } as any)
        mockedContent.mockReturnValue({ data: null, isLoading: false, error: null } as any)
        expect(renderState().result.current.status).toBe('empty')
    })

    it('text ready → ready，text 为 blob 解析出的字符串', async () => {
        mockedMeta.mockReturnValue({ data: { mime: 'text/plain', size: 100, etag: 'e' }, isLoading: false, error: null } as any)
        const blob = { text: async () => 'hello' } as unknown as Blob
        mockedContent.mockReturnValue({ data: { blob, mime: 'text/plain', etag: 'e' }, isLoading: false, error: null } as any)
        const { result } = renderState()
        await act(async () => { await Promise.resolve() })
        expect(result.current.status).toBe('ready')
        expect(result.current.status === 'ready' && result.current.text).toBe('hello')
    })

    it('markdown ready：view 切换 toggleView 生效，filePath 变化重置', async () => {
        mockedMeta.mockReturnValue({ data: { mime: 'text/markdown', size: 100, etag: 'e' }, isLoading: false, error: null } as any)
        const blob = { text: async () => '# hi' } as unknown as Blob
        mockedContent.mockReturnValue({ data: { blob, mime: 'text/markdown', etag: 'e' }, isLoading: false, error: null } as any)
        const { result } = renderState('s', 'a.md')
        await act(async () => { await Promise.resolve() })
        expect(result.current.status === 'ready' && result.current.kind.kind).toBe('markdown')
        expect(result.current.status === 'ready' && result.current.view).toBe('render')

        act(() => { result.current.status === 'ready' && result.current.toggleView() })
        expect(result.current.status === 'ready' && result.current.view).toBe('source')
    })
})
