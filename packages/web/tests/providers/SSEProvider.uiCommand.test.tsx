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

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, cleanup } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ConfigProvider, App as AntdApp } from 'antd'

// 捕获 SSEClient.subscribe 注册的事件回调，测试可手动派发 SSE 事件
const sseListener = vi.hoisted(() => ({ current: null as ((e: any) => void) | null }))

vi.mock('@/core/data/realtime/sseClient', () => ({
    SSEClient: vi.fn().mockImplementation(function (this: any) {
        this.subscribe = (cb: any) => {
            sseListener.current = cb
            return () => {}
        }
        this.connect = () => {}
        this.disconnect = () => {}
        this.reconnectIfStale = () => false
    }),
}))
vi.mock('@/core/data/api/client', () => ({
    useMobiApi: () => ({
        visibility: { report: vi.fn().mockResolvedValue(undefined) },
        messages: { list: vi.fn().mockResolvedValue({ data: { messages: [], page: { hasMore: false } } }) },
    }),
}))
vi.mock('@/core/data/stores/authStore', () => ({
    useAuthStore: () => ({ authenticated: true, logout: vi.fn() }),
}))
vi.mock('@tanstack/react-router', () => ({
    useNavigate: () => vi.fn(),
    useLocation: () => ({ pathname: '/' }),
}))
vi.mock('@/core/data/hooks/useNotify', () => ({
    useNotify: () => ({ warning: vi.fn(), success: vi.fn(), info: vi.fn(), error: vi.fn(), destroy: vi.fn() }),
}))
vi.mock('@/components/NotificationPermissionGate', () => ({
    NotificationPermissionGate: () => null,
    resetPermissionPrompt: vi.fn(),
}))
vi.mock('react-i18next', () => ({
    useTranslation: () => ({ t: (k: string) => k }),
}))
vi.mock('antd', async (orig) => {
    const actual = await orig()
    return {
        ...actual,
        App: {
            ...actual.App,
            useApp: () => ({
                notification: { info: vi.fn(), destroy: vi.fn() },
                message: { error: vi.fn() },
            }),
        },
    }
})

import { useWorkspaceStore } from '@/core/data/stores/workspaceStore'

async function renderProvider() {
    const { SSEProvider } = await import('@/core/providers/SSEProvider')
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(
        <QueryClientProvider client={qc}>
            <ConfigProvider>
                <AntdApp>
                    <SSEProvider><div /></SSEProvider>
                </AntdApp>
            </ConfigProvider>
        </QueryClientProvider>,
    )
}

describe('SSEProvider ui-command —— open_file 落 inspector 文件 tab（渲染集成）', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        sseListener.current = null
        useWorkspaceStore.getState().clearAll()
    })
    afterEach(() => cleanup())

    it('open_file 事件 → 发起会话的 inspector 打开文件 tab（fileName=path basename）', async () => {
        await renderProvider()
        sseListener.current!({
            type: 'ui-command',
            sessionId: 's1',
            action: { action: 'open_file', path: '/tmp/demo/deep/nested/a.ts' },
        })
        await vi.waitFor(() => {
            const inspector = useWorkspaceStore.getState().getSession('s1')
            expect(inspector.tabs).toHaveLength(1)
            expect(inspector.tabs[0].mode).toBe('file')
            expect(inspector.tabs[0].filePath).toBe('/tmp/demo/deep/nested/a.ts')
            expect(inspector.tabs[0].fileName).toBe('a.ts')
            expect(inspector.activeTabId).toBe(inspector.tabs[0].id)
        })
    })

    it('同 path 重复打开 → 去重切激活（不新建 tab）', async () => {
        await renderProvider()
        sseListener.current!({
            type: 'ui-command',
            sessionId: 's1',
            action: { action: 'open_file', path: '/tmp/demo/a.ts' },
        })
        sseListener.current!({
            type: 'ui-command',
            sessionId: 's1',
            action: { action: 'open_file', path: '/tmp/demo/a.ts' },
        })
        await vi.waitFor(() => {
            expect(useWorkspaceStore.getState().getSession('s1').tabs).toHaveLength(1)
        })
    })

    it('未知动作类型 → 不动 workspaceStore（为 A 类扩展留位的防御）', async () => {
        await renderProvider()
        sseListener.current!({
            type: 'ui-command',
            sessionId: 's1',
            action: { action: 'unknown-action' },
        } as never)
        await vi.waitFor(() => {
            expect(useWorkspaceStore.getState().getSession('s1').tabs).toHaveLength(0)
        })
    })
})
