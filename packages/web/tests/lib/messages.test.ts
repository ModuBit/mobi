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
 * messages 工具函数单元测试
 * 测试 isUserMessage、mergeMessages 等函数
 */

import { describe, expect, it } from 'vitest'
import { isUserMessage, isQueuedInMobi, mergeMessages, makeClientSideId } from '@/core/lib/messages'
import type { DecryptedMessage } from '@/core/data/api/types'

/** 创建 mock DecryptedMessage */
function createMessage(overrides: Partial<DecryptedMessage> = {}): DecryptedMessage {
    return {
        id: 'msg-1',
        seq: 1,
        localId: null,
        createdAt: 1000,
        // 默认一条排队消息（queueState=pending）；非排队用例显式覆盖为 null
        queueState: 'pending',
        content: { role: 'user', content: 'hello', meta: { sentFrom: 'webapp' } },
        ...overrides,
    }
}

describe('isUserMessage', () => {
    it('应识别 role 为 user 的消息', () => {
        const msg = createMessage({
            content: { role: 'user', content: 'hello' },
        })
        expect(isUserMessage(msg)).toBe(true)
    })

    it('应识别 role 为 agent 的消息不是 user 消息', () => {
        const msg = createMessage({
            content: { role: 'agent', content: { type: 'text', text: 'hi' } },
        })
        expect(isUserMessage(msg)).toBe(false)
    })

    it('content 没有 role 字段时应返回 false', () => {
        const msg = createMessage({
            content: 'plain string',
        })
        expect(isUserMessage(msg)).toBe(false)
    })

    it('content 为 null 时应返回 false', () => {
        const msg = createMessage({
            content: null,
        })
        expect(isUserMessage(msg)).toBe(false)
    })

    it('content 为非对象时应返回 false', () => {
        const msg = createMessage({
            content: 42,
        })
        expect(isUserMessage(msg)).toBe(false)
    })
})

describe('isQueuedInMobi', () => {
    // 新模型：isQueuedInMobi 只读 queueState==='pending'（Hub 写入裁决的单一结果）。
    // createMessage 默认 queueState='pending' 表示一条排队消息。
    it('queueState=pending = 排队中', () => {
        expect(isQueuedInMobi(createMessage())).toBe(true)
    })

    it('queueState=consumed = 不排队', () => {
        expect(isQueuedInMobi(createMessage({ queueState: 'consumed', submittedAt: 1000 }))).toBe(false)
    })

    it('queueState 缺失（非排队轨道消息）= 不排队', () => {
        expect(isQueuedInMobi(createMessage({ queueState: null }))).toBe(false)
        expect(isQueuedInMobi(createMessage({ queueState: undefined }))).toBe(false)
    })

    it('failed 状态 = 不排队', () => {
        expect(isQueuedInMobi(createMessage({ status: 'failed' }))).toBe(false)
    })

    it('sending 状态（非 running 乐观消息）= 不排队，作为普通气泡', () => {
        expect(isQueuedInMobi(createMessage({ status: 'sending', queueState: null }))).toBe(false)
    })

    it('agent 消息（queueState 非 pending）= 不排队', () => {
        const msg = createMessage({
            queueState: null,
            content: { role: 'agent', content: { type: 'text', text: 'hi' } },
        })
        expect(isQueuedInMobi(msg)).toBe(false)
    })

    it('CLI 回显：Hub 裁决为非排队轨道（queueState=null）→ 不排队', () => {
        // local-command-stdout / compact summary 等 CLI 回显，Hub addMessage 用 denylist 判定
        // 不进排队轨道，Web 只读 queueState，与来源无关
        const msg = createMessage({
            queueState: null,
            submittedAt: null,
            content: {
                role: 'user',
                content: { type: 'text', text: '<local-command-stdout>Set model to sonnet</local-command-stdout>' },
                meta: { sentFrom: 'cli' },
            },
        })
        expect(isQueuedInMobi(msg)).toBe(false)
    })
})

