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
// navigate spy:验证 SW NAVIGATE 消息触发的 SPA 跳转
const navigateSpy = vi.hoisted(() => vi.fn())
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
    useNavigate: () => navigateSpy,
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
import { usePromptSuggestionStore } from '@/core/data/stores/promptSuggestionStore'

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

describe('SSEProvider 系统通知分层', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        sseListener.current = null
        authState.authenticated = true
        Object.defineProperty(document, 'hidden', { value: false, configurable: true })
    })
    afterEach(() => cleanup())

    it('后台 idle-timeout-warning → 额外发系统通知(带固定 tag 供 SW 去重 + 跳转 url)', async () => {
        await renderProvider()
        Object.defineProperty(document, 'hidden', { value: true, configurable: true })

        sseListener.current!({ type: 'idle-timeout-warning', sessionId: 's9', data: { remainingMs: 120000 } })

        expect(showSysSpy).toHaveBeenCalledWith(
            expect.objectContaining({
                tag: 'idle-timeout-s9',
                renotify: true,
                data: { url: '/sessions/s9' },
            }),
        )
    })

    it('前台 idle-timeout-warning → 不发系统通知(常驻页面 Toast 已可见)', async () => {
        await renderProvider()
        Object.defineProperty(document, 'hidden', { value: false, configurable: true })

        sseListener.current!({ type: 'idle-timeout-warning', sessionId: 's9', data: { remainingMs: 120000 } })

        expect(showSysSpy).not.toHaveBeenCalled()
    })

    it('断线(connection-changed connected=false)→ 不弹系统通知(自愈事件,仅页面 Toast)', async () => {
        await renderProvider()
        sseListener.current!({ type: 'connection-changed', connected: false })
        expect(showSysSpy).not.toHaveBeenCalled()
    })

    it('后台连发两条同类 toast → 系统通知用固定 tag + renotify(聚合替换,不堆积)', async () => {
        await renderProvider()
        Object.defineProperty(document, 'hidden', { value: true, configurable: true })

        sseListener.current!(toast({ kind: 'ready', sessionId: 's1', title: 't1', body: 'b1', url: '/sessions/s1' }))
        sseListener.current!(toast({ kind: 'ready', sessionId: 's1', title: 't2', body: 'b2', url: '/sessions/s1' }))

        // 两条都发(每条照发),但 tag 固定相同 → Chrome 替换旧通知,通知中心只留最新一条
        expect(showSysSpy).toHaveBeenCalledTimes(2)
        expect(showSysSpy).toHaveBeenNthCalledWith(1, expect.objectContaining({ tag: 'mobi-ready-s1', renotify: true }))
        expect(showSysSpy).toHaveBeenNthCalledWith(2, expect.objectContaining({ tag: 'mobi-ready-s1', renotify: true }))
    })
})

describe('SSEProvider 通知点击跳转(NAVIGATE)', () => {
    let swTarget: EventTarget
    beforeEach(() => {
        vi.clearAllMocks()
        navigateSpy.mockClear()
        sseListener.current = null
        authState.authenticated = true
        // jsdom 无 SW,stub 一个 EventTarget 模拟 navigator.serviceWorker
        swTarget = new EventTarget()
        Object.defineProperty(navigator, 'serviceWorker', { value: swTarget, configurable: true })
    })
    afterEach(() => cleanup())

    it('收到 SW NAVIGATE 消息 → 用 SPA 路由跳转到目标 url', async () => {
        await renderProvider()
        swTarget.dispatchEvent(new MessageEvent('message', { data: { type: 'NAVIGATE', url: '/sessions/abc' } }))
        expect(navigateSpy).toHaveBeenCalledWith({ to: '/sessions/abc' })
    })

    it('非 NAVIGATE 消息不触发跳转', async () => {
        await renderProvider()
        swTarget.dispatchEvent(new MessageEvent('message', { data: { type: 'OTHER', url: '/x' } }))
        expect(navigateSpy).not.toHaveBeenCalled()
    })

    it('未认证时不挂监听(NAVIGATE 无效)', async () => {
        authState.authenticated = false
        await renderProvider()
        swTarget.dispatchEvent(new MessageEvent('message', { data: { type: 'NAVIGATE', url: '/sessions/abc' } }))
        expect(navigateSpy).not.toHaveBeenCalled()
    })
})

describe('SSEProvider prompt_suggestion 拦截', () => {
    beforeEach(() => {
        usePromptSuggestionStore.setState({ bySession: new Map() })
        authState.authenticated = true
    })
    afterEach(() => cleanup())

    it('收到 prompt_suggestion 写入 store(瞬时建议, 不进消息缓存)', async () => {
        await renderProvider()
        expect(sseListener.current).toBeTruthy()

        const promptSuggestionContent = {
            role: 'agent',
            content: {
                type: 'output',
                data: { type: 'prompt_suggestion', suggestion: '用 virtuoso 重构', uuid: 'u1', session_id: 's1' },
            },
            meta: { sentFrom: 'cli' },
        }

        sseListener.current!({
            type: 'message-received',
            sessionId: 's1',
            message: {
                id: 'm1',
                seq: 1,
                localId: 'u1',
                createdAt: Date.now(),
                content: promptSuggestionContent,
            },
        })

        expect(usePromptSuggestionStore.getState().bySession.get('s1')).toBe('用 virtuoso 重构')
    })

    it('非 prompt_suggestion 消息不写入 store', async () => {
        await renderProvider()
        const normalContent = {
            role: 'agent',
            content: { type: 'output', data: { type: 'assistant', message: { role: 'assistant', content: [] } } },
            meta: { sentFrom: 'cli' },
        }

        sseListener.current!({
            type: 'message-received',
            sessionId: 's1',
            message: {
                id: 'm2',
                seq: 2,
                localId: 'u2',
                createdAt: Date.now(),
                content: normalContent,
            },
        })

        expect(usePromptSuggestionStore.getState().bySession.has('s1')).toBe(false)
    })
})
