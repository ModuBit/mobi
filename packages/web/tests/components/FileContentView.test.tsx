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
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { App as AntApp } from 'antd'
import FileContentView from '@/components/files/FileContentView'
import { useWorkspaceStore } from '@/core/data/stores/workspaceStore'

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
        // useFileContent：返回固定内容；useFileTree：返回可点击文件（Popover 内 FileTreeView 用）
        useFileContent: vi.fn(() => ({ data: 'FILE BODY', isLoading: false })),
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

vi.mock('react-i18next', () => ({
    useTranslation: () => ({ t: (k: string) => k }),
}))

function renderWithProviders(ui: React.ReactNode) {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    return render(
        <QueryClientProvider client={qc}>
            <AntApp>{ui}</AntApp>
        </QueryClientProvider>,
    )
}

describe('FileContentView', () => {
    beforeEach(() => useWorkspaceStore.getState().clearAll())
    afterEach(() => cleanup())

    it('面包屑按 / 分段显示，文件名加粗', () => {
        renderWithProviders(<FileContentView sessionId="s1" tabId="t1" filePath="a/b/c.ts" />)
        expect(screen.getByText('a')).toBeInTheDocument()
        expect(screen.getByText('b')).toBeInTheDocument()
        const fileNode = screen.getByText('c.ts')
        expect(fileNode).toBeInTheDocument()
        expect(fileNode).toHaveStyle({ fontWeight: '600' })
    })

    it('content 区显示文件内容', () => {
        renderWithProviders(<FileContentView sessionId="s1" tabId="t1" filePath="a/b/c.ts" />)
        expect(screen.getByText('FILE BODY')).toBeInTheDocument()
    })

    it('Ellipsis → 复制相对路径到剪切板并提示', async () => {
        const writeText = vi.fn().mockResolvedValue(undefined)
        Object.assign(navigator, { clipboard: { writeText } })

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
})