describe('mergeMessages', () => {
    it('应按 seq 排序消息（seq 优先于 createdAt）', () => {
        const existing: DecryptedMessage[] = []
        const incoming: DecryptedMessage[] = [
            createMessage({ id: 'msg-1', seq: 1, createdAt: 3000 }),
            createMessage({ id: 'msg-2', seq: 2, createdAt: 1000 }),
            createMessage({ id: 'msg-3', seq: 3, createdAt: 2000 }),
        ]

        const result = mergeMessages(existing, incoming)
        expect(result).toHaveLength(3)
        // seq 优先排序：1, 2, 3
        expect(result[0].id).toBe('msg-1')
        expect(result[1].id).toBe('msg-2')
        expect(result[2].id).toBe('msg-3')
    })

    it('positionAt 优先于 seq 排序（对齐 hub 排队消费跳变语义）', () => {
        // 排队消息消费时 positionAt 跳到消费时刻（可早于/晚于 seq 顺序），
        // 排序必须跟 positionAt 走，而非 seq——否则运行中消费的用户消息会卡在 turn 中间
        const incoming: DecryptedMessage[] = [
            createMessage({ id: 'msg-1', seq: 1, positionAt: 3000 }),
            createMessage({ id: 'msg-2', seq: 2, positionAt: 1000 }),
            createMessage({ id: 'msg-3', seq: 3, positionAt: 2000 }),
        ]

        const result = mergeMessages([], incoming)
        // positionAt 排序：1000, 2000, 3000（而非 seq 1,2,3）
        expect(result.map(m => m.id)).toEqual(['msg-2', 'msg-3', 'msg-1'])
    })

    it('positionAt 缺失（如 snapshot）时回退 seq 排序', () => {
        const incoming: DecryptedMessage[] = [
            createMessage({ id: 'msg-1', seq: 3 }),
            createMessage({ id: 'msg-2', seq: 1 }),
            createMessage({ id: 'msg-3', seq: 2 }),
        ]

        const result = mergeMessages([], incoming)
        expect(result.map(m => m.id)).toEqual(['msg-2', 'msg-3', 'msg-1'])
    })

    it('当 seq 为 null 时应按 createdAt 排序', () => {
        const existing: DecryptedMessage[] = []
        const incoming: DecryptedMessage[] = [
            createMessage({ id: 'msg-1', seq: null, createdAt: 3000 }),
            createMessage({ id: 'msg-2', seq: null, createdAt: 1000 }),
            createMessage({ id: 'msg-3', seq: null, createdAt: 2000 }),
        ]

        const result = mergeMessages(existing, incoming)
        expect(result).toHaveLength(3)
        expect(result[0].id).toBe('msg-2')
        expect(result[1].id).toBe('msg-3')
        expect(result[2].id).toBe('msg-1')
    })

    it('应去重相同 id 的消息（incoming 覆盖 existing）', () => {
        const existing: DecryptedMessage[] = [
            createMessage({ id: 'msg-1', seq: 1, createdAt: 1000 }),
        ]
        const incoming: DecryptedMessage[] = [
            createMessage({ id: 'msg-1', seq: 1, createdAt: 1000, content: { role: 'user', content: 'updated' } }),
        ]

        const result = mergeMessages(existing, incoming)
        expect(result).toHaveLength(1)
        expect((result[0].content as { content: string }).content).toBe('updated')
    })

    it('应处理 existing 为空数组', () => {
        const result = mergeMessages([], [
            createMessage({ id: 'msg-1', createdAt: 1000 }),
        ])
        expect(result).toHaveLength(1)
    })

    it('应处理 incoming 为空数组', () => {
        const result = mergeMessages([
            createMessage({ id: 'msg-1', createdAt: 1000 }),
        ], [])
        expect(result).toHaveLength(1)
    })

    it('乐观更新消息被服务端消息替代（通过 localId 匹配）', () => {
        // 乐观消息：id === localId
        const optimistic = createMessage({
            id: 'local-1',
            localId: 'local-1',
            seq: null,
            createdAt: 1000,
            status: 'sent',
        })

        // 服务端消息：localId 指向乐观消息
        const serverMsg = createMessage({
            id: 'server-1',
            localId: 'local-1',
            seq: 1,
            createdAt: 1000,
        })

        const result = mergeMessages([optimistic], [serverMsg])
        expect(result).toHaveLength(1)
        expect(result[0].id).toBe('server-1')
    })

    it('应合并两组不同的消息', () => {
        const existing: DecryptedMessage[] = [
            createMessage({ id: 'msg-1', seq: 1, createdAt: 1000 }),
            createMessage({ id: 'msg-2', seq: 2, createdAt: 2000 }),
        ]
        const incoming: DecryptedMessage[] = [
            createMessage({ id: 'msg-3', seq: 3, createdAt: 1500 }),
        ]

        const result = mergeMessages(existing, incoming)
        expect(result).toHaveLength(3)
        // seq 优先排序：1, 2, 3
        expect(result.map(m => m.id)).toEqual(['msg-1', 'msg-2', 'msg-3'])
    })

    it('当 seq 相同时应按 createdAt 排序', () => {
        const msgs: DecryptedMessage[] = [
            createMessage({ id: 'a', seq: null, createdAt: 3000 }),
            createMessage({ id: 'b', seq: null, createdAt: 1000 }),
            createMessage({ id: 'c', seq: null, createdAt: 2000 }),
        ]

        const result = mergeMessages([], msgs)
        expect(result.map(m => m.id)).toEqual(['b', 'c', 'a'])
    })

    it('当 seq 和 createdAt 都相同时应按 id 排序', () => {
        const msgs: DecryptedMessage[] = [
            createMessage({ id: 'msg-c', seq: null, createdAt: 1000 }),
            createMessage({ id: 'msg-a', seq: null, createdAt: 1000 }),
            createMessage({ id: 'msg-b', seq: null, createdAt: 1000 }),
        ]

        const result = mergeMessages([], msgs)
        expect(result.map(m => m.id)).toEqual(['msg-a', 'msg-b', 'msg-c'])
    })
})

