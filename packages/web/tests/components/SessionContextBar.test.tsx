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

import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { ConfigProvider } from 'antd'
import { SessionContextBar } from '@/components/session/SessionContextBar'
import type { SessionMetadataSummary } from '@/core/data/api/types'

// mock i18next
vi.mock('react-i18next', () => ({
    useTranslation: () => ({ t: (key: string) => key }),
}))

// mock useIsMobile
let mockIsMobile = false
vi.mock('@/core/data/hooks/useMediaQuery', () => ({
    useIsMobile: () => mockIsMobile,
}))

// jsdom 没有 ResizeObserver
beforeAll(() => {
    // @ts-expect-error jsdom 环境没有 ResizeObserver
    globalThis.ResizeObserver = class {
        observe() {}
        unobserve() {}
        disconnect() {}
    }
})

afterEach(() => {
    cleanup()
    vi.useRealTimers()
    mockIsMobile = false
})

const wrapper = ({ children }: { children: React.ReactNode }) => (
    <ConfigProvider>{children}</ConfigProvider>
)

describe('SessionContextBar', () => {
    it('metadata 为 null 时不渲染', () => {
        const { container } = render(
            <SessionContextBar metadata={null} />,
            { wrapper },
        )
        expect(container.firstChild).toBeNull()
    })

    it('无 gitBranch 且无 worktree 时仍然渲染并显示 workdir', () => {
        const metadata: SessionMetadataSummary = {
            path: '/home/user/project',
            host: 'localhost',
        }
        render(<SessionContextBar metadata={metadata} />, { wrapper })
        // 非 git 目录也展示工作目录
        expect(screen.getByText(/home\/user\/project/)).toBeInTheDocument()
    })

    it('有 gitBranch 时渲染信息条', () => {
        const metadata: SessionMetadataSummary = {
            path: '/home/user/project',
            host: 'localhost',
            gitBranch: 'feature/auth',
        }
        render(<SessionContextBar metadata={metadata} />, { wrapper })
        expect(screen.getByText('feature/auth')).toBeInTheDocument()
    })

    it('有 worktree 时渲染 worktree 标签', () => {
        const metadata: SessionMetadataSummary = {
            path: '/home/user/project',
            host: 'localhost',
            gitBranch: 'main',
            worktree: {
                basePath: '/home/user/main-repo',
                branch: 'feature/auth',
                name: 'auth-worktree',
            },
        }
        render(<SessionContextBar metadata={metadata} />, { wrapper })
        expect(screen.getByText('main')).toBeInTheDocument()
        expect(screen.getByText('auth-worktree')).toBeInTheDocument()
    })

    it('初始态展开，显示 work dir 路径', () => {
        const metadata: SessionMetadataSummary = {
            path: '/home/user/project',
            host: 'localhost',
            gitBranch: 'main',
        }
        render(<SessionContextBar metadata={metadata} />, { wrapper })
        expect(screen.getByText(/home\/user\/project/)).toBeInTheDocument()
    })

    it('桌面端 hover 时展开/收起', () => {
        const metadata: SessionMetadataSummary = {
            path: '/home/user/project',
            host: 'localhost',
            gitBranch: 'main',
        }
        mockIsMobile = false

        vi.useFakeTimers()
        render(<SessionContextBar metadata={metadata} />, { wrapper })

        // 初始展开
        expect(screen.getByText(/home\/user\/project/)).toBeInTheDocument()

        // 3 秒后收起
        vi.advanceTimersByTime(3000)

        // hover 恢复展开
        const bar = screen.getByRole('button', { name: /session-context/i })
        fireEvent.mouseEnter(bar)
        expect(screen.getByText(/home\/user\/project/)).toBeInTheDocument()

        // 移出鼠标
        fireEvent.mouseLeave(bar)
    })

    it('移动端 tap 切换展开/收起', () => {
        const metadata: SessionMetadataSummary = {
            path: '/home/user/project',
            host: 'localhost',
            gitBranch: 'main',
        }
        mockIsMobile = true

        vi.useFakeTimers()
        render(<SessionContextBar metadata={metadata} />, { wrapper })

        // 3 秒后收起
        vi.advanceTimersByTime(3000)

        const bar = screen.getByRole('button', { name: /session-context/i })

        // tap 展开
        fireEvent.click(bar)
        expect(screen.getByText(/home\/user\/project/)).toBeInTheDocument()

        // 再 tap 收起
        fireEvent.click(bar)
    })
})
