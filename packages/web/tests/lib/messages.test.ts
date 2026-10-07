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
import { isUserMessage, isQueuedInMobi, mergeMessages, makeClientSideId, sortMessages } from '@/core/lib/messages'
import type { DecryptedMessage } from '@/core/data/api/types'

/** 创建 mock DecryptedMessage */
function createMessage(overrides: Partial<DecryptedMessage> = {}): DecryptedMessage {
    return {
        id: 'msg-1',
        seq: 1,
        localId: null,
        createdAt: 1000,
        // 默认一条排队消息（lifecycle='queued'）；非排队用例显式覆盖为 null
        lifecycle: 'queued',
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
    // 新模型：isQueuedInMobi 只读 lifecycle==='queued'（Hub 写入裁决的单一结果）。
    // createMessage 默认 lifecycle='queued' 表示一条排队消息。
    it('lifecycle=queued = 排队中', () => {
        expect(isQueuedInMobi(createMessage())).toBe(true)
    })

    it('lifecycle=pushed = 不排队', () => {
        expect(isQueuedInMobi(createMessage({ lifecycle: 'pushed', lifecycleAt: 1000 }))).toBe(false)
    })

    it('lifecycle 缺失（非排队轨道消息）= 不排队', () => {
        expect(isQueuedInMobi(createMessage({ lifecycle: null }))).toBe(false)
        expect(isQueuedInMobi(createMessage({ lifecycle: undefined }))).toBe(false)
    })

    it('failed 状态 = 不排队', () => {
        expect(isQueuedInMobi(createMessage({ status: 'failed' }))).toBe(false)
    })

    it('sending 状态（非 running 乐观消息）= 不排队，作为普通气泡', () => {
        expect(isQueuedInMobi(createMessage({ status: 'sending', lifecycle: null }))).toBe(false)
    })

    it('agent 消息（lifecycle 非 queued）= 不排队', () => {
        const msg = createMessage({
            lifecycle: null,
            content: { role: 'agent', content: { type: 'text', text: 'hi' } },
        })
        expect(isQueuedInMobi(msg)).toBe(false)
    })

    it('CLI 回显：Hub 裁决为非排队轨道（lifecycle=null）→ 不排队', () => {
        // local-command-stdout / compact summary 等 CLI 回显，Hub addMessage 用 denylist 判定
        // 不进排队轨道，Web 只读 lifecycle，与来源无关
        const msg = createMessage({
            lifecycle: null,
            lifecycleAt: null,
            content: {
                role: 'user',
                content: { type: 'text', text: '<local-command-stdout>Set model to sonnet</local-command-stdout>' },
                meta: { sentFrom: 'cli' },
            },
        })
        expect(isQueuedInMobi(msg)).toBe(false)
    })
})