describe('mergeMessages submittedAt 保留', () => {
    it('服务端 echo 缺 submittedAt 时从乐观消息迁移 status', () => {
        const optimistic = createMessage({
            id: 'local-1',
            localId: 'local-1',
            seq: null,
            createdAt: 1000,
            status: 'queued',
        })
        const serverEcho = createMessage({
            id: 'server-1',
            localId: 'local-1',
            seq: 1,
            createdAt: 1000,
            // submittedAt 未设 — 模拟服务端 echo 不带此字段
        })

        const result = mergeMessages([optimistic], [serverEcho])
        expect(result).toHaveLength(1)
        expect(result[0].id).toBe('server-1')
        expect(result[0].status).toBe('queued')
    })

    it('incoming 覆盖时不丢已有的 submittedAt（防陈旧 echo 回退）', () => {
        const existing = createMessage({
            id: 'server-1',
            localId: null,
            submittedAt: 100,
        })
        const incoming = createMessage({
            id: 'server-1',
            localId: null,
            // incoming 缺 submittedAt — 模拟陈旧的服务端数据
        })

        const result = mergeMessages([existing], [incoming])
        expect(result).toHaveLength(1)
        expect(result[0].submittedAt).toBe(100)
    })

    it('incoming 带 submittedAt 时正常覆盖（不保留旧值）', () => {
        const existing = createMessage({
            id: 'server-1',
            localId: null,
            submittedAt: 100,
        })
        const incoming = createMessage({
            id: 'server-1',
            localId: null,
            submittedAt: 200,
        })

        const result = mergeMessages([existing], [incoming])
        expect(result[0].submittedAt).toBe(200)
    })
})

describe('makeClientSideId', () => {
    it('应生成以指定前缀开头的 ID', () => {
        const id = makeClientSideId('test')
        expect(id.startsWith('test-')).toBe(true)
    })

    it('应生成唯一的 ID', () => {
        const id1 = makeClientSideId('a')
        const id2 = makeClientSideId('a')
        expect(id1).not.toBe(id2)
    })
})
