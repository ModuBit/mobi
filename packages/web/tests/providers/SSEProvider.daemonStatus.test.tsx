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

/** daemon/status 200 响应形状（daemon 侧 getDaemonStatus 投影，与 SSE payload 同形） */
const hostProjection = {
    status: 'ok',
    host: { hostname: 'mbp', platform: 'darwin', displayName: 'MacBook Pro', homeDir: '/Users/me' },
    executor: { status: 'running', pid: 4321, startedAt: 1 },
}

/** 缓存预置：与 useDaemonStatus queryFn 写入形状一致 */
function seedDaemonStatus(qc: QueryClient, data: unknown) {
    qc.setQueryData(['daemon-status'], data)
}

describe('SSEProvider daemon-status —— 单对象缓存 patch（渲染集成）', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        sseListener.current = null
    })
    afterEach(() => cleanup())

    it('事件负载 → 直写换代（payload 与 200 响应同形，无需字段级合并）', async () => {
        const { queryClient } = await renderProvider()
        seedDaemonStatus(queryClient, { ...hostProjection, executor: { status: 'running', pid: 1, startedAt: 0 } })

        sseListener.current!({ type: 'daemon-status', data: hostProjection })

        const cached = queryClient.getQueryData<any>(['daemon-status'])
        expect(cached.executor).toEqual(hostProjection.executor)
        expect(cached.host.hostname).toBe('mbp')
    })

    it('同值负载（executor 顶层字段浅比较等值）→ 跳过换代', async () => {
        const { queryClient } = await renderProvider()
        seedDaemonStatus(queryClient, hostProjection)
        const before = queryClient.getQueryData(['daemon-status'])

        // SSE 解析每帧新引用：executor / host 都是全新对象，但值相等
        sseListener.current!({
            type: 'daemon-status',
            data: {
                status: 'ok',
                host: { ...hostProjection.host },
                executor: { ...hostProjection.executor },
            },
        })

        expect(queryClient.getQueryData(['daemon-status'])).toBe(before)
    })

    it('executor 状态变化 → 换代（UI 依赖方重渲染）', async () => {
        const { queryClient } = await renderProvider()
        seedDaemonStatus(queryClient, hostProjection)

        sseListener.current!({
            type: 'daemon-status',
            data: {
                ...hostProjection,
                executor: { ...hostProjection.executor, status: 'shutting-down', shutdownRequestedAt: 9 },
            },
        })

        const cached = queryClient.getQueryData<any>(['daemon-status'])
        expect(cached.executor.status).toBe('shutting-down')
    })

    it('缓存不存在 → 不创建（宿主状态只由挂载 useDaemonStatus 的页面消费）', async () => {
        const { queryClient } = await renderProvider()

        sseListener.current!({ type: 'daemon-status', data: hostProjection })

        expect(queryClient.getQueryData(['daemon-status'])).toBeUndefined()
    })

    it('daemon-status 不触发 invalidateQueries（patch 替代 refetch）', async () => {
        const { queryClient } = await renderProvider()
        seedDaemonStatus(queryClient, hostProjection)
        const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries')

        sseListener.current!({ type: 'daemon-status', data: hostProjection })

        expect(invalidateSpy).not.toHaveBeenCalled()
    })
})

describe('SSEProvider 断连重连 —— daemon-status 对账（patch 模式的确定性补拉点）', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        sseListener.current = null
    })
    afterEach(() => cleanup())

    it('reconnected → 失效 daemon-status（断连窗口内 daemon-status 不会被重放）', async () => {
        vi.useFakeTimers()
        const { queryClient } = await renderProvider()
        const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries')

        sseListener.current!({ type: 'connection-changed', connected: true, reconnected: true })
        await vi.advanceTimersByTimeAsync(16)

        const keys = invalidateSpy.mock.calls.map(c => (c[0] as { queryKey?: unknown }).queryKey)
        expect(keys.some(k => Array.isArray(k) && k[0] === 'daemon-status')).toBe(true)

        vi.useRealTimers()
    })
})
