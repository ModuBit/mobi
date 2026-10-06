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
import { render, renderHook, waitFor, cleanup } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ConfigProvider, App as AntdApp } from 'antd'
import type { ReactNode } from 'react'

// ============ useMobiApi mock（必须返回稳定引用，否则 effect 无限循环 OOM——工作区已知坑） ============

const workspacesList = vi.hoisted(() => vi.fn())
const mockApi = {
    workspaces: { list: workspacesList },
    visibility: { report: vi.fn().mockResolvedValue(undefined) },
}
vi.mock('@/core/data/api/client', () => ({
    useMobiApi: () => mockApi,
}))

// ============ SSEProvider 依赖 mock（对照 SSEProvider.toast.test.tsx 现成模式） ============

// 捕获 SSEClient.subscribe 注册的事件回调，测试可手动派发 SSE 事件
type SseHandler = (e: Record<string, unknown>) => void
const sseListener = vi.hoisted(() => ({ current: null as SseHandler | null }))
const showSysSpy = vi.hoisted(() => vi.fn().mockResolvedValue(true))
const authState = vi.hoisted(() => ({ authenticated: true as boolean }))
const navigateSpy = vi.hoisted(() => vi.fn())
const gateResetSpy = vi.hoisted(() => vi.fn())

vi.mock('@/core/data/realtime/sseClient', () => ({
    SSEClient: vi.fn().mockImplementation(function (this: Record<string, unknown>) {
        this.subscribe = (cb: SseHandler) => {
            sseListener.current = cb
            return () => {}
        }
        this.connect = () => {}
        this.disconnect = () => {}
        this.reconnectIfStale = () => false
    }),
}))
vi.mock('@/core/notifications', async (orig) => {
    const actual = await orig()
    return { ...actual, showSystemNotification: showSysSpy }
})
vi.mock('@/core/data/stores/authStore', () => ({
    useAuthStore: () => ({ authenticated: authState.authenticated, logout: vi.fn() }),
}))
vi.mock('@tanstack/react-router', () => ({
    useNavigate: () => navigateSpy,
    useLocation: () => ({ pathname: '/' }),
}))
vi.mock('@/core/data/hooks/useNotify', () => ({
    useNotify: () => ({ warning: vi.fn(), success: vi.fn(), info: vi.fn(), error: vi.fn(), destroy: vi.fn() }),
}))
vi.mock('@/components/NotificationPermissionGate', () => ({
    NotificationPermissionGate: () => null,
    resetPermissionPrompt: gateResetSpy,
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

import { useWorkspaces } from '@/core/data/hooks/queries/useWorkspaces'
import type { Workspace } from '@mobi/shared'

function makeWorkspace(overrides: Partial<Workspace> = {}): Workspace {
    return {
        id: 'p1',
        namespace: 'ns',
        name: 'Demo',
        folders: [{ path: '/home/u/demo', primary: true }],
        createdAt: 1,
        updatedAt: 1,
        seq: 1,
        ...overrides,
    }
}

function makeQueryClient() {
    return new QueryClient({ defaultOptions: { queries: { retry: false } } })
}

function makeHookWrapper(qc: QueryClient) {
    return ({ children }: { children: ReactNode }) => (
        <QueryClientProvider client={qc}>{children}</QueryClientProvider>
    )
}

/** 渲染 SSEProvider（对照 SSEProvider.toast.test.tsx 的 renderProvider） */
async function renderProvider() {
    const { SSEProvider } = await import('@/core/providers/SSEProvider')
    const qc = makeQueryClient()
    render(
        <QueryClientProvider client={qc}>
            <ConfigProvider>
                <AntdApp>
                    <SSEProvider><div /></SSEProvider>
                </AntdApp>
            </ConfigProvider>
        </QueryClientProvider>
    )
    return { queryClient: qc }
}

// vitest 未开 globals：渲染型测试必须显式 cleanup，否则 DOM 累积致 getBy* 多元素报错——工作区已知坑
afterEach(() => cleanup())

describe('useWorkspaces', () => {
    beforeEach(() => {
        vi.clearAllMocks()
    })

    it('拉取工作区列表并写入 ["workspaces"] 缓存', async () => {
        const workspaces = [makeWorkspace(), makeWorkspace({ id: 'p2', name: 'Another' })]
        workspacesList.mockResolvedValue({ data: { workspaces } })

        const qc = makeQueryClient()
        const { result } = renderHook(() => useWorkspaces(), { wrapper: makeHookWrapper(qc) })

        await waitFor(() => expect(result.current.data).toEqual(workspaces))
        // 单一数据源：列表进 queryClient 缓存，供 useWorkspaceSessions 取 primary folder path
        expect(qc.getQueryData(['workspaces'])).toEqual(workspaces)
        expect(workspacesList).toHaveBeenCalledWith()
    })

})

describe('SSE workspace 事件失效', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        sseListener.current = null
        authState.authenticated = true
        Object.defineProperty(document, 'hidden', { value: false, configurable: true })
    })

    it('workspace-updated → invalidate ["workspaces"]', async () => {
        const { queryClient: qc } = await renderProvider()
        expect(sseListener.current).toBeTruthy()
        const invalidateSpy = vi.spyOn(qc, 'invalidateQueries')

        sseListener.current!({ type: 'workspace-updated', workspaceId: 'p1', namespace: 'ns' })

        await waitFor(() => {
            expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['workspaces'] })
        })
        // 工作区实体变更只动工作区列表，不牵连会话缓存
        const invalidatedKeys = invalidateSpy.mock.calls.map(c => (c[0] as { queryKey?: unknown }).queryKey)
        expect(invalidatedKeys.some(k => Array.isArray(k) && k[0] === 'sessions')).toBe(false)
        invalidateSpy.mockRestore()
    })

    it('workspace-added → invalidate ["workspaces"]', async () => {
        const { queryClient: qc } = await renderProvider()
        const invalidateSpy = vi.spyOn(qc, 'invalidateQueries')

        sseListener.current!({ type: 'workspace-added', workspaceId: 'p9', namespace: 'ns' })

        await waitFor(() => {
            expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['workspaces'] })
        })
        invalidateSpy.mockRestore()
    })

    it('workspace-removed → 折叠进 workspaceViews 批处理（workspaces/recentSessions/workspaceSessions）', async () => {
        const { queryClient: qc } = await renderProvider()
        const invalidateSpy = vi.spyOn(qc, 'invalidateQueries')

        sseListener.current!({ type: 'workspace-removed', workspaceId: 'p1', namespace: 'ns' })

        await waitFor(() => {
            expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['workspaces'] })
        })
        const invalidatedKeys = invalidateSpy.mock.calls.map(c => (c[0] as { queryKey?: unknown }).queryKey)
        // 名下会话解绑进「最近」→ 两个分组视图直接刷新；session 级缓存由 hub 逐会话发的
        // session-updated（patchSessionCache + workspaceViews 批处理）覆盖，不再在此直接失效
        expect(invalidatedKeys.some(k => Array.isArray(k) && k[0] === 'recentSessions')).toBe(true)
        expect(invalidatedKeys.some(k => Array.isArray(k) && k[0] === 'workspaceSessions')).toBe(true)
        expect(invalidatedKeys.some(k => Array.isArray(k) && k[0] === 'sessions')).toBe(false)
        invalidateSpy.mockRestore()
    })

    it('connection-changed reconnected → 补失效工作区视图（断连期间他端的成员/归属变更）', async () => {
        const { queryClient: qc } = await renderProvider()
        const invalidateSpy = vi.spyOn(qc, 'invalidateQueries')

        // 模拟移动端后台→前台：SSE 静默重连
        sseListener.current!({ type: 'connection-changed', connected: true, reconnected: true })

        await waitFor(() => {
            expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['sessions'] })
        })
        // 重连必须连带失效工作区维度视图，否则断连期间他端的工作区/归属变更不补拉
        const invalidatedKeys = invalidateSpy.mock.calls.map(c => (c[0] as { queryKey?: unknown }).queryKey)
        expect(invalidatedKeys.some(k => Array.isArray(k) && k[0] === 'workspaces')).toBe(true)
        expect(invalidatedKeys.some(k => Array.isArray(k) && k[0] === 'recentSessions')).toBe(true)
        expect(invalidatedKeys.some(k => Array.isArray(k) && k[0] === 'workspaceSessions')).toBe(true)
        invalidateSpy.mockRestore()
    })
})
