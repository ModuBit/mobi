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

import { describe, it, expect, vi, beforeEach, beforeAll, afterEach } from 'vitest'
import { render, screen, cleanup, act } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { ConfigProvider } from 'antd'
import type { ReactNode } from 'react'
import { SessionList } from '@/components/session/SessionList'
import { useNotificationBadgeStore } from '@/core/data/stores/notificationBadgeStore'
import type { Session, SessionGroup } from '@/core/data/api/types'

// —— mock i18next ——
vi.mock('react-i18next', () => ({
    useTranslation: () => ({ t: (key: string) => key }),
}))

// —— mock Router（SessionList 调用 useNavigate）——
vi.mock('@tanstack/react-router', () => ({
    useNavigate: () => () => {},
}))

// —— mock @tanstack/react-query：只 stub 出 SessionList 用到的 API ——
vi.mock('@tanstack/react-query', () => ({
    useQueryClient: () => ({
        setQueryData: () => {},
        invalidateQueries: async () => {},
        removeQueries: () => {},
    }),
    useQueries: () => {
        // 返回一个分组查询结果：groupKey=active，含 s1/s2/s3
        return [{
            data: { sessionIds: ['s1', 's2', 's3'], groupKey: 'active' },
        }]
    },
}))

// —— mock useSessionGroups：返回单个分组 ——
vi.mock('@/core/data/hooks/queries/useSessionGroups', () => ({
    useSessionGroups: () => ({
        data: [{ key: 'active', name: '活跃', activeCount: 3 } as SessionGroup],
        isLoading: false,
    }),
}))

// —— mock useSessions：返回三段会话 ——
function mockSession(id: string): Session {
    return {
        id,
        namespace: 'ns1',
        seq: 0,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        active: true,
        activeAt: Date.now(),
        metadata: null,
        metadataVersion: 0,
        agentState: null,
        agentStateVersion: 0,
        running: false,
        runningAt: Date.now(),
    } as unknown as Session
}

vi.mock('@/core/data/hooks/queries/useSessions', () => ({
    useSessions: () => ({
        data: [mockSession('s1'), mockSession('s2'), mockSession('s3')],
    }),
}))

// —— mock useIsMobile：默认 PC（false）；测试中通过 setMobile 覆盖 ——
let mobileFlag = false
const setMobile = (v: boolean) => { mobileFlag = v }
vi.mock('@/core/data/hooks/useMediaQuery', () => ({
    useIsMobile: () => mobileFlag,
    useMediaQuery: () => false,
    useIsDesktop: () => !mobileFlag,
    useHasFinePointer: () => true,
}))

// —— mock 其余无关 store/api/hook ——
vi.mock('@/core/data/stores/authStore', () => ({
    useAuthStore: () => ({ token: 'test-token' }),
}))
// uiStore 真实模块会触发 i18n 初始化链路，这里 stub 出 SessionList 用到的字段
vi.mock('@/core/data/stores/uiStore', () => ({
    useUiStore: () => ({
        setSessionListDrawerOpen: () => {},
        startRename: () => {},
        renamingSessionId: null,
        renameValue: '',
        setRenameValue: () => {},
        cancelRename: () => {},
    }),
}))
vi.mock('@/core/data/api/client', () => ({
    useMobiApi: () => ({
        sessionGroups: { getSessions: async () => ({ data: { sessions: [] } }) },
        sessions: {
            archive: async () => {}, delete: async () => {}, resume: async () => ({ data: { sessionId: '' } }),
        },
    }),
}))
vi.mock('@/core/data/hooks/mutations/useSessionActions', () => ({
    useSessionActions: () => ({
        renameSession: async () => {},
        isPending: false,
    }),
}))

// jsdom 无 ResizeObserver（Conversations 依赖）
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
})

const wrapper = ({ children }: { children: ReactNode }) => (
    <ConfigProvider>{children}</ConfigProvider>
)

describe('SessionList 未读角标', () => {
    beforeEach(() => {
        useNotificationBadgeStore.getState().clearAll()
        setMobile(false)
    })

    it('session 列表项渲染 StatusDot 而非 PixelAvatar', () => {
        const { container } = render(<SessionList />, { wrapper })
        expect(container.querySelector('[data-testid="pixel-avatar"]')).toBeNull()
        // StatusStateIcon 渲染带 background 色的 span
        const dots = container.querySelectorAll('span[style*="background"]')
        expect(dots.length).toBeGreaterThan(0)
    })

    it('无未读时不渲染任何 session 的角标', () => {
        render(<SessionList />, { wrapper })
        // 三个 session 都没有角标
        expect(screen.queryByTestId('session-id-badge-s1')).toBeNull()
        expect(screen.queryByTestId('session-id-badge-s2')).toBeNull()
        expect(screen.queryByTestId('session-id-badge-s3')).toBeNull()
    })

    it('某 session markUnread 后渲染该 session 的角标', () => {
        // 仅 s1 有未读
        useNotificationBadgeStore.getState().markUnread('s1', 'ready')

        render(<SessionList />, { wrapper })

        // s1 恰好有一个角标（用单数断言严格性）
        expect(screen.getByTestId('session-id-badge-s1')).toBeInTheDocument()
        // s2/s3 无角标
        expect(screen.queryByTestId('session-id-badge-s2')).toBeNull()
        expect(screen.queryByTestId('session-id-badge-s3')).toBeNull()
    })

    it('clearBadge 后角标消失（响应式更新）', () => {
        useNotificationBadgeStore.getState().markUnread('s2', 'permission')

        const { rerender } = render(<SessionList />, { wrapper })
        expect(screen.getByTestId('session-id-badge-s2')).toBeInTheDocument()

        // 清零 s2 角标 —— 应触发组件重渲染、items 重算
        act(() => {
            useNotificationBadgeStore.getState().clearBadge('s2')
        })
        rerender(<SessionList />)

        expect(screen.queryByTestId('session-id-badge-s2')).toBeNull()
    })

    it('permission 与 ready 任一为 true 都显示角标', () => {
        useNotificationBadgeStore.getState().markUnread('s3', 'permission')
        render(<SessionList />, { wrapper })
        expect(screen.getByTestId('session-id-badge-s3')).toBeInTheDocument()
    })

    it('移动端形态也显示角标', () => {
        setMobile(true)
        useNotificationBadgeStore.getState().markUnread('s1', 'ready')

        render(<SessionList />, { wrapper })

        expect(screen.getByTestId('session-id-badge-s1')).toBeInTheDocument()
    })
})
