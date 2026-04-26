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

import { describe, expect, it } from 'vitest'
import { resolveMessageCache, extractParentUuid } from '@/core/data/cache/messageCache'
import type { DecryptedMessage } from '@mobi/shared'

// 构造 DecryptedMessage 的辅助函数
function makeMsg(overrides: Partial<DecryptedMessage> & Pick<DecryptedMessage, 'id' | 'content'>): DecryptedMessage {
    return {
        seq: 1,
        localId: null,
        createdAt: Date.now(),
        snapshot: false,
        ...overrides,
    }
}

function makeContent(parentUuid: string, messageContent: unknown) {
    return {
        role: 'agent' as const,
        content: {
            type: 'output',
            data: { parentUuid, type: 'assistant', message: { role: 'assistant', content: messageContent } },
        },
        meta: { sentFrom: 'cli' },
    }
}

const thinking = (text: string) => ({ type: 'thinking' as const, thinking: text })
const text = (text: string) => ({ type: 'text' as const, text })

describe('extractParentUuid', () => {
    it('应从 content 信封中提取 parentUuid', () => {
        const content = makeContent('uuid-parent-1', [])
        expect(extractParentUuid(content)).toBe('uuid-parent-1')
    })

    it('缺少 parentUuid 时返回 null', () => {
        expect(extractParentUuid(null)).toBeNull()
        expect(extractParentUuid({})).toBeNull()
        expect(extractParentUuid({ content: {} })).toBeNull()
        expect(extractParentUuid({ content: { data: {} } })).toBeNull()
        expect(extractParentUuid({ content: { data: { parentUuid: 123 } } })).toBeNull()
    })
})

