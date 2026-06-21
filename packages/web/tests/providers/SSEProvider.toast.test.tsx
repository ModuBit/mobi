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
// antd notification.info spy:捕获 page-toast 调用与 key
const notifyInfoSpy = vi.hoisted(() => vi.fn())
// showSystemNotification spy(后台分支,默认成功显示)
const showSysSpy = vi.hoisted(() => vi.fn().mockResolvedValue(true))
// 可变认证态(测 logout 场景时改为 false)
const authState = vi.hoisted(() => ({ authenticated: true as boolean }))
// Gate.resetPermissionPrompt spy(验证换号重置引导 flag)
const gateResetSpy = vi.hoisted(() => vi.fn())

vi.mock('@/core/data/realtime/sseClient', () => ({
    // 普通函数(可作构造函数 new):this 绑定实例方法
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
vi.mock('@/core/notifications', async (orig) => {
    const actual = await orig()
    return { ...actual, showSystemNotification: showSysSpy }
})
vi.mock('@/core/data/stores/authStore', () => ({
    useAuthStore: () => ({ authenticated: authState.authenticated, logout: vi.fn() }),
}))
vi.mock('@tanstack/react-router', () => ({
    useNavigate: () => vi.fn(),
}))
vi.mock('@/core/data/hooks/useNotify', () => ({
    useNotify: () => ({ warning: vi.fn(), success: vi.fn(), info: vi.fn(), error: vi.fn(), destroy: vi.fn() }),
}))
vi.mock('@/core/data/api/client', () => ({
    useMobiApi: () => ({ visibility: { report: vi.fn().mockResolvedValue(undefined) } }),
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
                notification: { info: notifyInfoSpy, destroy: vi.fn() },
                message: { error: vi.fn() },
            }),
        },
    }
})

import { useNotificationStore } from '@/core/data/stores/notificationStore'

async function renderProvider() {
    const { SSEProvider } = await import('@/core/providers/SSEProvider')
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const makeTree = () => (
        <QueryClientProvider client={qc}>
            <ConfigProvider>
                <AntdApp>
                    <SSEProvider><div /></SSEProvider>
                </AntdApp>
            </ConfigProvider>
        </QueryClientProvider>
    )
    return { ...render(makeTree()), makeTree, queryClient: qc }
}

/** 构造 toast 事件 */
function toast(data: Record<string, unknown>) {
    return { type: 'toast', data }
}

describe('SSEProvider toast 分支(渲染集成)', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        sseListener.current = null
        authState.authenticated = true
        Object.defineProperty(document, 'hidden', { value: false, configurable: true })
    })
    afterEach(() => cleanup())

    it('连发两条同类 toast,各自独立 key 不互相吞(防 SW replace / antd 同 key 更新)', async () => {
        await renderProvider()
        expect(sseListener.current).toBeTruthy()

        // 前台 + 非该 session → page-toast 分支(走 antd notification.info)
        sseListener.current!(toast({ kind: 'permission', sessionId: 's1', title: 't1', body: 'b1', url: '/sessions/s1' }))
        sseListener.current!(toast({ kind: 'permission', sessionId: 's1', title: 't2', body: 'b2', url: '/sessions/s1' }))

        expect(notifyInfoSpy).toHaveBeenCalledTimes(2)
        const key1 = notifyInfoSpy.mock.calls[0][0].key
        const key2 = notifyInfoSpy.mock.calls[1][0].key
        expect(key1).not.toBe(key2)
    })

    it('reconnected 时 sessions + messages 失效并入 16ms 批处理(非立即触发)', async () => {
        vi.useFakeTimers()
        const result = await renderProvider()
        const invalidateSpy = vi.spyOn(result.queryClient, 'invalidateQueries')
        expect(sseListener.current).toBeTruthy()

        // 触发重连事件
        sseListener.current!({ type: 'connection-changed', connected: true, reconnected: true })
        // 批处理等待 16ms:立即检查未失效(绕过批处理则会立即调用)
        expect(invalidateSpy).not.toHaveBeenCalled()
        // 推进 16ms → 批处理触发:sessions 系列 + messages 全量失效
        await vi.advanceTimersByTimeAsync(16)
        expect(invalidateSpy).toHaveBeenCalled()
        // 验证 sessions 与 messages 两个 scope 都进批处理(漏删 scheduleInvalidation('messages') 会被此断言抓)
        const invalidatedKeys = invalidateSpy.mock.calls.map(c => (c[0] as { queryKey?: unknown }).queryKey)
        expect(invalidatedKeys.some(k => Array.isArray(k) && k[0] === 'sessions')).toBe(true)
        expect(invalidatedKeys.some(k => Array.isArray(k) && k[0] === 'messages')).toBe(true)

        vi.useRealTimers()
    })
})

describe('SSEProvider 换号重置(logout)', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        authState.authenticated = true
    })
    afterEach(() => cleanup())

    it('authenticated 变 false(logout)时重置通知 store + 引导 flag', async () => {
        const resetSpy = vi.spyOn(useNotificationStore.getState(), 'reset')
        const result = await renderProvider()
        // authenticated=true 时 logout effect 不触发重置
        expect(resetSpy).not.toHaveBeenCalled()

        // 模拟 logout:authenticated 变 false,rerender 新 element 触发 SSEProvider re-render → [authenticated] effect 重跑
        authState.authenticated = false
        result.rerender(result.makeTree())

        expect(resetSpy).toHaveBeenCalled()
        expect(gateResetSpy).toHaveBeenCalled()
        resetSpy.mockRestore()
    })
})
