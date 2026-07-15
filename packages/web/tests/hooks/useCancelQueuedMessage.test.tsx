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
 * 验证乐观删除、onSuccess 分支 invalidate、onError invalidate
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act, waitFor, cleanup } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { InfiniteData } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { queryKeys } from '@/core/lib/query-keys'
import type { DecryptedMessage, MessagesResponse } from '@/core/data/api/types'

// 隔离 api.messages.cancel
const mocks = vi.hoisted(() => ({
    cancel: vi.fn(),
}))
vi.mock('@/core/data/api/client', () => ({
    useMobiApi: () => ({ messages: { cancel: mocks.cancel } }),
}))

import { useCancelQueuedMessage } from '@/core/data/hooks/mutations/useCancelQueuedMessage'

const SESSION_ID = 's1'

/** QueryClientProvider wrapper */
function makeWrapper(qc: QueryClient) {
    return function Wrapper({ children }: { children: ReactNode }) {
        return <QueryClientProvider client={qc}>{children}</QueryClientProvider>
    }
}

/** 构建初始 InfiniteData 缓存 */
function seedData(messages: DecryptedMessage[]): InfiniteData<MessagesResponse> {
    return {
        pages: [{
            messages,
            page: { limit: 50, beforeSeq: null, nextBeforeSeq: null, hasMore: false },
        }],
        pageParams: [null],
    }
}

/** 读取缓存中 pages[0] 的消息列表 */
function readCacheMessages(qc: QueryClient): DecryptedMessage[] {
    const data = qc.getQueryData<InfiniteData<MessagesResponse>>(queryKeys.messages(SESSION_ID))
    return data?.pages[0]?.messages ?? []
}

/** 构建排队消息 */
function queuedMsg(id: string, createdAt = 1000): DecryptedMessage {
    return {
        id,
        seq: null,
        localId: id,
        submittedAt: null,
        createdAt,
        content: { role: 'user', content: { type: 'text', text: `msg-${id}` } },
        status: 'queued',
    }
}

describe('useCancelQueuedMessage', () => {
    let qc: QueryClient

    beforeEach(() => {
        qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
        mocks.cancel.mockReset()
    })

    afterEach(() => cleanup())

    it('onMutate 乐观删除目标 localId 消息', async () => {
        mocks.cancel.mockResolvedValue({ data: { status: 'cancelled' } })
        qc.setQueryData(
            queryKeys.messages(SESSION_ID),
            seedData([queuedMsg('local-1'), queuedMsg('local-2')]),
        )

        const { result } = renderHook(() => useCancelQueuedMessage(SESSION_ID), {
            wrapper: makeWrapper(qc),
        })

        await act(async () => {
            result.current.mutate('local-1')
        })
        await waitFor(() => expect(mocks.cancel).toHaveBeenCalledTimes(1))

        const msgs = readCacheMessages(qc)
        expect(msgs).toHaveLength(1)
        expect(msgs[0].localId).toBe('local-2')
    })

    it('onSuccess status=submitted 时 invalidate（CLI 抢先消费，需重拉）', async () => {
        mocks.cancel.mockResolvedValue({ data: { status: 'submitted' } })
        qc.setQueryData(queryKeys.messages(SESSION_ID), seedData([queuedMsg('local-1')]))
        const spy = vi.spyOn(qc, 'invalidateQueries')

        const { result } = renderHook(() => useCancelQueuedMessage(SESSION_ID), {
            wrapper: makeWrapper(qc),
        })

        await act(async () => {
            result.current.mutate('local-1')
        })
        await waitFor(() => expect(result.current.isSuccess).toBe(true))

        expect(spy).toHaveBeenCalledWith({ queryKey: queryKeys.messages(SESSION_ID) })
    })

    it('onSuccess status=cancelled 时不 invalidate（乐观删除即终态）', async () => {
        mocks.cancel.mockResolvedValue({ data: { status: 'cancelled' } })
        qc.setQueryData(queryKeys.messages(SESSION_ID), seedData([queuedMsg('local-1')]))
        const spy = vi.spyOn(qc, 'invalidateQueries')

        const { result } = renderHook(() => useCancelQueuedMessage(SESSION_ID), {
            wrapper: makeWrapper(qc),
        })

        await act(async () => {
            result.current.mutate('local-1')
        })
        // 确认 mutation 已完成（onSuccess 已执行）
        await waitFor(() => expect(result.current.isSuccess).toBe(true))

        expect(spy).not.toHaveBeenCalled()
    })

    it('onError 时总是 invalidate（恢复被乐观删除的消息）', async () => {
        mocks.cancel.mockRejectedValue(new Error('server error'))
        qc.setQueryData(queryKeys.messages(SESSION_ID), seedData([queuedMsg('local-1')]))
        const spy = vi.spyOn(qc, 'invalidateQueries')

        const { result } = renderHook(() => useCancelQueuedMessage(SESSION_ID), {
            wrapper: makeWrapper(qc),
        })

        await act(async () => {
            result.current.mutate('local-1')
        })
        await waitFor(() => expect(result.current.isError).toBe(true))

        expect(spy).toHaveBeenCalledWith({ queryKey: queryKeys.messages(SESSION_ID) })
    })
})
