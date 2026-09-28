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

import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
    fetchLatestMessages,
    clearMessageWindow,
    ingestIncomingMessages,
    _resetForTest,
} from '@/core/data/stores/messageWindowStore'
import type { DecryptedMessage } from '@/core/data/api/types'

// mockApi 必须稳定引用（见 useMessages.test.tsx 同款注释）
const { mockApi } = vi.hoisted(() => ({
    mockApi: {
        messages: { list: vi.fn().mockResolvedValue({ data: { messages: [], page: { hasMore: false } } }) },
    },
}))
vi.mock('@/core/data/api/client', () => ({ useMobiApi: () => mockApi }))

function msg(id: string, seq: number | null): DecryptedMessage {
    return {
        id,
        seq,
        localId: null,
        lifecycleAt: null,
        lifecycle: null,
        positionAt: seq ?? 0,
        createdAt: seq ?? 0,
        content: { role: 'user', content: { type: 'text', text: id } },
        snapshot: false,
    } as unknown as DecryptedMessage
}

describe('fetchLatestMessages 并发去重', () => {
    beforeEach(() => {
        _resetForTest()
        mockApi.messages.list.mockClear()
    })

    it('store 为空时 isLoading 锁挡住并发第二笔', async () => {
        let resolveFirst!: (v: { data: { messages: never[]; page: { hasMore: boolean } } }) => void
        mockApi.messages.list.mockImplementationOnce(() => new Promise(resolve => { resolveFirst = resolve }))
        const p1 = fetchLatestMessages(mockApi, 's1')
        const p2 = fetchLatestMessages(mockApi, 's1')
        resolveFirst({ data: { messages: [], page: { hasMore: false } } })
        await Promise.all([p1, p2])
        expect(mockApi.messages.list).toHaveBeenCalledTimes(1)
    })

    it('SSE 已先入库（store 非空、isLoading 锁不生效）时在途标记挡住并发第二笔', async () => {
        // 性能基线（perf/基线.md 长任务归因）实测：SSE 快照先于首拉入库时，
        // isEmpty=false → isLoading 锁不生效 → 两个消费方的 mount effect 各发一笔
        // 相同请求，后到者被 generation 判废（STALE-DROPPED），纯浪费
        ingestIncomingMessages('s1', [msg('a', 1)])
        let resolveFirst!: (v: { data: { messages: DecryptedMessage[]; page: { hasMore: boolean } } }) => void
        mockApi.messages.list.mockImplementationOnce(() => new Promise(resolve => { resolveFirst = resolve }))
        const p1 = fetchLatestMessages(mockApi, 's1')
        const p2 = fetchLatestMessages(mockApi, 's1')
        resolveFirst({ data: { messages: [msg('a', 1)], page: { hasMore: false } } })
        await Promise.all([p1, p2])
        expect(mockApi.messages.list).toHaveBeenCalledTimes(1)
    })

    it('在途拉取期间 store 被 clear（generation 递增）→ 允许发起新拉取', async () => {
        ingestIncomingMessages('s1', [msg('a', 1)])
        let resolveFirst!: (v: { data: { messages: DecryptedMessage[]; page: { hasMore: boolean } } }) => void
        mockApi.messages.list.mockImplementationOnce(() => new Promise(resolve => { resolveFirst = resolve }))
        const p1 = fetchLatestMessages(mockApi, 's1')
        clearMessageWindow('s1')
        const p2 = fetchLatestMessages(mockApi, 's1')
        resolveFirst({ data: { messages: [msg('a', 1)], page: { hasMore: false } } })
        await Promise.all([p1, p2])
        expect(mockApi.messages.list).toHaveBeenCalledTimes(2)
    })
})
