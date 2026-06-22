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

import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest'
import '@testing-library/jest-dom/vitest'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'
import { App as AntApp } from 'antd'
import FileContentView from '@/components/files/FileContentView'
import { useWorkspaceStore } from '@/core/data/stores/workspaceStore'
import { useFileContent, useFileMeta } from '@/core/data/hooks/queries/useFileTree'
import { queryKeys } from '@/core/lib/query-keys'
import type { FileContent, FileMeta } from '@/core/data/hooks/queries/useFileTree'

// useQueryClient spy：刷新项测试断言 invalidateQueries 被以 sessionFileMeta key 调用。
// importActual 保留 QueryClient/QueryClientProvider 等其余真实导出，避免破坏 Provider 渲染。
const invalidateQueriesSpy = vi.fn()
vi.mock('@tanstack/react-query', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@tanstack/react-query')>()
    return {
        ...actual,
        useQueryClient: () => ({ invalidateQueries: invalidateQueriesSpy }),
    }
})
// 延迟引入被 mock 的模块（在 vi.mock 之后），拿真实的 QueryClient/Provider
const { QueryClient, QueryClientProvider } = await import('@tanstack/react-query')

// jsdom 没有 ResizeObserver（antd Tabs/Tree 依赖）
beforeAll(() => {
    vi.stubGlobal('ResizeObserver', class {
        observe() {}
        unobserve() {}
        disconnect() {}
    })
})

vi.mock('@/core/data/hooks/queries/useFileTree', async () => {
    const actual = await vi.importActual<typeof import('@/core/data/hooks/queries/useFileTree')>(
        '@/core/data/hooks/queries/useFileTree',
    )
    return {
        // useFileMeta：返回 mime/size/etag（默认小文本，触发高亮路径）
        // useFileContent：返回二进制流结果 {blob, mime, etag}
        // useFileTree：返回可点击文件（Popover 内 FileTreeView 用）
        useFileMeta: vi.fn(() => ({
            data: { mime: 'text/typescript', size: 100, etag: '11-1' } as FileMeta,
            isLoading: false,
        })),
        useFileContent: vi.fn(() => ({
            data: { blob: new Blob(['FILE BODY'], { type: 'text/plain' }), mime: 'text/plain', etag: '11-1' } as FileContent,
            isLoading: false,
        })),
        useFileTree: vi.fn(() => ({
            data: [{ name: 'other.ts', path: 'a/other.ts', type: 'file' }],
            isLoading: false,
        })),
        parseDirectoryEntries: actual.parseDirectoryEntries,
    }
})

// FileTreeView 还依赖 api client 与 auth
vi.mock('@/core/data/api/client', () => ({
    useMobiApi: vi.fn(() => ({ files: { list: vi.fn() } })),
}))
vi.mock('@/core/data/stores/authStore', () => ({
    useAuthStore: vi.fn(() => ({ token: 't' })),
}))

vi.mock('react-i18next', async (importOriginal) => {
    const actual = await importOriginal<typeof import('react-i18next')>()
    return {
        ...actual,
        // useTranslation 直接回 key（测试断言按 key 文案）
        useTranslation: () => ({ t: (k: string) => k }),
    }
})

function renderWithProviders(ui: React.ReactNode) {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    return render(
        <QueryClientProvider client={qc}>
            <AntApp>{ui}</AntApp>
        </QueryClientProvider>,
    )
}

/** 统一设置 meta + content 的 mock 返回值（content 可选，默认 null——大文件/PDF/音视频/二进制不拉 content） */
function setMock(meta: FileMeta | null, content: FileContent | null = null) {
    vi.mocked(useFileMeta).mockReturnValue({
        data: meta, isLoading: false,
    } as never)
    vi.mocked(useFileContent).mockReturnValue({
        data: content, isLoading: false,
    } as never)
}