describe('sortMessages 流式行锚定（实时排序 = DB 落库排序）', () => {
    // 流式 snapshot 行没有 positionAt/seq（wrapAsDecryptedMessage 只填 createdAt=流首帧时刻），
    // 其将来落库的 position_at = 完成时刻，必然晚于当前一切已锚定行。因此排序上
    // snapshot 行必须视为「锚点在未来」——mid-stream 用户消息（positionAt=发送时刻）
    // 在实时窗口中就该排在流式行上方，与刷新后 DB 顺序一致（否则用户消息被整条
    // 持续增长的流式气泡压在下方，视觉即「用户消息跑到 agent 消息后面」）
    it('流式行（createdAt 早）排在 mid-stream 用户消息（positionAt 晚）之下', () => {
        const result = sortMessages([
            createMessage({
                id: 'user-mid', seq: 90, positionAt: 5000, createdAt: 5000,
                lifecycle: 'queued', content: { role: 'user', content: 'hi' },
            }),
            createMessage({
                id: 'snap', seq: null, positionAt: undefined, createdAt: 1000, snapshot: true,
                lifecycle: null, content: { role: 'agent', content: { type: 'output', data: {} } },
            }),
        ])
        expect(result.map(m => m.id)).toEqual(['user-mid', 'snap'])
    })

    it('已消费跳变的用户行（positionAt=消费时刻）同样排在流式行之上', () => {
        const result = sortMessages([
            createMessage({
                id: 'snap', seq: null, positionAt: undefined, createdAt: 1000, snapshot: true,
                lifecycle: null, content: { role: 'agent', content: { type: 'output', data: {} } },
            }),
            createMessage({
                id: 'user-jumped', seq: 90, positionAt: 9000, createdAt: 5000,
                lifecycle: 'pushed', content: { role: 'user', content: 'hi' },
            }),
        ])
        expect(result.map(m => m.id)).toEqual(['user-jumped', 'snap'])
    })

    it('乐观行（无锚点非 snapshot）也排在流式行之上——落库后 positionAt=发送时刻，DB 顺序同向', () => {
        const result = sortMessages([
            createMessage({
                id: 'snap', seq: null, positionAt: undefined, createdAt: 1000, snapshot: true,
                lifecycle: null, content: { role: 'agent', content: { type: 'output', data: {} } },
            }),
            createMessage({
                id: 'opt', seq: null, positionAt: undefined, createdAt: 5000,
                lifecycle: 'queued', content: { role: 'user', content: 'hi' },
            }),
        ])
        expect(result.map(m => m.id)).toEqual(['opt', 'snap'])
    })

    it('多条流式行之间保持 createdAt 顺序', () => {
        const result = sortMessages([
            createMessage({
                id: 'snap-b', seq: null, positionAt: undefined, createdAt: 2000, snapshot: true,
                lifecycle: null, content: { role: 'agent', content: { type: 'output', data: {} } },
            }),
            createMessage({
                id: 'snap-a', seq: null, positionAt: undefined, createdAt: 1000, snapshot: true,
                lifecycle: null, content: { role: 'agent', content: { type: 'output', data: {} } },
            }),
        ])
        expect(result.map(m => m.id)).toEqual(['snap-a', 'snap-b'])
    })

    it('已锚定行之间不受流式行影响（positionAt 主序照旧）', () => {
        const result = sortMessages([
            createMessage({ id: 'm2', seq: 2, positionAt: 2000, createdAt: 2000, lifecycle: null }),
            createMessage({ id: 'm1', seq: 1, positionAt: 1000, createdAt: 1000, lifecycle: null }),
        ])
        expect(result.map(m => m.id)).toEqual(['m1', 'm2'])
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

describe('mergeMessages lifecycleAt 保留', () => {
    it('服务端 echo 缺 lifecycleAt 时从乐观消息迁移 status', () => {
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
            // lifecycleAt 未设 — 模拟服务端 echo 不带此字段
        })

        const result = mergeMessages([optimistic], [serverEcho])
        expect(result).toHaveLength(1)
        expect(result[0].id).toBe('server-1')
        expect(result[0].status).toBe('queued')
    })

    it('incoming 覆盖时不丢已有的 lifecycleAt（防陈旧 echo 回退）', () => {
        const existing = createMessage({
            id: 'server-1',
            localId: null,
            lifecycleAt: 100,
        })
        const incoming = createMessage({
            id: 'server-1',
            localId: null,
            // incoming 缺 lifecycleAt — 模拟陈旧的服务端数据
        })

        const result = mergeMessages([existing], [incoming])
        expect(result).toHaveLength(1)
        expect(result[0].lifecycleAt).toBe(100)
    })

    it('incoming 带 lifecycleAt 时正常覆盖（不保留旧值）', () => {
        const existing = createMessage({
            id: 'server-1',
            localId: null,
            lifecycleAt: 100,
        })
        const incoming = createMessage({
            id: 'server-1',
            localId: null,
            lifecycleAt: 200,
        })

        const result = mergeMessages([existing], [incoming])
        expect(result[0].lifecycleAt).toBe(200)
    })
})

describe('mergeMessages lifecycle 单调防护', () => {
    it('pushed 行收到陈旧 queued echo 不回退（lifecycleAt 更早或相等）', () => {
        const existing = [createMessage({
            id: 'm1',
            localId: 'l1',
            lifecycle: 'pushed',
            lifecycleAt: 2000,
            positionAt: 2000,
        })]
        const incoming = [createMessage({
            id: 'm1',
            localId: 'l1',
            lifecycle: 'queued',
            lifecycleAt: 1000,
            positionAt: 1000,
            createdAt: 1000,
        })]

        const merged = mergeMessages(existing, incoming)
        expect(merged[0].lifecycle).toBe('pushed')
        expect(merged[0].lifecycleAt).toBe(2000)
    })

    it('incoming lifecycleAt 更晚的合法更新正常接受（不误伤正常推进）', () => {
        const existing = [createMessage({
            id: 'm1',
            localId: 'l1',
            lifecycle: 'queued',
            lifecycleAt: 1000,
            positionAt: 1000,
        })]
        const incoming = [createMessage({
            id: 'm1',
            localId: 'l1',
            lifecycle: 'pushed',
            lifecycleAt: 2000,
            positionAt: 2000,
        })]

        const merged = mergeMessages(existing, incoming)
        expect(merged[0].lifecycle).toBe('pushed')
        expect(merged[0].lifecycleAt).toBe(2000)
    })

    it('终态同样不被陈旧帧拉回（done 收到陈旧 queued）', () => {
        const existing = [createMessage({
            id: 'm1',
            lifecycle: 'done',
            lifecycleAt: 3000,
            positionAt: 3000,
        })]
        const incoming = [createMessage({
            id: 'm1',
            lifecycle: 'queued',
            lifecycleAt: 1000,
            positionAt: 1000,
            createdAt: 1000,
        })]

        const merged = mergeMessages(existing, incoming)
        expect(merged[0].lifecycle).toBe('done')
        expect(merged[0].lifecycleAt).toBe(3000)
    })

    it('lifecycleAt 相等时同样视为陈旧回退（相等 = 同一转换的重复帧）', () => {
        const existing = [createMessage({
            id: 'm1',
            lifecycle: 'pushed',
            lifecycleAt: 2000,
            positionAt: 2000,
        })]
        const incoming = [createMessage({
            id: 'm1',
            lifecycle: 'queued',
            lifecycleAt: 2000,
            positionAt: 1000,
            createdAt: 1000,
        })]

        const merged = mergeMessages(existing, incoming)
        expect(merged[0].lifecycle).toBe('pushed')
        expect(merged[0].lifecycleAt).toBe(2000)
    })

    it('done 收到陈旧 pushed echo 不回退（rank 泛化——非 queued 回退同样防护）', () => {
        // P3 泛化：防护不再只针对回退为 'queued'，任意 rank 更低的陈旧帧（如 in-flight
        // fetch 旧响应 / 陈旧 echo）都不把已终态的行拉回中间态
        const existing = [createMessage({
            id: 'm1',
            lifecycle: 'done',
            lifecycleAt: 3000,
            positionAt: 3000,
        })]
        const incoming = [createMessage({
            id: 'm1',
            lifecycle: 'pushed',
            lifecycleAt: 1000,
            positionAt: 1000,
            createdAt: 1000,
        })]

        const merged = mergeMessages(existing, incoming)
        expect(merged[0].lifecycle).toBe('done')
        expect(merged[0].lifecycleAt).toBe(3000)
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
