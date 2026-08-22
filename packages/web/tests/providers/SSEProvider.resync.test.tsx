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
import '@testing-library/jest-dom/vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ConfigProvider, App as AntdApp } from 'antd'

// 捕获 SSEClient.subscribe 注册的事件回调,测试可手动派发 SSE 事件
const sseListener = vi.hoisted(() => ({ current: null as ((e: any) => void) | null }))
// SSEClient 实例方法 spy:验证回前台 reconnectIfStale 调用
const reconnectIfStaleSpy = vi.hoisted(() => vi.fn(() => false))
// fetchLatestMessages 内部会调 api.messages.list
const messagesListSpy = vi.hoisted(() => vi.fn().mockResolvedValue({
    data: { messages: [], page: { hasMore: false } },
}))

vi.mock('@/core/data/realtime/sseClient', () => ({
    // 普通函数(可作构造函数 new):this 绑定实例方法
    SSEClient: vi.fn().mockImplementation(function (this: any) {
        this.subscribe = (cb: any) => {
            sseListener.current = cb
            return () => {}
        }
        this.connect = () => {}
        this.disconnect = () => {}
        this.reconnectIfStale = reconnectIfStaleSpy
    }),
}))
vi.mock('@/core/data/api/client', () => ({
    useMobiApi: () => ({
        visibility: { report: vi.fn().mockResolvedValue(undefined) },
        messages: { list: messagesListSpy },
    }),
}))
vi.mock('@/core/data/stores/authStore', () => ({
    useAuthStore: () => ({ authenticated: true, logout: vi.fn() }),
}))
vi.mock('@tanstack/react-router', () => ({
    useNavigate: () => vi.fn(),
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

async function renderProvider() {
    const { SSEProvider } = await import('@/core/providers/SSEProvider')
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const tree = (
        <QueryClientProvider client={qc}>
            <ConfigProvider>
                <AntdApp>
                    <SSEProvider><div /></SSEProvider>
                </AntdApp>
            </ConfigProvider>
        </QueryClientProvider>
    )
    return { ...render(tree), queryClient: qc }
}

function setHidden(hidden: boolean) {
    Object.defineProperty(document, 'hidden', { value: hidden, configurable: true })
}

function dispatchVisibilityChange() {
    document.dispatchEvent(new Event('visibilitychange'))
}

/** 收集 invalidateQueries 收到的 queryKey 列表 */
function invalidatedKeys(spy: ReturnType<typeof vi.spyOn>): unknown[] {
    return spy.mock.calls.map(c => (c[0] as { queryKey?: unknown }).queryKey)
}

describe('SSEProvider 断连后状态对账(渲染集成)', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        sseListener.current = null
        setHidden(false)
        window.history.pushState({}, '', '/')
    })
    afterEach(() => cleanup())

    it('reconnected → 失效 sessions 列表 + 当前会话详情(agentState/runtimeState 唯一来源)', async () => {
        vi.useFakeTimers()
        window.history.pushState({}, '', '/sessions/s1')
        const result = await renderProvider()
        const invalidateSpy = vi.spyOn(result.queryClient, 'invalidateQueries')

        sseListener.current!({ type: 'connection-changed', connected: true, reconnected: true })
        await vi.advanceTimersByTimeAsync(16)

        const keys = invalidatedKeys(invalidateSpy)
        // sessions 列表
        expect(keys.some(k => Array.isArray(k) && k[0] === 'sessions')).toBe(true)
        // 当前路由的 session 详情——修复前缺失,断连期间的 agentState/runtimeState 变更永久陈旧
        expect(keys).toContainEqual(['session', 's1'])

        vi.useRealTimers()
    })

    it('后台断线后回前台(无 reconnected 事件)→ 仍执行对账(列表 + 详情)', async () => {
        vi.useFakeTimers()
        window.history.pushState({}, '', '/sessions/s2')
        const result = await renderProvider()
        const invalidateSpy = vi.spyOn(result.queryClient, 'invalidateQueries')

        // 后台:断线事件
        setHidden(true)
        dispatchVisibilityChange()
        sseListener.current!({ type: 'connection-changed', connected: false })

        // 回前台:无任何 reconnected(重连已在后台完成或尚未发生)
        setHidden(false)
        dispatchVisibilityChange()
        await vi.advanceTimersByTimeAsync(16)

        const keys = invalidatedKeys(invalidateSpy)
        expect(keys.some(k => Array.isArray(k) && k[0] === 'sessions')).toBe(true)
        expect(keys).toContainEqual(['session', 's2'])

        vi.useRealTimers()
    })

    it('回前台 → reconnectIfStale 被调用(断线时 subscriptionId 已清空,不得早退跳过)', async () => {
        window.history.pushState({}, '', '/sessions/s3')
        await renderProvider()
        reconnectIfStaleSpy.mockClear()

        // 后台 → 前台一次往返
        setHidden(true)
        dispatchVisibilityChange()
        setHidden(false)
        dispatchVisibilityChange()

        expect(reconnectIfStaleSpy).toHaveBeenCalled()
    })

    it('无断线时回前台 → 不触发对账(避免桌面 alt-tab 请求风暴)', async () => {
        vi.useFakeTimers()
        const result = await renderProvider()
        const invalidateSpy = vi.spyOn(result.queryClient, 'invalidateQueries')

        setHidden(true)
        dispatchVisibilityChange()
        setHidden(false)
        dispatchVisibilityChange()
        await vi.advanceTimersByTimeAsync(16)

        expect(invalidateSpy).not.toHaveBeenCalled()

        vi.useRealTimers()
    })
})
