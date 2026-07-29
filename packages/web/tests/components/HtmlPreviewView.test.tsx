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
import React from 'react'
import '@testing-library/jest-dom/vitest'
import { render, cleanup, screen, waitFor, act } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ConfigProvider } from 'antd'
import HtmlPreviewView from '@/components/files/HtmlPreviewView'
import { queryKeys } from '@/core/lib/query-keys'

// useFileMeta 订阅 meta（etag）驱动 iframe 重建；mock useMobiApi.files.meta 返回可控 etag。
// mockApi 必须稳定引用（见 usemobiapi-stable-mock 记忆），否则 useMemo/useQuery effect 无限循环。
const { mockApi, mockMeta } = vi.hoisted(() => {
    const mockMeta = vi.fn()
    return { mockMeta, mockApi: { files: { meta: mockMeta } } }
})
vi.mock('@/core/data/api/client', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@/core/data/api/client')>()
    return { ...actual, useMobiApi: () => mockApi }
})

// react-i18next：保留 initReactI18next 等（i18n 初始化需要），仅覆写 useTranslation 返回 key
vi.mock('react-i18next', async (importOriginal) => {
    const actual = await importOriginal<typeof import('react-i18next')>()
    return {
        ...actual,
        useTranslation: () => ({ t: (k: string) => k }),
    }
})

function Wrapper({ children }: { children: React.ReactNode }) {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    return (
        <QueryClientProvider client={qc}>
            <ConfigProvider>{children}</ConfigProvider>
        </QueryClientProvider>
    )
}

/**
 * 带可控 QueryClient 的渲染：新用例需在渲染后 invalidate meta 验证 iframe 重建，
 * 故要把 qc 暴露出来（Wrapper 内部新建的拿不到）。
 */
function renderWithQc(overrides: { filePath?: string; view?: 'render' | 'source' } = {}) {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const result = render(
        <QueryClientProvider client={qc}>
            <ConfigProvider>
                <HtmlPreviewView
                    sessionId="s1"
                    filePath={overrides.filePath ?? 'a.html'}
                    view={overrides.view ?? 'render'}
                    text=""
                    wrap={false}
                />
            </ConfigProvider>
        </QueryClientProvider>,
    )
    return { ...result, qc }
}

describe('HtmlPreviewView', () => {
    beforeEach(() => {
        // 默认 meta：etag=v1，供 source/现有 render 用例稳定渲染
        mockMeta.mockResolvedValue({
            data: { success: true, meta: { mime: 'text/html', size: 100, etag: 'v1' } },
        })
    })
    afterEach(() => cleanup())

    it('view="source" → 渲染 TextContentView（源码），不渲染 iframe', () => {
        render(
            <HtmlPreviewView sessionId="s1" filePath="a.html" view="source" text="<p>hi</p>" wrap={false} />,
            { wrapper: Wrapper },
        )
        expect(document.querySelector('.text-content-view')).toBeInTheDocument()
        // source 模式不应渲染 iframe
        expect(document.querySelector('iframe')).not.toBeInTheDocument()
    })

    it('view="render" → iframe 指向 serve-file（filePath 直接作 relPath 按段编码），sandbox 隔离', () => {
        render(
            <HtmlPreviewView sessionId="s1" filePath="site/ind ex.html" view="render" text="" wrap={false} />,
            { wrapper: Wrapper },
        )

        const iframe = document.querySelector('iframe')
        expect(iframe).not.toBeNull()
        // filePath 来自文件树（相对 cwd 的 posix 路径），每段编码后拼 serve-file path 段
        expect(iframe!).toHaveAttribute('src', '/api/sessions/s1/serve-file/site/ind%20ex.html')
        // sandbox 必须含 allow-scripts（预览需要 JS 运行）
        const sandbox = iframe!.getAttribute('sandbox') ?? ''
        expect(sandbox).toContain('allow-scripts')
        // allow-same-origin：iframe 与 mobi 同源，引用的 CSS/JS 才不会被 Chrome ORB 拦截
        // （sandboxed opaque origin 的跨源 no-cors 子资源会被 ORB 丢弃）。安全权衡见组件注释。
        expect(sandbox).toContain('allow-same-origin')
        // referrerPolicy=no-referrer 防泄漏本机路径
        expect(iframe!).toHaveAttribute('referrerPolicy', 'no-referrer')
    })

    it('filePath 为空 → 不渲染 iframe，显示 Empty 提示', () => {
        render(
            <HtmlPreviewView sessionId="s1" filePath="" view="render" text="" wrap={false} />,
            { wrapper: Wrapper },
        )
        // 越界判定已下沉到 hub（isWithinDir），前端只对空 filePath 降级提示
        expect(document.querySelector('iframe')).not.toBeInTheDocument()
        expect(screen.getByText('files.previewUnavailable')).toBeInTheDocument()
    })

    it('iframe key 绑 meta etag：初次渲染 data-etag 反映当前 etag', async () => {
        renderWithQc({ filePath: 'a.html' })
        // etag 进入 iframe 的 data-etag（测试钩子）+ key（etag 变则 React 重建）
        await waitFor(() => {
            expect(screen.getByTitle('html-preview')).toHaveAttribute('data-etag', 'v1')
        })
    })

    it('刷新（meta etag 变化）→ iframe 重建，data-etag 更新到最新', async () => {
        // FileContentView 顶部「刷新」项 invalidate sessionFileMeta → meta refetch 拿新 etag →
        // iframe key 变 → React 重建 → 浏览器重新加载（serve-file no-cache 连带引用 CSS/JS 回源）
        const { qc } = renderWithQc({ filePath: 'a.html' })
        // beforeEach 默认 etag=v1
        await waitFor(() => {
            expect(screen.getByTitle('html-preview')).toHaveAttribute('data-etag', 'v1')
        })

        // 模拟文件被改写后点刷新：meta refetch 返回新 etag
        mockMeta.mockResolvedValue({
            data: { success: true, meta: { mime: 'text/html', size: 120, etag: 'v2' } },
        })
        await act(async () => {
            await qc.invalidateQueries({ queryKey: queryKeys.sessionFileMeta('s1', 'a.html') })
        })
        await waitFor(() => {
            expect(screen.getByTitle('html-preview')).toHaveAttribute('data-etag', 'v2')
        })
    })
})
