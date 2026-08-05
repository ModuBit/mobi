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

// 只 mock API 层，让真实 react-query 跑（这样才能测到 SWR 缓存 / invalidate 行为）
vi.mock('@/core/data/api/client', () => ({ useMobiApi: vi.fn() }))
vi.mock('@/core/data/stores/authStore', () => ({
    useAuthStore: vi.fn(() => ({ token: 't' })),
}))

import { useMobiApi } from '@/core/data/api/client'
const mockedUseMobiApi = vi.mocked(useMobiApi)

function renderWithClient(ui: React.ReactNode) {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const utils = render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>)
    return { ...utils, qc }
}

/** 按 path 返回不同目录内容；list('.',) 对应根目录 */
function makeList(entriesByPath: Record<string, { name: string; type: 'file' | 'directory'; size?: number; modified?: number }[]>) {
    return vi.fn(async (_s: string, p: string) => ({
        data: { success: true, entries: entriesByPath[p] ?? [] },
    }))
}

describe('FileTreeView', () => {
    beforeEach(() => mockedUseMobiApi.mockReset())
    afterEach(() => cleanup())

    it('渲染根目录文件，点文件触发 onOpenFile', async () => {
        const list = makeList({
            '.': [{ name: 'a.ts', type: 'file' }, { name: 'src', type: 'directory' }],
        })
        mockedUseMobiApi.mockReturnValue({ files: { list } } as any)

        const onOpenFile = vi.fn()
        renderWithClient(<FileTreeView sessionId="s1" onOpenFile={onOpenFile} />)

        expect(await screen.findByText('a.ts')).toBeInTheDocument()
        fireEvent.click(screen.getByText('a.ts'))
        expect(onOpenFile).toHaveBeenCalledWith('a.ts', 'a.ts')
    })

    it('展开目录（无缓存）时按路径拉取并显示子级', async () => {
        const list = makeList({
            '.': [{ name: 'src', type: 'directory' }],
            src: [{ name: 'inner.ts', type: 'file' }],
        })
        mockedUseMobiApi.mockReturnValue({ files: { list } } as any)

        const { container } = renderWithClient(<FileTreeView sessionId="s1" onOpenFile={vi.fn()} />)
        await screen.findByText('src')

        fireEvent.click(container.querySelectorAll('.ant-tree-switcher')[0])
        await waitFor(() => expect(screen.getByText('inner.ts')).toBeInTheDocument())
        expect(list).toHaveBeenCalledWith('s1', 'src')
    })

    it('点子目录里的文件触发 onOpenFile（带完整相对路径与 basename）', async () => {
        const list = makeList({
            '.': [{ name: 'src', type: 'directory' }],
            src: [{ name: 'inner.ts', type: 'file' }],
        })
        mockedUseMobiApi.mockReturnValue({ files: { list } } as any)

        const onOpenFile = vi.fn()
        const { container } = renderWithClient(<FileTreeView sessionId="s1" onOpenFile={onOpenFile} />)
        await screen.findByText('src')

        fireEvent.click(container.querySelectorAll('.ant-tree-switcher')[0])
        const inner = await screen.findByText('inner.ts')
        fireEvent.click(inner)

        expect(onOpenFile).toHaveBeenCalledWith('src/inner.ts', 'inner.ts')
    })

    it('读取失败（success:false）时显示错误而非「无文件」空态', async () => {
        const list = vi.fn(async () => ({ data: { success: false, error: 'permission denied' } }))
        mockedUseMobiApi.mockReturnValue({ files: { list } } as any)

        renderWithClient(<FileTreeView sessionId="s1" onOpenFile={vi.fn()} />)

        await waitFor(() => expect(screen.getByText('permission denied')).toBeInTheDocument())
        expect(screen.queryByText('files.empty')).toBeNull()
    })

    it('已缓存的目录收起再展开不重复请求', async () => {
        const list = makeList({
            '.': [{ name: 'src', type: 'directory' }],
            src: [{ name: 'inner.ts', type: 'file' }],
        })
        mockedUseMobiApi.mockReturnValue({ files: { list } } as any)

        const { container } = renderWithClient(<FileTreeView sessionId="s1" onOpenFile={vi.fn()} />)
        await screen.findByText('src')
        const switchers = () => container.querySelectorAll('.ant-tree-switcher')

        // 首次展开 src
        fireEvent.click(switchers()[0])
        await waitFor(() => expect(screen.getByText('inner.ts')).toBeInTheDocument())

        // 收起再展开：cache 已命中，list 不应再被调用 for src
        fireEvent.click(switchers()[0])
        fireEvent.click(switchers()[0])
        await waitFor(() => expect(screen.getByText('inner.ts')).toBeInTheDocument())
        expect(list.mock.calls.filter(c => c[1] === 'src')).toHaveLength(1)
    })

    it('active 从 false→true 时后台刷新目录（invalidate 触发 refetch）', async () => {        const list = makeList({
            '.': [{ name: 'a.ts', type: 'file' }],
        })
        mockedUseMobiApi.mockReturnValue({ files: { list } } as any)

        const onOpenFile = vi.fn()
        const { rerender, qc } = renderWithClient(
            <FileTreeView sessionId="s1" onOpenFile={onOpenFile} active={false} />,
        )
        await screen.findByText('a.ts')
        const rootCallsBefore = list.mock.calls.filter(c => c[1] === '.').length
        expect(rootCallsBefore).toBeGreaterThanOrEqual(1)

        // active→true：触发 invalidate，后台 refetch 根目录
        rerender(
            <QueryClientProvider client={qc}>
                <FileTreeView sessionId="s1" onOpenFile={onOpenFile} active={true} />
            </QueryClientProvider>,
        )
        await waitFor(() => {
            expect(list.mock.calls.filter(c => c[1] === '.').length).toBeGreaterThan(rootCallsBefore)
        })
    })

    it('hover 文件节点 → tooltip 展示完整名 + 大小 + 修改时间', async () => {
        const modified = Date.now() - 3 * 24 * 3600 * 1000 // 3 天前
        const list = makeList({
            '.': [{ name: 'long-name.ts', type: 'file', size: 1536, modified }],
        })
        mockedUseMobiApi.mockReturnValue({ files: { list } } as any)

        renderWithClient(<FileTreeView sessionId="s1" onOpenFile={vi.fn()} />)
        const node = await screen.findByText('long-name.ts')

        fireEvent.pointerOver(node, { pointerType: 'mouse', relatedTarget: document.body })
        // mouseEnterDelay 0.5s + tooltip portal 渲染，给足时间
        await waitFor(() => {
            expect(screen.getByText(/1\.5 KB/)).toBeInTheDocument()
        }, { timeout: 3000 })
    })

    it('hover 目录节点 → tooltip 不含大小（仅文件才有）', async () => {
        const list = makeList({
            '.': [{ name: 'src', type: 'directory', size: 4096, modified: Date.now() }],
        })
        mockedUseMobiApi.mockReturnValue({ files: { list } } as any)

        renderWithClient(<FileTreeView sessionId="s1" onOpenFile={vi.fn()} />)
        const node = await screen.findByText('src')

        fireEvent.pointerOver(node, { pointerType: 'mouse', relatedTarget: document.body })
        await waitFor(() => {
            // 目录即使 stat 出 size 也不显示（4 KB 是目录条目大小，会误导）
            expect(screen.queryByText(/4 KB/)).toBeNull()
        }, { timeout: 3000 })
    })

    it('输入筛选 → 防抖后渲染嵌套树（虚拟目录 + 文件叶子，全展开）', async () => {
        const list = makeList({ '.': [{ name: 'a.ts', type: 'file' }] })
        const searchFiles = vi.fn(async () => ({
            data: { success: true, entries: [{ name: 'foo.ts', type: 'file' as const, path: 'src/foo.ts' }] },
        }))
        mockedUseMobiApi.mockReturnValue({ files: { list }, sessions: { searchFiles } } as any)

        renderWithClient(<FileTreeView sessionId="s1" onOpenFile={vi.fn()} />)
        await screen.findByText('a.ts')

        fireEvent.change(screen.getByRole('textbox'), { target: { value: 'foo' } })
        // src 虚拟目录 + foo.ts 叶子，且 src 默认展开（叶子直接可见）
        await waitFor(() => expect(screen.getByText('src')).toBeInTheDocument())
        expect(screen.getByText('foo.ts')).toBeInTheDocument()
        expect(searchFiles).toHaveBeenCalledWith('s1', 'foo', 'file', expect.any(Object))
    })

    it('点筛选树叶子 → 调 onOpenFile（完整 path 与 basename）', async () => {
        const list = makeList({ '.': [{ name: 'a.ts', type: 'file' }] })
        const searchFiles = vi.fn(async () => ({
            data: { success: true, entries: [{ name: 'foo.ts', type: 'file' as const, path: 'src/foo.ts' }] },
        }))
        mockedUseMobiApi.mockReturnValue({ files: { list }, sessions: { searchFiles } } as any)

        const onOpenFile = vi.fn()
        renderWithClient(<FileTreeView sessionId="s1" onOpenFile={onOpenFile} />)
        await screen.findByText('a.ts')

        fireEvent.change(screen.getByRole('textbox'), { target: { value: 'foo' } })
        const leaf = await screen.findByText('foo.ts')
        fireEvent.click(leaf)
        expect(onOpenFile).toHaveBeenCalledWith('src/foo.ts', 'foo.ts')
    })

    it('树模式点刷新 → 重新拉取根目录与已展开子目录', async () => {
        const list = makeList({
            '.': [{ name: 'src', type: 'directory' }],
            src: [{ name: 'inner.ts', type: 'file' }],
        })
        mockedUseMobiApi.mockReturnValue({ files: { list } } as any)

        const { container } = renderWithClient(<FileTreeView sessionId="s1" onOpenFile={vi.fn()} />)
        await screen.findByText('src')
        // 先展开 src，让它进入订阅集合（刷新应连它一起刷）
        fireEvent.click(container.querySelectorAll('.ant-tree-switcher')[0])
        await waitFor(() => expect(screen.getByText('inner.ts')).toBeInTheDocument())

        const rootBefore = list.mock.calls.filter((c) => c[1] === '.').length
        const srcBefore = list.mock.calls.filter((c) => c[1] === 'src').length

        fireEvent.click(screen.getByRole('button', { name: 'files.refreshTree' }))

        await waitFor(() => {
            expect(list.mock.calls.filter((c) => c[1] === '.').length).toBeGreaterThan(rootBefore)
            expect(list.mock.calls.filter((c) => c[1] === 'src').length).toBeGreaterThan(srcBefore)
        })
    })

    it('搜索模式点刷新 → 重跑搜索（不刷目录）', async () => {
        const list = makeList({ '.': [{ name: 'a.ts', type: 'file' }] })
        const searchFiles = vi.fn(async () => ({
            data: { success: true, entries: [{ name: 'foo.ts', type: 'file' as const, path: 'src/foo.ts' }] },
        }))
        mockedUseMobiApi.mockReturnValue({ files: { list }, sessions: { searchFiles } } as any)

        renderWithClient(<FileTreeView sessionId="s1" onOpenFile={vi.fn()} />)
        await screen.findByText('a.ts')

        fireEvent.change(screen.getByRole('textbox'), { target: { value: 'foo' } })
        await waitFor(() => expect(searchFiles).toHaveBeenCalledTimes(1))
        const listBefore = list.mock.calls.length

        fireEvent.click(screen.getByRole('button', { name: 'files.refreshTree' }))

        await waitFor(() => expect(searchFiles).toHaveBeenCalledTimes(2))
        expect(list.mock.calls.length).toBe(listBefore)
    })

    // invalidateQueries 默认 cancelRefetch，而 fetchDirectory 未把 react-query 的 signal
    // 传给 api.files.list —— 取消只作用于 promise，请求仍会打到 hub。连点就是 N 个真实请求
    it('刷新中禁用按钮 → 连点不会打出多个请求', async () => {
        const list = makeList({ '.': [{ name: 'a.ts', type: 'file' }] })
        mockedUseMobiApi.mockReturnValue({ files: { list } } as any)

        renderWithClient(<FileTreeView sessionId="s1" onOpenFile={vi.fn()} />)
        await screen.findByText('a.ts')

        const btn = screen.getByRole('button', { name: 'files.refreshTree' })
        const before = list.mock.calls.filter((c) => c[1] === '.').length

        // 连点 5 次：首次生效后按钮进入禁用（最短旋转窗口兼作节流），后续点击应被吞掉
        for (let i = 0; i < 5; i++) fireEvent.click(btn)

        await waitFor(() => {
            expect(list.mock.calls.filter((c) => c[1] === '.').length).toBe(before + 1)
        })
        expect(btn).toBeDisabled()
    })

    // 刷新失败不该把用户眼前的树清掉——一次瞬时网络故障看起来会像「文件全没了」
    it('树模式刷新失败 → 保留已有树，只挂非阻断提示', async () => {
        let shouldFail = false
        const list = vi.fn(async (_s: string, p: string) => {
            if (shouldFail) throw new Error('network down')
            return { data: { success: true, entries: p === '.' ? [{ name: 'a.ts', type: 'file' as const }] : [] } }
        })
        mockedUseMobiApi.mockReturnValue({ files: { list } } as any)

        renderWithClient(<FileTreeView sessionId="s1" onOpenFile={vi.fn()} />)
        await screen.findByText('a.ts')

        // 后续刷新失败
        shouldFail = true
        fireEvent.click(screen.getByRole('button', { name: 'files.refreshTree' }))

        await waitFor(() => {
            expect(screen.getByText('files.refreshFailedStale')).toBeInTheDocument()
        })
        // 关键：树还在，没被错误空态顶掉
        expect(screen.getByText('a.ts')).toBeInTheDocument()
    })

    it('首次加载失败（无缓存可退守）→ 仍用错误空态占满面板', async () => {
        const list = vi.fn(async () => { throw new Error('boom') })
        mockedUseMobiApi.mockReturnValue({ files: { list } } as any)

        renderWithClient(<FileTreeView sessionId="s1" onOpenFile={vi.fn()} />)

        await waitFor(() => expect(screen.getByText('boom')).toBeInTheDocument())
        expect(screen.queryByText('files.refreshFailedStale')).not.toBeInTheDocument()
    })

    // 失败谎报成「无匹配文件」会让用户以为文件被删了
    it('搜索失败且无旧结果 → 显示搜索失败，而非「无匹配文件」', async () => {
        const list = makeList({ '.': [{ name: 'a.ts', type: 'file' }] })
        const searchFiles = vi.fn(async () => { throw new Error('rg died') })
        mockedUseMobiApi.mockReturnValue({ files: { list }, sessions: { searchFiles } } as any)

        renderWithClient(<FileTreeView sessionId="s1" onOpenFile={vi.fn()} />)
        await screen.findByText('a.ts')

        fireEvent.change(screen.getByRole('textbox'), { target: { value: 'foo' } })

        await waitFor(() => expect(screen.getByText('files.searchFailed')).toBeInTheDocument())
        expect(screen.queryByText('files.noResults')).not.toBeInTheDocument()
    })

    it('搜索成功但 0 匹配 → 仍显示「无匹配文件」（不误报失败）', async () => {
        const list = makeList({ '.': [{ name: 'a.ts', type: 'file' }] })
        const searchFiles = vi.fn(async () => ({ data: { success: true, entries: [] } }))
        mockedUseMobiApi.mockReturnValue({ files: { list }, sessions: { searchFiles } } as any)

        renderWithClient(<FileTreeView sessionId="s1" onOpenFile={vi.fn()} />)
        await screen.findByText('a.ts')

        fireEvent.change(screen.getByRole('textbox'), { target: { value: 'foo' } })

        await waitFor(() => expect(screen.getByText('files.noResults')).toBeInTheDocument())
        expect(screen.queryByText('files.searchFailed')).not.toBeInTheDocument()
    })

    it('搜索刷新失败但有旧结果 → 保留旧结果，只挂提示', async () => {
        const list = makeList({ '.': [{ name: 'a.ts', type: 'file' }] })
        let shouldFail = false
        const searchFiles = vi.fn(async () => {
            if (shouldFail) throw new Error('rg died')
            return { data: { success: true, entries: [{ name: 'foo.ts', type: 'file' as const, path: 'src/foo.ts' }] } }
        })
        mockedUseMobiApi.mockReturnValue({ files: { list }, sessions: { searchFiles } } as any)

        renderWithClient(<FileTreeView sessionId="s1" onOpenFile={vi.fn()} />)
        await screen.findByText('a.ts')

        fireEvent.change(screen.getByRole('textbox'), { target: { value: 'foo' } })
        await screen.findByText('foo.ts')

        shouldFail = true
        fireEvent.click(screen.getByRole('button', { name: 'files.refreshTree' }))

        await waitFor(() => expect(screen.getByText('files.searchFailedStale')).toBeInTheDocument())
        // 旧结果仍在，没退化成「无匹配文件」
        expect(screen.getByText('foo.ts')).toBeInTheDocument()
        expect(screen.queryByText('files.noResults')).not.toBeInTheDocument()
    })

    it('默认隐藏 . 开头文件；点切换按钮后显示', async () => {
        const list = makeList({
            '.': [
                { name: 'a.ts', type: 'file' },
                { name: '.cache', type: 'file' },
                { name: '.config', type: 'directory' },
            ],
        })
        mockedUseMobiApi.mockReturnValue({ files: { list } } as any)

        renderWithClient(<FileTreeView sessionId="s1" onOpenFile={vi.fn()} />)
        await screen.findByText('a.ts')
        expect(screen.queryByText('.cache')).toBeNull()
        expect(screen.queryByText('.config')).toBeNull()

        fireEvent.click(screen.getByRole('button', { name: 'files.showHidden' }))

        await waitFor(() => {
            expect(screen.getByText('.cache')).toBeInTheDocument()
            expect(screen.getByText('.config')).toBeInTheDocument()
        })
    })

    it('根目录截断(truncated) → 树末尾渲染提示节点', async () => {
        // 后端返回 truncated:true（条目超 MAX_TREE_ENTRIES），前端在根级末尾挂提示节点。
        // 不必真造 2000 条，直接 mock 截断标志即可锁定渲染行为。
        const list = vi.fn(async () => ({
            data: {
                success: true,
                entries: [{ name: 'a.ts', type: 'file' as const }],
                truncated: true,
                total: 5000,
            },
        }))
        mockedUseMobiApi.mockReturnValue({ files: { list } } as any)

        renderWithClient(<FileTreeView sessionId="s1" onOpenFile={vi.fn()} />)
        await screen.findByText('a.ts')
        // 提示节点出现（i18n fallback 返回 key 原文）
        expect(screen.getByText('files.treeTruncated')).toBeInTheDocument()
    })

    it('子目录截断 → 子项末尾渲染提示节点', async () => {
        const list = vi.fn(async (_s: string, p: string) => ({
            data: p === '.'
                ? { success: true, entries: [{ name: 'src', type: 'directory' as const }] }
                : {
                    success: true,
                    entries: [{ name: 'inner.ts', type: 'file' as const }],
                    truncated: true,
                    total: 3000,
                },
        }))
        mockedUseMobiApi.mockReturnValue({ files: { list } } as any)

        const { container } = renderWithClient(<FileTreeView sessionId="s1" onOpenFile={vi.fn()} />)
        await screen.findByText('src')
        fireEvent.click(container.querySelectorAll('.ant-tree-switcher')[0])
        await waitFor(() => expect(screen.getByText('inner.ts')).toBeInTheDocument())
        // 子目录 src 截断 → 其子项末尾挂提示节点
        expect(screen.getByText('files.treeTruncated')).toBeInTheDocument()
    })
})
