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

/**
 * useSendMessage 单元测试
 * 验证乐观更新注入 store、localId 共享、失败时 fetchLatestMessages
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act, waitFor, cleanup } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import type { DecryptedMessage } from '@/core/data/api/types'

// fetchLatestMessages 走网络，测试用 spy 替换；appendOptimisticMessage 保留真实以验证 store 状态
const mocks = vi.hoisted(() => ({
    send: vi.fn(),
    fetchLatest: vi.fn(),
}))
vi.mock('@/core/data/api/client', () => ({
    useMobiApi: () => ({ messages: { send: mocks.send } }),
}))
vi.mock('@/core/data/stores/messageWindowStore', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@/core/data/stores/messageWindowStore')>()
    return {
        ...actual,
        fetchLatestMessages: mocks.fetchLatest,
    }
})

import { useSendMessage } from '@/core/data/hooks/mutations/useSendMessage'
import {
    appendOptimisticMessage,
    getMessageWindowState,
    _resetForTest,
} from '@/core/data/stores/messageWindowStore'

const SESSION_ID = 's1'

/** QueryClientProvider wrapper（useMutation 需要 QueryClient 上下文） */
function makeWrapper(qc: QueryClient) {
    return function Wrapper({ children }: { children: ReactNode }) {
        return <QueryClientProvider client={qc}>{children}</QueryClientProvider>
    }
}

/** 读取 store 中的消息列表 */
function readStoreMessages(): DecryptedMessage[] {
    return getMessageWindowState(SESSION_ID).messages
}

describe('useSendMessage', () => {
    let qc: QueryClient

    beforeEach(() => {
        qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
        _resetForTest()
        mocks.send.mockReset()
        mocks.fetchLatest.mockReset()
        // 抑制 hook 内 DEV console.log / onError console.error
        vi.spyOn(console, 'log').mockImplementation(() => {})
        vi.spyOn(console, 'error').mockImplementation(() => {})
    })

    afterEach(() => {
        vi.restoreAllMocks()
        cleanup()
    })

    it('isRunning=false 时 onMutate 注入乐观消息 status=sending', async () => {
        mocks.send.mockResolvedValue({ data: {} })

        const { result } = renderHook(() => useSendMessage(SESSION_ID, false), {
            wrapper: makeWrapper(qc),
        })

        await act(async () => {
            result.current.mutate('hello')
        })
        await waitFor(() => expect(mocks.send).toHaveBeenCalledTimes(1))

        const msgs = readStoreMessages()
        expect(msgs).toHaveLength(1)
        const optimistic = msgs[0]
        expect(optimistic.status).toBe('sending')
        // 非排队轨道（lifecycle=null）时 lifecycleAt 恒 null——shared 契约不变量，
        // 携带伪时间戳会让后续按 lifecycleAt 判时间序的消费点读到与 positionAt 不一致的值
        expect(optimistic.lifecycleAt).toBeNull()
        // 非 running 发送 → 不进排队轨道
        expect(optimistic.lifecycle).toBeNull()
        // 乐观消息 id === localId
        expect(optimistic.id).toBe(optimistic.localId)
        // content 信封正确
        const content = optimistic.content as {
            role: string
            content: { type: string; text: string }
            meta: { sentFrom: string }
        }
        expect(content.role).toBe('user')
        expect(content.content.type).toBe('text')
        expect(content.content.text).toBe('hello')
        expect(content.meta.sentFrom).toBe('webapp')
    })

    it('isRunning=true 时乐观消息 status=queued', async () => {
        mocks.send.mockResolvedValue({ data: {} })

        const { result } = renderHook(() => useSendMessage(SESSION_ID, true), {
            wrapper: makeWrapper(qc),
        })

        await act(async () => {
            result.current.mutate('排队中')
        })
        await waitFor(() => expect(mocks.send).toHaveBeenCalledTimes(1))

        const msgs = readStoreMessages()
        expect(msgs[0].status).toBe('queued')
        // running 中发送 → 进排队轨道（lifecycle='queued'），lifecycleAt = created_at（hub 契约不变量）
        expect(msgs[0].lifecycle).toBe('queued')
        expect(msgs[0].lifecycleAt).toBe(msgs[0].createdAt)
    })

    it('mutate(text) 生成的 localId 被 onMutate 与 mutationFn 共享', async () => {
        mocks.send.mockResolvedValue({ data: {} })

        const { result } = renderHook(() => useSendMessage(SESSION_ID, false), {
            wrapper: makeWrapper(qc),
        })

        await act(async () => {
            result.current.mutate('shared-id')
        })
        await waitFor(() => expect(mocks.send).toHaveBeenCalledTimes(1))

        // mutationFn 收到的 localId（第三参数）
        const sentLocalId = mocks.send.mock.calls[0][2]
        expect(sentLocalId).toBeTruthy()
        expect(typeof sentLocalId).toBe('string')

        // store 中乐观消息的 id / localId 与之一致
        const msgs = readStoreMessages()
        const optimistic = msgs[0]
        expect(optimistic.localId).toBe(sentLocalId)
        expect(optimistic.id).toBe(sentLocalId)
    })

    it('乐观消息追加到 store 末尾，保留已有消息', async () => {
        mocks.send.mockResolvedValue({ data: {} })
        const existing: DecryptedMessage = {
            id: 'msg-existing',
            seq: 1,
            localId: null,
            createdAt: 1000,
            content: { role: 'user', content: 'old' },
        } as unknown as DecryptedMessage
        appendOptimisticMessage(SESSION_ID, existing)

        const { result } = renderHook(() => useSendMessage(SESSION_ID, false), {
            wrapper: makeWrapper(qc),
        })

        await act(async () => {
            result.current.mutate('new one')
        })
        await waitFor(() => expect(mocks.send).toHaveBeenCalledTimes(1))

        const msgs = readStoreMessages()
        expect(msgs).toHaveLength(2)
        // 原有消息保持在前
        expect(msgs[0].id).toBe('msg-existing')
        // 乐观消息在末尾
        expect(msgs[1].id).toBe(msgs[1].localId)
    })

    it('onError 时调用 fetchLatestMessages(api, sessionId)', async () => {
        mocks.send.mockRejectedValue(new Error('network down'))

        const { result } = renderHook(() => useSendMessage(SESSION_ID, false), {
            wrapper: makeWrapper(qc),
        })

        await act(async () => {
            result.current.mutate('will-fail')
        })
        await waitFor(() => expect(result.current.isError).toBe(true))

        expect(mocks.fetchLatest).toHaveBeenCalledTimes(1)
        // 第二参数是 sessionId
        expect(mocks.fetchLatest.mock.calls[0][1]).toBe(SESSION_ID)
    })
})
