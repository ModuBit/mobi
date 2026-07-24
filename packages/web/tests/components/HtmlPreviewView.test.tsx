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

import { describe, it, expect, vi, afterEach } from 'vitest'
import React from 'react'
import '@testing-library/jest-dom/vitest'
import { render, cleanup, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ConfigProvider } from 'antd'
import HtmlPreviewView from '@/components/files/HtmlPreviewView'

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
        // 严禁 allow-same-origin：保持 opaque origin 隔离，防止读取 mobi cookie/storage
        expect(sandbox).not.toContain('allow-same-origin')
        // referrerPolicy=no-referrer 防泄漏本机路径
        expect(iframe!).toHaveAttribute('referrerPolicy', 'no-referrer')
        // 下载入口（非新标签打开）：脱离 sandbox 的入口改为强制 ?download=1 下载
        const downloadLink = screen.getByText('files.download')
        expect(downloadLink).toHaveAttribute('href', '/api/sessions/s1/serve-file/site/ind%20ex.html?download=1')
        expect(downloadLink).toHaveAttribute('download')
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
})
