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
import { render, screen, cleanup } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { ConfigProvider } from 'antd'
import type { ReactNode } from 'react'
import { SessionContextBar } from '@/components/session/SessionContextBar'
import type { SessionMetadataSummary } from '@/core/data/api/types'

// mock i18next（SessionContextBar 内部 useTranslation，mock 后不影响断言）
vi.mock('react-i18next', () => ({
    initReactI18next: { type: '3rdParty', init: () => {} },
    useTranslation: () => ({ t: (key: string) => key }),
}))

const wrapper = ({ children }: { children: ReactNode }) => (
    <ConfigProvider>{children}</ConfigProvider>
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
