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
 * useCancelQueuedMessage 单元测试
 * 验证乐观删除、onSuccess 分支 fetchLatest、onError fetchLatest
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act, waitFor, cleanup } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import type { DecryptedMessage } from '@/core/data/api/types'

// fetchLatestMessages 走网络，测试用 spy 替换；removeOptimisticMessage 保留真实以验证 store 状态
const mocks = vi.hoisted(() => ({
    cancel: vi.fn(),
    fetchLatest: vi.fn(),
}))
vi.mock('@/core/data/api/client', () => ({
    useMobiApi: () => ({ messages: { cancel: mocks.cancel } }),
}))
vi.mock('@/core/data/stores/messageWindowStore', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@/core/data/stores/messageWindowStore')>()
    return {
        ...actual,
        fetchLatestMessages: mocks.fetchLatest,
    }
})

import { useCancelQueuedMessage } from '@/core/data/hooks/mutations/useCancelQueuedMessage'
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

/** 构建排队消息 */
function queuedMsg(id: string, createdAt = 1000): DecryptedMessage {
    return {
        id,
        seq: null,
        localId: id,
        lifecycleAt: null,
        lifecycle: 'queued',
        createdAt,
        content: { role: 'user', content: { type: 'text', text: `msg-${id}` } },
        status: 'queued',
    } as unknown as DecryptedMessage
}

describe('useCancelQueuedMessage', () => {
    let qc: QueryClient

    beforeEach(() => {
        qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
        _resetForTest()
        mocks.cancel.mockReset()
        mocks.fetchLatest.mockReset()
    })

    afterEach(() => cleanup())

    it('onMutate 乐观删除目标 localId 消息', async () => {
        mocks.cancel.mockResolvedValue({ data: { status: 'cancelled' } })
        appendOptimisticMessage(SESSION_ID, queuedMsg('local-1'))
        appendOptimisticMessage(SESSION_ID, queuedMsg('local-2'))

        const { result } = renderHook(() => useCancelQueuedMessage(SESSION_ID), {
            wrapper: makeWrapper(qc),
        })

        await act(async () => {
            result.current.mutate('local-1')
        })
        await waitFor(() => expect(mocks.cancel).toHaveBeenCalledTimes(1))

        const msgs = readStoreMessages()
        expect(msgs).toHaveLength(1)
        expect(msgs[0].localId).toBe('local-2')
    })

    it('onSuccess status=submitted 时调用 fetchLatestMessages（CLI 抢先消费，需重拉）', async () => {
        mocks.cancel.mockResolvedValue({ data: { status: 'submitted' } })
        appendOptimisticMessage(SESSION_ID, queuedMsg('local-1'))

        const { result } = renderHook(() => useCancelQueuedMessage(SESSION_ID), {
            wrapper: makeWrapper(qc),
        })

        await act(async () => {
            result.current.mutate('local-1')
        })
        await waitFor(() => expect(result.current.isSuccess).toBe(true))

        expect(mocks.fetchLatest).toHaveBeenCalledTimes(1)
        expect(mocks.fetchLatest.mock.calls[0][1]).toBe(SESSION_ID)
    })

    it('onSuccess status=cancelled 时不调用 fetchLatestMessages（乐观删除即终态）', async () => {
        mocks.cancel.mockResolvedValue({ data: { status: 'cancelled' } })
        appendOptimisticMessage(SESSION_ID, queuedMsg('local-1'))

        const { result } = renderHook(() => useCancelQueuedMessage(SESSION_ID), {
            wrapper: makeWrapper(qc),
        })

        await act(async () => {
            result.current.mutate('local-1')
        })
        // 确认 mutation 已完成（onSuccess 已执行）
        await waitFor(() => expect(result.current.isSuccess).toBe(true))

        expect(mocks.fetchLatest).not.toHaveBeenCalled()
    })

    it('onError 时调用 fetchLatestMessages（恢复被乐观删除的消息）', async () => {
        mocks.cancel.mockRejectedValue(new Error('server error'))
        appendOptimisticMessage(SESSION_ID, queuedMsg('local-1'))

        const { result } = renderHook(() => useCancelQueuedMessage(SESSION_ID), {
            wrapper: makeWrapper(qc),
        })

        await act(async () => {
            result.current.mutate('local-1')
        })
        await waitFor(() => expect(result.current.isError).toBe(true))

        expect(mocks.fetchLatest).toHaveBeenCalledTimes(1)
        expect(mocks.fetchLatest.mock.calls[0][1]).toBe(SESSION_ID)
    })
})
