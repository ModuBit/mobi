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
import { render, screen, cleanup } from '@testing-library/react'
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

vi.mock('@/core/data/hooks/queries/useFileTree', () => ({
    // useFileContent：返回固定内容；useFileTree：返回空（Popover 内 FileTreeView 用，Task4 再细化）
    useFileContent: vi.fn(() => ({ data: 'FILE BODY', isLoading: false })),
    useFileTree: vi.fn(() => ({ data: [], isLoading: false })),
    parseDirectoryEntries: vi.fn((d: { entries?: unknown[] }) => (d.entries ?? []).map((e) => e)),
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
})
