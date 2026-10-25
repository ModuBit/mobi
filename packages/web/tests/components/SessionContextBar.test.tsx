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
import { render, screen, within, cleanup } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { ConfigProvider } from 'antd'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import type { WorktreeSummary } from '@mobi/shared'
import { SessionContextBar } from '@/pages/session/SessionContextBar'
import type { SessionMetadataSummary } from '@/core/data/api/types'

// 列表扫描结果按用例注入（真实 hook 会打网络；这里只验吊顶呈现与禁用语义）
const worktreeList = vi.hoisted(() => ({ data: undefined as WorktreeSummary[] | undefined }))
vi.mock('@/core/data/hooks/queries/useWorktrees', () => ({
    useWorktrees: () => ({ data: worktreeList.data })
}))

// mock i18next（SessionContextBar 内部 useTranslation，mock 后不影响断言）
vi.mock('react-i18next', () => ({
    initReactI18next: { type: '3rdParty', init: () => {} },
    useTranslation: () => ({ t: (key: string) => key }),
}))

// 合回 Modal 内的动作 hook 需要 QueryClient（即使弹层未打开也已挂载）
const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>
        <ConfigProvider>{children}</ConfigProvider>
    </QueryClientProvider>
)

// SessionContextBar 接口只有 { metadata }——goal 已移至 StatusBar 渲染（见 GoalBadge），
// 这里只验静态信息条：path / gitBranch / worktree。
describe('SessionContextBar 静态信息条', () => {
    afterEach(cleanup)

    it('metadata 为 null 时不渲染', () => {
        const { container } = render(
            <SessionContextBar metadata={null} />,
            { wrapper },
        )
        expect(container.firstChild).toBeNull()
    })

    it('渲染 path，静态条 role=status 无展开符号', () => {
        const metadata = {
            path: '/home/user/project',
            host: 'localhost',
        } as SessionMetadataSummary
        render(<SessionContextBar metadata={metadata} />, { wrapper })
        const bar = screen.getByTestId('session-context-bar')
        expect(bar).toHaveAttribute('role', 'status')
        // 静态条无展开 chevron
        expect(screen.queryByText('▾')).not.toBeInTheDocument()
        expect(screen.queryByText('▸')).not.toBeInTheDocument()
        expect(screen.getByText(/home\/user\/project/)).toBeInTheDocument()
    })

    it('有 gitBranch 时渲染分支信息', () => {
        const metadata = {
            path: '/home/user/project',
            host: 'localhost',
            gitBranch: 'feature/auth',
        } as SessionMetadataSummary
        render(<SessionContextBar metadata={metadata} />, { wrapper })
        expect(screen.getByText('feature/auth')).toBeInTheDocument()
        expect(screen.getByTestId('session-context-bar')).toHaveAttribute('role', 'status')
    })

    it('有 worktree 时渲染 worktree 信息', () => {
        const metadata = {
            path: '/home/user/project',
            host: 'localhost',
            gitBranch: 'main',
            worktree: {
                basePath: '/home/user/main-repo',
                branch: 'feature/auth',
                name: 'auth-worktree',
            },
        } as SessionMetadataSummary
        render(<SessionContextBar metadata={metadata} />, { wrapper })
        expect(screen.getByText('main')).toBeInTheDocument()
        expect(screen.getByText('auth-worktree')).toBeInTheDocument()
    })
})

const WORKTREE_META = {
    path: '/home/user/main-repo-worktrees/feat-a',
    host: 'localhost',
    gitBranch: 'mobi/feat-a',
    worktree: {
        basePath: '/home/user/main-repo',
        branch: 'mobi/feat-a',
        name: 'feat-a',
        worktreePath: '/home/user/main-repo-worktrees/feat-a'
    }
} as SessionMetadataSummary

const SUMMARY: WorktreeSummary = {
    name: 'feat-a',
    branch: 'mobi/feat-a',
    worktreePath: '/home/user/main-repo-worktrees/feat-a',
    repoRoot: '/home/user/main-repo',
    repoBranch: 'main',
    sessionId: 's1',
    state: 'dirty',
    dirtyFileCount: 2,
    sizeBytes: 100
}

/** 点开 worktree 徽标弹层 */
function openPopover() {
    screen.getByTestId('worktree-badge').click()
}

describe('SessionContextBar worktree 弹层与合回入口', () => {
    afterEach(() => {
        cleanup()
        worktreeList.data = undefined
    })

    it('点徽标展示工作树信息：分支/路径/脏文件数', async () => {
        worktreeList.data = [SUMMARY]
        render(<SessionContextBar metadata={WORKTREE_META} />, { wrapper })
        openPopover()

        expect(await screen.findByText('session.worktree.title')).toBeInTheDocument()
        // 面板锚点：路径在吊顶与面板各出现一次，按面板作用域断言
        const panel = document.querySelector('[data-mobi-popover]')!
        expect(within(panel as HTMLElement).getByText('/home/user/main-repo-worktrees/feat-a')).toBeInTheDocument()
        expect(within(panel as HTMLElement).getByText('settings.worktrees.dirtyFiles')).toBeInTheDocument()
        expect(within(panel as HTMLElement).getByText('settings.worktrees.state.dirty')).toBeInTheDocument()
        expect(within(panel as HTMLElement).getByText('session.worktree.mergeBack').closest('button')).toBeEnabled()
    })

    it('运行中：合回禁用并给运行提示', async () => {
        worktreeList.data = [{ ...SUMMARY, state: 'running' }]
        render(<SessionContextBar metadata={WORKTREE_META} />, { wrapper })
        openPopover()

        expect(await screen.findByText('session.worktree.runningHint')).toBeInTheDocument()
        expect(screen.getByText('session.worktree.mergeBack').closest('button')).toBeDisabled()
    })

    it('列表未命中（如扫描失败/会话已迁移）：提示不可用并禁用合回', async () => {
        worktreeList.data = []
        render(<SessionContextBar metadata={WORKTREE_META} />, { wrapper })
        openPopover()

        expect(await screen.findByText('session.worktree.unavailableHint')).toBeInTheDocument()
        expect(screen.getByText('session.worktree.mergeBack').closest('button')).toBeDisabled()
    })
})
