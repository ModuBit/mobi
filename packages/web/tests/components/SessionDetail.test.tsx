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

import { describe, it, expect, vi, beforeAll, afterEach, beforeEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { ConfigProvider } from 'antd'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { SessionDetail } from '@/components/session/SessionDetail'
import { useNotificationBadgeStore } from '@/core/data/stores/notificationBadgeStore'

// mock 路由
vi.mock('@tanstack/react-router', () => ({
    useNavigate: () => ({ to: () => {} }),
    useParams: () => ({}),
}))

// mock i18next（保留 initReactI18next 等真实导出，仅替换 useTranslation，
// 因为 uiStore 间接引入 i18n/index.ts 会调用 i18n.use(initReactI18next).init()）
vi.mock('react-i18next', async (importOriginal) => {
    const actual = await importOriginal<typeof import('react-i18next')>()
    return {
        ...actual,
        useTranslation: () => ({ t: (key: string) => key }),
    }
})

// mock 数据查询
vi.mock('@/core/data/hooks/queries/useSession', () => ({
    useSession: vi.fn(),
}))

// mock 子组件，只关心是否被渲染
vi.mock('@/components/chat/ChatContainer', () => ({
    ChatContainer: () => <div data-testid="chat-container" />,
}))
vi.mock('@/components/session/SessionContextBar', () => ({
    SessionContextBar: ({ metadata }: { metadata: unknown }) => (
        <div data-testid="session-context-bar">{metadata ? 'has-metadata' : 'no-metadata'}</div>
    ),
}))
// PixelAvatar 内部使用 canvas（jsdom 无 getContext），stub 掉避免崩溃
vi.mock('@/components/pixel-avatar/PixelAvatar', () => ({
    PixelAvatar: () => <div data-testid="pixel-avatar" />,
}))

import { useSession } from '@/core/data/hooks/queries/useSession'

const wrapper = ({ children }: { children: React.ReactNode }) => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    return (
        <QueryClientProvider client={queryClient}>
            <ConfigProvider>{children}</ConfigProvider>
        </QueryClientProvider>
    )
}

beforeAll(() => {
    // @ts-expect-error jsdom 无 ResizeObserver
    globalThis.ResizeObserver = class {
        observe() {}
        unobserve() {}
        disconnect() {}
    }
})

afterEach(() => {
    cleanup()
    vi.clearAllMocks()
})

describe('SessionDetail（特征化）', () => {
    beforeEach(() => {
        useNotificationBadgeStore.getState().clearAll()
    })

    it('loading 时渲染 Spin', () => {
        vi.mocked(useSession).mockReturnValue({ data: undefined, isLoading: true, error: null } as never)
        const { container } = render(<SessionDetail sessionId="s1" />, { wrapper })
        expect(container.querySelector('.ant-spin')).toBeInTheDocument()
    })

    it('error 时渲染错误态与返回首页按钮', () => {
        vi.mocked(useSession).mockReturnValue({ data: null, isLoading: false, error: new Error('x') } as never)
        render(<SessionDetail sessionId="s1" />, { wrapper })
        expect(screen.getByText('session.loadFailed')).toBeInTheDocument()
        expect(screen.getByText('common.backHome')).toBeInTheDocument()
    })

    it('加载完成后渲染 SessionContextBar 与聊天区', () => {
        vi.mocked(useSession).mockReturnValue({
            data: { id: 's1', metadata: { path: '/p' } },
            isLoading: false,
            error: null,
        } as never)
        render(<SessionDetail sessionId="s1" />, { wrapper })
        expect(screen.getByTestId('session-context-bar')).toBeInTheDocument()
        expect(screen.getByText('has-metadata')).toBeInTheDocument()
        expect(screen.getByTestId('chat-container')).toBeInTheDocument()
    })

    it('挂载时清零该 session 的未读角标', () => {
        useNotificationBadgeStore.getState().markUnread('s1', 'ready')
        vi.mocked(useSession).mockReturnValue({
            data: { id: 's1', metadata: null },
            isLoading: false,
            error: null,
        } as never)
        render(<SessionDetail sessionId="s1" />, { wrapper })
        expect(useNotificationBadgeStore.getState().hasUnread('s1')).toBe(false)
    })
})
