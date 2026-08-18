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

function makeContent(parentUuid: string, messageContent: unknown, messageId?: string) {
    return {
        role: 'agent' as const,
        content: {
            type: 'output',
            data: {
                parentUuid,
                type: 'assistant',
                // message.id 由 Anthropic 分配：full message 自带，snapshot 由 CLI 捕获 message_start 写入。
                // snapshot/full 共享同一 message.id，是稳定的关联键（不受 parentUuid 漂移影响）
                message: { id: messageId, role: 'assistant', content: messageContent },
            },
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

    it('skipIfNotSnapshot 命中重复消息时，合并 native metadata 补写（rewind 锚点）', () => {
        // Web 发消息落库时 metadata=null，messages-bound 广播补写 nativeId/nativeSessionId
        const msg = makeMsg({ id: 'msg-1', content: makeContent('p1', []) })
        const cache = resolveMessageCache(undefined, msg)

        const bound = makeMsg({
            id: 'msg-1',
            content: makeContent('p1', []),
            metadata: { nativeId: 'uu-1', nativeSessionId: 'ns-1' },
        })
        const result = resolveMessageCache(cache, bound, { skipIfNotSnapshot: true })
        expect(result).toHaveLength(1)
        expect(result[0].metadata).toEqual({ nativeId: 'uu-1', nativeSessionId: 'ns-1' })
    })

    it('skipIfNotSnapshot 命中且旧消息 metadata 已完整 → 不覆盖（引用相等）', () => {
        const msg = makeMsg({ id: 'msg-1', content: makeContent('p1', []), metadata: { nativeId: 'uu-old', nativeSessionId: 'ns-old' } })
        const cache = resolveMessageCache(undefined, msg)

        const bound = makeMsg({ id: 'msg-1', content: makeContent('p1', []), metadata: { nativeId: 'uu-new', nativeSessionId: 'ns-new' } })
        const result = resolveMessageCache(cache, bound, { skipIfNotSnapshot: true })
        expect(result).toBe(cache) // 无空缺，引用相等，未修改
    })

    it('skipIfNotSnapshot 命中且旧消息 metadata 部分空缺 → 只补空缺字段', () => {
        const msg = makeMsg({ id: 'msg-1', content: makeContent('p1', []), metadata: { nativeId: 'uu-1' } })
        const cache = resolveMessageCache(undefined, msg)

        const bound = makeMsg({ id: 'msg-1', content: makeContent('p1', []), metadata: { nativeId: 'uu-1', nativeSessionId: 'ns-1' } })
        const result = resolveMessageCache(cache, bound, { skipIfNotSnapshot: true })
        expect(result[0].metadata).toEqual({ nativeId: 'uu-1', nativeSessionId: 'ns-1' })
    })

    it('skipIfNotSnapshot 命中时，合并 messages-acked 补写的 nativeAckAt', () => {
        // messages-bound 先补 nativeId/nativeSessionId，messages-acked 再补 nativeAckAt：
        // 若漏 nativeAckAt，rewind 判据（nativeAckAt != null）永远 false，hover 不显 rewind icon
        const msg = makeMsg({
            id: 'msg-1',
            content: makeContent('p1', []),
            metadata: { nativeId: 'uu-1', nativeSessionId: 'ns-1' },
        })
        const cache = resolveMessageCache(undefined, msg)

        const acked = makeMsg({
            id: 'msg-1',
            content: makeContent('p1', []),
            metadata: { nativeId: 'uu-1', nativeSessionId: 'ns-1', nativeAckAt: 1787037249305 },
        })
        const result = resolveMessageCache(cache, acked, { skipIfNotSnapshot: true })
        expect(result[0].metadata).toEqual({ nativeId: 'uu-1', nativeSessionId: 'ns-1', nativeAckAt: 1787037249305 })
    })

    it('skipIfNotSnapshot 命中且 nativeAckAt 已存在 → 不覆盖（引用相等）', () => {
        const msg = makeMsg({
            id: 'msg-1',
            content: makeContent('p1', []),
            metadata: { nativeId: 'uu-1', nativeSessionId: 'ns-1', nativeAckAt: 111 },
        })
        const cache = resolveMessageCache(undefined, msg)

        const dup = makeMsg({
            id: 'msg-1',
            content: makeContent('p1', []),
            metadata: { nativeId: 'uu-1', nativeSessionId: 'ns-1', nativeAckAt: 999 },
        })
        const result = resolveMessageCache(cache, dup, { skipIfNotSnapshot: true })
        expect(result).toBe(cache) // nativeAckAt 已有值，引用相等，未修改
    })

    it('skipIfNotSnapshot 命中且旧消息 seq 为 null（乐观消息）→ 补真实 seq', () => {
        // Web 发消息乐观追加 seq=null，落库 message-received 带真实 seq：
        // 若不补 seq，rewindFrom 的 `seq == null` 会永远保留它，导致回退后消息清不掉
        const optimistic = makeMsg({ id: 'msg-1', seq: null as unknown as number, content: makeContent('p1', []) })
        const cache = resolveMessageCache(undefined, optimistic)

        const received = makeMsg({ id: 'msg-1', seq: 66, content: makeContent('p1', []) })
        const result = resolveMessageCache(cache, received, { skipIfNotSnapshot: true })
        expect(result).toHaveLength(1)
        expect(result[0].seq).toBe(66)
    })

    it('skipIfNotSnapshot 命中且旧消息 seq 已有值 → 不覆盖 seq（引用相等）', () => {
        const msg = makeMsg({ id: 'msg-1', seq: 66, content: makeContent('p1', []) })
        const cache = resolveMessageCache(undefined, msg)

        const dup = makeMsg({ id: 'msg-1', seq: 66, content: makeContent('p1', []) })
        const result = resolveMessageCache(cache, dup, { skipIfNotSnapshot: true })
        expect(result).toBe(cache) // 无变化，引用相等
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

    it('full 按 parentUuid 清理 snapshot（assembler 聚合 full 后 parentUuid 不漂移）', () => {
        // 前提：CLI 的 assembler 把 SDK 拆分的 full 按 message.id 聚合成一条 → snapshot 与 full
        // 1-vs-1 → parentUuid 不漂移 → parentUuid 清理可靠（= message queue 之前的稳定态）
        const snapshot = makeMsg({ id: 'snap-1', snapshot: true, content: makeContent('p1', [thinking('t1')]) })
        const received = makeMsg({ id: 'msg-1', content: makeContent('p1', [thinking('t1')]) })

        const result = resolveMessageCache([snapshot], received)
        expect(result).toHaveLength(1)
        expect(result[0].id).toBe('msg-1')
    })
})