describe('FileContentView', () => {
    beforeEach(() => useWorkspaceStore.getState().clearAll())
    afterEach(() => cleanup())

    it('面包屑按 / 分段显示，文件名加粗', () => {
        setMock({ mime: 'text/typescript', size: 100, etag: '11-1' }, null)
        renderWithProviders(<FileContentView sessionId="s1" tabId="t1" filePath="a/b/c.ts" />)
        expect(screen.getByText('a')).toBeInTheDocument()
        expect(screen.getByText('b')).toBeInTheDocument()
        const fileNode = screen.getByText('c.ts')
        expect(fileNode).toBeInTheDocument()
        expect(fileNode).toHaveStyle({ fontWeight: '600' })
    })

    it('小文本（<1MB）→ CodeHighlight 高亮渲染', async () => {
        setMock(
            { mime: 'text/typescript', size: 100, etag: '11-1' },
            { blob: new Blob(['const x = 1'], { type: 'text/typescript' }), mime: 'text/typescript' },
        )

        renderWithProviders(<FileContentView sessionId="s1" tabId="t1" filePath="a/b/c.ts" />)
        // Shiki 异步高亮：await codeToHtml 完成 → 出现 .shiki-wrap（高亮成功的标志）
        await waitFor(() => {
            expect(document.querySelector('.shiki-wrap')).toBeInTheDocument()
        })
    })

    it('中文本（1-2MB）→ 纯 pre 不高亮（useHighlight=false）', async () => {
        // 1.5MB：≥ textHighlight(1MB) 且 < textPlain(2MB) → 纯 pre
        setMock(
            { mime: 'text/plain', size: 1.5 * 1024 * 1024, etag: '11-1' },
            { blob: new Blob(['plain content'], { type: 'text/plain' }), mime: 'text/plain' },
        )

        renderWithProviders(<FileContentView sessionId="s1" tabId="t1" filePath="a/b/big.txt" />)
        // 纯文本分支渲染出 <pre>，内容为 plain content
        expect(await screen.findByText('plain content')).toBeInTheDocument()
        // 无 shiki-wrap（不高亮）
        expect(document.querySelector('.shiki-wrap')).not.toBeInTheDocument()
    })

    it('大文本（≥2MB）→ FileTooLarge 提示 + 下载按钮，不拉 content', () => {
        const contentMock = vi.mocked(useFileContent)
        // 3MB ≥ textPlain(2MB) → tooLarge
        setMock({ mime: 'text/plain', size: 3 * 1024 * 1024, etag: '11-1' }, null)

        renderWithProviders(<FileContentView sessionId="s1" tabId="t1" filePath="a/b/huge.txt" />)
        // 命中 files.tooLarge 文案
        expect(screen.getByText('files.tooLarge')).toBeInTheDocument()
        // 出现下载按钮（文案 files.download）
        expect(screen.getByText('files.download')).toBeInTheDocument()
        // useFileContent 因 enabled=false 不应被「以 truthy enabled 态」求值——
        // 这里仅断言 content 数据为 null（shouldFetchContent=false 时 meta tooLarge 已拦截）
        expect(contentMock).toHaveBeenCalled()
    })

    it('图片（<5MB）→ src 直连 read-file 端点渲染 img', async () => {
        // 图片 src 直连：不 fetch content（shouldFetchContent 不含 image），img 的 src 指向 read-file 端点
        setMock({ mime: 'image/png', size: 1024 * 1024, etag: '11-1' }, null)

        renderWithProviders(<FileContentView sessionId="s1" tabId="t1" filePath="a/b/logo.png" />)
        const img = await screen.findByRole('img')
        expect(img).toBeInTheDocument()
        // src = /api/sessions/s1/read-file?path=a%2Fb%2Flogo.png（encodeURIComponent 编码路径）
        expect(img).toHaveAttribute('src', '/api/sessions/s1/read-file?path=a%2Fb%2Flogo.png')
    })

    it('大图片（≥5MB）→ FileTooLarge', () => {
        setMock({ mime: 'image/png', size: 6 * 1024 * 1024, etag: '11-1' }, null)

        renderWithProviders(<FileContentView sessionId="s1" tabId="t1" filePath="a/b/big.png" />)
        expect(screen.getByText('files.tooLarge')).toBeInTheDocument()
        expect(screen.getByText('files.download')).toBeInTheDocument()
        expect(screen.queryByRole('img')).not.toBeInTheDocument()
    })

    it('其他二进制 → FileTooLarge（files.binaryDownload）', () => {
        // application/octet-stream 既非 text/image/pdf/audio/video → 走最后的 binaryDownload 分支
        // 此类型 shouldFetchContent=false，不会拉 content
        setMock({ mime: 'application/octet-stream', size: 100, etag: '11-1' }, null)

        renderWithProviders(<FileContentView sessionId="s1" tabId="t1" filePath="a/b/app.bin" />)
        // 命中 files.binaryDownload 文案
        expect(screen.getByText('files.binaryDownload')).toBeInTheDocument()
        // 不出现文本/图片渲染分支
        expect(screen.queryByRole('img')).not.toBeInTheDocument()
    })

    it('application/zip → FileTooLarge（files.binaryDownload）', () => {
        setMock({ mime: 'application/zip', size: 100, etag: '11-1' }, null)

        renderWithProviders(<FileContentView sessionId="s1" tabId="t1" filePath="a/b/app.zip" />)
        expect(screen.getByText('files.binaryDownload')).toBeInTheDocument()
    })

    it('PDF → FileTooLarge pdfDownload（不拉 content）', async () => {
        setMock({ mime: 'application/pdf', size: 1 * 1024 * 1024, etag: '11-1' })

        renderWithProviders(<FileContentView sessionId="s1" tabId="t1" filePath="doc.pdf" />)
        expect(await screen.findByText('files.pdfDownload')).toBeInTheDocument()
        // PDF 分支 shouldFetchContent=false，不出现文本/图片渲染
        expect(screen.queryByRole('img')).not.toBeInTheDocument()
    })

    it('音视频 → FileTooLarge mediaDownload（不拉 content）', async () => {
        setMock({ mime: 'audio/mpeg', size: 1 * 1024 * 1024, etag: '11-1' })

        renderWithProviders(<FileContentView sessionId="s1" tabId="t1" filePath="song.mp3" />)
        expect(await screen.findByText('files.mediaDownload')).toBeInTheDocument()
        expect(screen.queryByRole('img')).not.toBeInTheDocument()
    })

    it('Ellipsis → 复制相对路径到剪切板并提示', async () => {
        const writeText = vi.fn().mockResolvedValue(undefined)
        Object.assign(navigator, { clipboard: { writeText } })
        setMock({ mime: 'text/typescript', size: 100, etag: '11-1' }, null)

        renderWithProviders(
            <FileContentView sessionId="s1" tabId="t1" filePath="a/b/c.ts" />,
        )
        // 点 Ellipsis 按钮（aria-label = files.more）展开下拉
        fireEvent.click(screen.getByRole('button', { name: 'files.more' }))
        // 菜单项出现后点击「复制文件路径」
        const copyItem = await screen.findByText('files.copyPath')
        fireEvent.click(copyItem)
        await waitFor(() => {
            expect(writeText).toHaveBeenCalledWith('a/b/c.ts')
        })
    })

    it('Folders → 选另一文件 → 调 openFileInTab(当前 tabId) 切换', async () => {
        // 预置：s1 已有 tree tab t1（模拟 InspectorPane 正常打开场景）
        // openFileInTab 语义：把 tree tab 转为 file tab。若无此 tab，tabs.map 空跑不会新增 → 测试无意义
        useWorkspaceStore.setState((s) => ({
            sessions: new Map(s.sessions).set('s1', {
                expanded: true,
                splitRatio: 0.5,
                chatHidden: false,
                tabs: [{ id: 't1', mode: 'tree' }],
                activeTabId: 't1',
            }),
        }))
        setMock({ mime: 'text/typescript', size: 100, etag: '11-1' }, null)

        renderWithProviders(<FileContentView sessionId="s1" tabId="t1" filePath="a/b/c.ts" />)
        // 点 Folders 按钮
        fireEvent.click(screen.getByRole('button', { name: 'files.openFromTree' }))
        // Popover 内文件树出现 other.ts（lazy mount，用 findByText await）
        const otherNode = await screen.findByText('other.ts')
        // 点文件节点：照搬 FileTreeView.test.tsx 的点击写法（文本节点 click 即触发 onSelect → onOpenFile）
        fireEvent.click(otherNode)
        // store：t1 tab 由 tree 转为 file，filePath 变 a/other.ts
        await waitFor(() => {
            const s = useWorkspaceStore.getState().getSession('s1')
            const tab = s.tabs.find((t) => t.id === 't1')
            expect(tab?.filePath).toBe('a/other.ts')
        })
    })

    it('.md 默认渲染（XMarkdown）', async () => {
        setMock(
            { mime: 'text/markdown', size: 100, etag: '11-1' },
            { blob: new Blob(['body content'], { type: 'text/markdown' }), mime: 'text/markdown' },
        )
        renderWithProviders(<FileContentView sessionId="s1" tabId="t1" filePath="README.md" />)
        // .x-markdown 是 Markdown.tsx 容器 className，渲染成功的标志
        await waitFor(() => {
            expect(document.querySelector('.x-markdown')).toBeInTheDocument()
        })
    })

    it('.md 切源码（CodeHighlight Shiki）', async () => {
        setMock(
            { mime: 'text/markdown', size: 100, etag: '11-1' },
            { blob: new Blob(['# title'], { type: 'text/markdown' }), mime: 'text/markdown' },
        )
        renderWithProviders(<FileContentView sessionId="s1" tabId="t1" filePath="README.md" />)
        // 点 Ellipsis → 切源码
        fireEvent.click(screen.getByRole('button', { name: 'files.more' }))
        fireEvent.click(await screen.findByText('files.viewSource'))
        // .shiki-wrap 是 CodeHighlight 高亮成功的标志
        await waitFor(() => {
            expect(document.querySelector('.shiki-wrap')).toBeInTheDocument()
        })
    })

    it('非 .md 文本文件 Ellipsis 无 toggleView', async () => {
        setMock(
            { mime: 'text/typescript', size: 100, etag: '11-1' },
            { blob: new Blob(['const x = 1'], { type: 'text/typescript' }), mime: 'text/typescript' },
        )
        renderWithProviders(<FileContentView sessionId="s1" tabId="t1" filePath="a.ts" />)
        fireEvent.click(screen.getByRole('button', { name: 'files.more' }))
        expect(screen.queryByText('files.viewSource')).not.toBeInTheDocument()
    })

    it('大 .md（≥2MB）→ FileTooLarge', async () => {
        // 3MB ≥ textPlain(2MB)：isMarkdown 的 tooLarge 走 isTextLike 分支（text/markdown 以 text/ 开头）
        setMock({ mime: 'text/markdown', size: 3 * 1024 * 1024, etag: '11-1' }, null)
        renderWithProviders(<FileContentView sessionId="s1" tabId="t1" filePath="big.md" />)
        expect(await screen.findByText('files.tooLarge')).toBeInTheDocument()
    })

    it('useFileContent 收 meta.etag 作为参数（etag 维度进 queryKey 驱动 refetch）', () => {
        // 第 4 个参数 = meta?.etag，meta 先行拿到 etag 后应透传给 useFileContent
        setMock({ mime: 'text/typescript', size: 100, etag: 'v1' }, null)
        renderWithProviders(<FileContentView sessionId="s1" tabId="t1" filePath="a/b/c.ts" />)
        expect(useFileContent).toHaveBeenCalledWith('s1', 'a/b/c.ts', true, 'v1')
    })

    it('meta.etag 变化 → useFileContent 以新 etag 再次被调用（queryKey 变触发 refetch）', () => {
        const contentMock = vi.mocked(useFileContent)
        // 初始 etag='v1'
        setMock({ mime: 'text/typescript', size: 100, etag: 'v1' }, null)
        const { rerender } = renderWithProviders(<FileContentView sessionId="s1" tabId="t1" filePath="a/b/c.ts" />)
        expect(contentMock).toHaveBeenLastCalledWith('s1', 'a/b/c.ts', true, 'v1')

        // 模拟窗口聚焦 / 刷新后 meta refetch 拿到新 etag='v2'，重渲染
        setMock({ mime: 'text/typescript', size: 100, etag: 'v2' }, null)
        rerender(
            <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
                <AntApp><FileContentView sessionId="s1" tabId="t1" filePath="a/b/c.ts" /></AntApp>
            </QueryClientProvider>,
        )
        // useFileContent 以新 etag='v2' 被调用 → queryKey 含 etag 变化 → content 自动 refetch
        expect(contentMock).toHaveBeenLastCalledWith('s1', 'a/b/c.ts', true, 'v2')
    })

    it('Ellipsis → 刷新项 invalidate meta（联动 content refetch）', async () => {
        setMock({ mime: 'text/typescript', size: 100, etag: '11-1' }, null)
        invalidateQueriesSpy.mockClear()
        renderWithProviders(<FileContentView sessionId="s1" tabId="t1" filePath="a/b/c.ts" />)

        // 点 Ellipsis 展开 → 点刷新项
        fireEvent.click(screen.getByRole('button', { name: 'files.more' }))
        fireEvent.click(await screen.findByText('files.refresh'))
        // 断言 invalidateQueries 被以 sessionFileMeta key 调用（meta refetch → etag 变 → content 自动跟随）
        await waitFor(() => {
            expect(invalidateQueriesSpy).toHaveBeenCalledWith({
                queryKey: queryKeys.sessionFileMeta('s1', 'a/b/c.ts'),
            })
        })
    })
})