describe('resolveMessageCache', () => {
    it('空缓存时直接追加', () => {
        const msg = makeMsg({ id: 'msg-1', content: makeContent('p1', []) })
        expect(resolveMessageCache(undefined, msg)).toEqual([msg])
        expect(resolveMessageCache([], msg)).toEqual([msg])
    })

    it('snapshot 原地更新', () => {
        const s1 = makeMsg({ id: 'snap-1', snapshot: true, content: makeContent('p1', [thinking('hello')]) })
        const s2 = makeMsg({ id: 'snap-1', snapshot: true, content: makeContent('p1', [thinking('hello world')]) })

        const result = resolveMessageCache([s1], s2)
        expect(result).toHaveLength(1)
        expect(result[0]).toBe(s2)
    })

    it('message-received 通过 parentUuid 匹配清理 snapshot', () => {
        const snapshot = makeMsg({ id: 'snap-1', snapshot: true, content: makeContent('p1', [thinking('hello')]) })
        const received = makeMsg({ id: 'msg-1', content: makeContent('p1', [thinking('hello')]) })

        const result = resolveMessageCache([snapshot], received)
        expect(result).toHaveLength(1)
        expect(result[0].id).toBe('msg-1')
        expect(result[0].snapshot).toBeFalsy()
    })

    it('snapshot id 复用不覆盖已落库的 thinking 消息', () => {
        // 模拟 SDK 单次响应中 thinking + text 共享 snapshot id 的场景
        const parentUuid = 'p1'

        // 1. thinking snapshot
        const thinkingSnap = makeMsg({ id: 'snap-1', snapshot: true, content: makeContent(parentUuid, [thinking('思考中...')]) })
        let cache = resolveMessageCache(undefined, thinkingSnap)
        expect(cache).toHaveLength(1)

        // 2. thinking message-received（落库）
        const thinkingMsg = makeMsg({ id: 'msg-thinking', content: makeContent(parentUuid, [thinking('思考中...完整')]) })
        cache = resolveMessageCache(cache, thinkingMsg)
        expect(cache).toHaveLength(1)
        expect(cache[0].id).toBe('msg-thinking')
        expect(cache[0].snapshot).toBeFalsy()

        // 3. text snapshot 复用 snap-1（同一个 SDK 消息）
        const textSnap = makeMsg({ id: 'snap-1', snapshot: true, content: makeContent('msg-thinking', [text('你好！')]) })
        cache = resolveMessageCache(cache, textSnap)
        expect(cache).toHaveLength(2)
        // thinking 消息保留，不被覆盖
        expect(cache[0].id).toBe('msg-thinking')
        expect(cache[1].id).toBe('snap-1')

        // 4. text message-received
        const textMsg = makeMsg({ id: 'msg-text', content: makeContent('msg-thinking', [text('你好！完整')]) })
        cache = resolveMessageCache(cache, textMsg)
        expect(cache).toHaveLength(2)
        expect(cache[0].id).toBe('msg-thinking')
        expect(cache[1].id).toBe('msg-text')
    })

    it('多 turn 连续 thinking 快照流', () => {
        // 模拟 3 个 thinking 块的场景（与实际 bug 场景一致）
        // Turn 1: thinking1 → text1
        // Turn 2: thinking2 (无 text，直接 tool_use)
        // Turn 3: thinking3 → text3

        // === Turn 1 ===
        const t1Snap = makeMsg({ id: 'snap-1', snapshot: true, content: makeContent('p0', [thinking('think1')]) })
        const t1Msg = makeMsg({ id: 'msg-t1', content: makeContent('p0', [thinking('think1')]) })
        const text1Snap = makeMsg({ id: 'snap-1', snapshot: true, content: makeContent('msg-t1', [text('text1')]) })
        const text1Msg = makeMsg({ id: 'msg-text1', content: makeContent('msg-t1', [text('text1')]) })

        // === Turn 2 ===
        const t2Snap = makeMsg({ id: 'snap-2', snapshot: true, content: makeContent('p-tool1', [thinking('think2')]) })
        const t2Msg = makeMsg({ id: 'msg-t2', content: makeContent('p-tool1', [thinking('think2')]) })

        // === Turn 3 ===
        const t3Snap = makeMsg({ id: 'snap-3', snapshot: true, content: makeContent('p-tool2', [thinking('think3')]) })
        const t3Msg = makeMsg({ id: 'msg-t3', content: makeContent('p-tool2', [thinking('think3')]) })
        const text3Snap = makeMsg({ id: 'snap-3', snapshot: true, content: makeContent('msg-t3', [text('text3')]) })
        const text3Msg = makeMsg({ id: 'msg-text3', content: makeContent('msg-t3', [text('text3')]) })

        // 按事件顺序逐步推进
        let cache: DecryptedMessage[] = []

        cache = resolveMessageCache(cache, t1Snap)
        cache = resolveMessageCache(cache, t1Msg)
        cache = resolveMessageCache(cache, text1Snap)
        cache = resolveMessageCache(cache, text1Msg)
        cache = resolveMessageCache(cache, t2Snap)
        cache = resolveMessageCache(cache, t2Msg)
        cache = resolveMessageCache(cache, t3Snap)
        cache = resolveMessageCache(cache, t3Msg)
        cache = resolveMessageCache(cache, text3Snap)
        cache = resolveMessageCache(cache, text3Msg)

        // 最终应有 5 条落库消息：3 thinking + 2 text，无 snapshot 残留
        expect(cache).toHaveLength(5)
        const ids = cache.map(m => m.id)
        expect(ids).toEqual(['msg-t1', 'msg-text1', 'msg-t2', 'msg-t3', 'msg-text3'])
        // 不应该有 snapshot 残留
        expect(cache.every(m => !m.snapshot)).toBe(true)
    })

    it('skipIfNotSnapshot 防止重复处理', () => {
        const msg = makeMsg({ id: 'msg-1', content: makeContent('p1', []) })

        const cache = resolveMessageCache(undefined, msg)
        // 重复 message-received，应跳过
        const result = resolveMessageCache(cache, msg, { skipIfNotSnapshot: true })
        expect(result).toBe(cache) // 引用相等，未修改
    })

    it('snapshot 替换 snapshot 不受 skipIfNotSnapshot 影响', () => {
        const s1 = makeMsg({ id: 'snap-1', snapshot: true, content: makeContent('p1', []) })
        const s2 = makeMsg({ id: 'snap-1', snapshot: true, content: makeContent('p1', [text('updated')]) })

        const result = resolveMessageCache([s1], s2, { skipIfNotSnapshot: true })
        expect(result).toHaveLength(1)
        expect(result[0]).toBe(s2)
    })

    it('不同 parentUuid 的 snapshot 不被误删', () => {
        const snap1 = makeMsg({ id: 'snap-1', snapshot: true, content: makeContent('p1', [thinking('t1')]) })
        const snap2 = makeMsg({ id: 'snap-2', snapshot: true, content: makeContent('p2', [thinking('t2')]) })

        // msg-received 匹配 p1，只应删 snap1
        const msg = makeMsg({ id: 'msg-1', content: makeContent('p1', [thinking('t1')]) })
        const result = resolveMessageCache([snap1, snap2], msg)

        expect(result).toHaveLength(2)
        expect(result[0].id).toBe('snap-2')
        expect(result[1].id).toBe('msg-1')
    })
})
