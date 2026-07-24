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
import { render, cleanup, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ConfigProvider } from 'antd'
import HtmlPreviewView from '@/components/files/HtmlPreviewView'

// mock useSession：默认 cwd=/proj（filePath 在其内则渲染 iframe）
vi.mock('@/core/data/hooks/queries/useSession', () => ({
    useSession: vi.fn(),
}))

import { useSession } from '@/core/data/hooks/queries/useSession'
const mockedUseSession = vi.mocked(useSession)

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

describe('HtmlPreviewView', () => {
    beforeEach(() => { mockedUseSession.mockReset() })
    afterEach(() => cleanup())

    it('view="source" → 渲染 TextContentView（.text-content-view）', () => {
        mockedUseSession.mockReturnValue({ data: undefined, isLoading: false } as never)
        render(
            <HtmlPreviewView sessionId="s1" filePath="a.html" view="source" text="<p>hi</p>" wrap={false} />,
            { wrapper: Wrapper },
        )
        expect(document.querySelector('.text-content-view')).toBeInTheDocument()
        // source 模式不应渲染 iframe
        expect(document.querySelector('iframe')).not.toBeInTheDocument()
    })

    it('view="render" 且 filePath 在 cwd 内 → iframe 指向 serve-file 端点（sandbox 不含 allow-same-origin）', () => {
        mockedUseSession.mockReturnValue({
            data: { metadata: { path: '/proj' } },
            isLoading: false,
        } as never)

        render(
            <HtmlPreviewView sessionId="s1" filePath="/proj/site/index.html" view="render" text="" wrap={false} />,
            { wrapper: Wrapper },
        )

        const iframe = document.querySelector('iframe')
        expect(iframe).not.toBeNull()
        // 相对 cwd 的路径段被 URL 编码（index.html 段 → index.html，无特殊字符不变）
        // 路径 /proj/site/index.html 相对 /proj → site/index.html
        expect(iframe!).toHaveAttribute('src', '/api/sessions/s1/serve-file/site/index.html')
        // sandbox 必须含 allow-scripts（预览需要 JS 运行）
        const sandbox = iframe!.getAttribute('sandbox') ?? ''
        expect(sandbox).toContain('allow-scripts')
        // 严禁 allow-same-origin：保持 opaque origin 隔离，防止读取 mobi cookie/storage
        expect(sandbox).not.toContain('allow-same-origin')
        // referrerPolicy=no-referrer 防泄漏本机路径
        expect(iframe!).toHaveAttribute('referrerPolicy', 'no-referrer')
    })

    it('filePath 不在 cwd 内（越界）→ 不渲染 iframe，显示 Empty 提示', () => {
        mockedUseSession.mockReturnValue({
            data: { metadata: { path: '/proj' } },
            isLoading: false,
        } as never)

        render(
            <HtmlPreviewView sessionId="s1" filePath="/etc/passwd" view="render" text="" wrap={false} />,
            { wrapper: Wrapper },
        )
        // 越界：不渲染 iframe
        expect(document.querySelector('iframe')).not.toBeInTheDocument()
        // 显示 files.previewUnavailable 文案（Empty description）
        expect(screen.getByText('files.previewUnavailable')).toBeInTheDocument()
    })
})
