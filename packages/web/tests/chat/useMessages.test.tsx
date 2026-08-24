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
import { renderHook, act } from '@testing-library/react'
import { useMessages } from '@/core/data/hooks/queries/useMessages'
import { ingestIncomingMessages, _resetForTest } from '@/core/data/stores/messageWindowStore'
import type { DecryptedMessage } from '@/core/data/api/types'

// useMobiApi 内部 createMobiApi() 会创建 axios 实例并发真实请求，
// 测试只验证 store 订阅，mock 掉避免网络噪声。
// 必须返回稳定引用（同真实 useMobiApi 的 useMemo），否则 useEffect [api] 无限循环 → OOM
const mockApi = {
    messages: { list: vi.fn().mockResolvedValue({ data: { messages: [], page: { hasMore: false } } }) },
}
vi.mock('@/core/data/api/client', () => ({
    useMobiApi: () => mockApi,
}))

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

describe('useMessages', () => {
    beforeEach(() => _resetForTest())

    it('订阅 store，返回 messages + meta', () => {
        ingestIncomingMessages('s1', [msg('a', 1), msg('b', 2)])
        const { result } = renderHook(() => useMessages('s1'))
        expect(result.current.messages.map(m => m.id)).toEqual(['a', 'b'])
        expect(result.current.hasNextPage).toBe(false)
    })

    it('store 更新后 hook 重选', () => {
        const { result } = renderHook(() => useMessages('s1'))
        expect(result.current.messages).toEqual([])
        act(() => ingestIncomingMessages('s1', [msg('c', 3)]))
        expect(result.current.messages.map(m => m.id)).toEqual(['c'])
    })
})
