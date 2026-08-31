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
// fetchLatestMessages 内部会调 api.messages.list——message-withdrawn 是否触发对账的观测点
const messagesListSpy = vi.hoisted(() => vi.fn().mockResolvedValue({
    data: { messages: [], page: { hasMore: false } },
}))

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

import {
    ingestIncomingMessages,
    appendOptimisticMessage,
    _resetForTest,
} from '@/core/data/stores/messageWindowStore'

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

/** 造一条已落窗口的消息（seq 行）+ 一条乐观行（localId 锚点） */
function seedWindow() {
    ingestIncomingMessages('s1', [{
        id: 'a', seq: 1, localId: null, lifecycleAt: null, lifecycle: null,
        positionAt: 1, createdAt: 1,
        content: { role: 'user', content: { type: 'text', text: 'a' } },
        snapshot: false,
    } as never])
    appendOptimisticMessage('s1', {
        id: 'opt', seq: null, localId: 'loc-opt', lifecycleAt: null, lifecycle: 'queued',
        positionAt: 2, createdAt: 2, status: 'queued',
        content: { role: 'user', content: { type: 'text', text: 'opt' } },
        snapshot: false,
    } as never)
}

describe('SSEProvider message-withdrawn —— refetch 对账按「是否实际移除」门控（渲染集成）', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        sseListener.current = null
        _resetForTest()
        window.history.pushState({}, '', '/')
    })
    afterEach(() => cleanup())

    it('目标在本地窗口（乐观移除已得一致状态）→ 不发起 refetch（恒 no-op 的整页拉取省掉）', async () => {
        seedWindow()
        await renderProvider()
        sseListener.current!({ type: 'message-withdrawn', sessionId: 's1', localId: 'loc-opt' })
        await vi.waitFor(() => {
            // requestWithdraw 落 store 的信箱已被消费前的窗口：无 refetch 即无 list 调用
            expect(messagesListSpy).not.toHaveBeenCalled()
        })
    })

    it('目标不在本地窗口（另一端撤回 / 窗口外历史行）→ refetch 兜底对账', async () => {
        seedWindow()
        await renderProvider()
        sseListener.current!({ type: 'message-withdrawn', sessionId: 's1', localId: 'absent' })
        await vi.waitFor(() => {
            expect(messagesListSpy).toHaveBeenCalled()
        })
    })
})
