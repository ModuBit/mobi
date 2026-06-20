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
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import FileTreeView from '@/components/files/FileTreeView'

// jsdom 没有 ResizeObserver（antd Tree 依赖）
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
    return { useFileTree: vi.fn(), parseDirectoryEntries: actual.parseDirectoryEntries }
})

vi.mock('@/core/data/api/client', () => ({
    useMobiApi: vi.fn(() => ({ files: { list: vi.fn() } })),
}))

vi.mock('@/core/data/stores/authStore', () => ({
    useAuthStore: vi.fn(() => ({ token: 't' })),
}))

import { useFileTree } from '@/core/data/hooks/queries/useFileTree'
import { useMobiApi } from '@/core/data/api/client'

const mockedUseFileTree = vi.mocked(useFileTree)
const mockedUseMobiApi = vi.mocked(useMobiApi)

function renderWithClient(ui: React.ReactNode) {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>)
}

describe('FileTreeView', () => {
    beforeEach(() => {
        mockedUseFileTree.mockReset()
        mockedUseMobiApi.mockReset()
    })
    afterEach(() => cleanup())

    it('渲染根目录文件，点文件触发 onOpenFile', async () => {
        mockedUseFileTree.mockReturnValue({
            data: [
                { name: 'a.ts', path: 'a.ts', type: 'file' },
                { name: 'src', path: 'src', type: 'directory' },
            ],
            isLoading: false,
        } as any)
        mockedUseMobiApi.mockReturnValue({ files: { list: vi.fn() } } as any)

        const onOpenFile = vi.fn()
        renderWithClient(<FileTreeView sessionId="s1" onOpenFile={onOpenFile} />)

        expect(await screen.findByText('a.ts')).toBeInTheDocument()
        fireEvent.click(screen.getByText('a.ts'))
        expect(onOpenFile).toHaveBeenCalledWith('a.ts', 'a.ts')
    })

    it('展开目录时按路径懒加载子级', async () => {
        mockedUseFileTree.mockImplementation((_s, _path) => ({
            data: [{ name: 'src', path: 'src', type: 'directory' }],
            isLoading: false,
        } as any))
        const listFn = vi.fn().mockResolvedValue({
            data: { success: true, entries: [{ name: 'inner.ts', type: 'file' as const }] },
        })
        mockedUseMobiApi.mockReturnValue({ files: { list: listFn } } as any)

        const onOpenFile = vi.fn()
        const { container } = renderWithClient(
            <FileTreeView sessionId="s1" onOpenFile={onOpenFile} />,
        )

        // 点击目录节点的 switcher 触发展开 → loadData
        const switchers = container.querySelectorAll('.ant-tree-switcher')
        expect(switchers.length).toBeGreaterThan(0)
        fireEvent.click(switchers[0])

        await waitFor(() => {
            expect(screen.getByText('inner.ts')).toBeInTheDocument()
        })
        expect(listFn).toHaveBeenCalledWith('s1', 'src')
    })

    it('点子目录里的文件也能触发 onOpenFile（带完整相对路径与 basename）', async () => {
        mockedUseFileTree.mockImplementation(() => ({
            data: [{ name: 'src', path: 'src', type: 'directory' }],
            isLoading: false,
        } as any))
        const listFn = vi.fn().mockResolvedValue({
            data: { success: true, entries: [{ name: 'inner.ts', type: 'file' as const }] },
        })
        mockedUseMobiApi.mockReturnValue({ files: { list: listFn } } as any)

        const onOpenFile = vi.fn()
        const { container } = renderWithClient(
            <FileTreeView sessionId="s1" onOpenFile={onOpenFile} />,
        )

        fireEvent.click(container.querySelectorAll('.ant-tree-switcher')[0])
        const inner = await screen.findByText('inner.ts')
        fireEvent.click(inner)

        // 子目录文件不在 rootFiles 里，靠 isLeaf 判断；路径为 dir/file，名为 basename
        expect(onOpenFile).toHaveBeenCalledWith('src/inner.ts', 'inner.ts')
    })

    it('读取失败（success:false）时显示错误而非「无文件」空态', () => {
        mockedUseFileTree.mockReturnValue({
            data: undefined,
            isLoading: false,
            error: new Error('permission denied'),
        } as any)
        mockedUseMobiApi.mockReturnValue({ files: { list: vi.fn() } } as any)

        renderWithClient(<FileTreeView sessionId="s1" onOpenFile={vi.fn()} />)

        expect(screen.getByText('permission denied')).toBeInTheDocument()
        // 不应误显示为空目录文案
        expect(screen.queryByText('files.empty')).toBeNull()
    })

    it('已缓存的目录再次展开不重复请求', async () => {
        mockedUseFileTree.mockImplementation(() => ({
            data: [{ name: 'src', path: 'src', type: 'directory' }],
            isLoading: false,
        } as any))
        const listFn = vi.fn().mockResolvedValue({
            data: { success: true, entries: [{ name: 'inner.ts', type: 'file' as const }] },
        })
        mockedUseMobiApi.mockReturnValue({ files: { list: listFn } } as any)

        const { container } = renderWithClient(
            <FileTreeView sessionId="s1" onOpenFile={vi.fn()} />,
        )

        const switchers = () => container.querySelectorAll('.ant-tree-switcher')
        fireEvent.click(switchers()[0])
        await waitFor(() => expect(screen.getByText('inner.ts')).toBeInTheDocument())

        // 收起再展开：childrenMap 已缓存，不再发请求
        fireEvent.click(switchers()[0])
        fireEvent.click(switchers()[0])
        await waitFor(() => expect(screen.getByText('inner.ts')).toBeInTheDocument())
        expect(listFn).toHaveBeenCalledTimes(1)
    })
})
