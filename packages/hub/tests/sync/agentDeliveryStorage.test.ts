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

import { describe, test, expect } from 'bun:test'
import { SyncEngine } from '../../src/sync/syncEngine'
import { Store } from '../../src/store'
import type { RpcRegistry } from '../../src/socket/rpcRegistry'

/**
 * 跨会话投递**落库那一步**的形状（装配点 → MessageService → store 的那条链）。
 *
 * 为什么要在这个高度测：这条链上「不进投递队列」与「不回灌 CLI 房间」两个不变量都由
 * SyncEngine 的装配点表达，而 `agentSessionService` 的用例把 `storeAgentMessage` 整个
 * mock 掉了（只断言「被调用过」）——真正的落库形状此前没有任何回归网，改错是静默的：
 * 消息进了排队轨道 ⇒ Web 上多一条永不会被消费的悬浮消息。
 *
 * 断言刻意**不钉 sentFrom 的取值**：不入队的判据是结构（带跨会话标注，见 shared 的
 * isQueueableUserSubmission 判据②），钉取值会把测试钉在机制上。留下 `localId` 在场的
 * 断言是有意的——有 localId 的 user 消息**本来就会排队**，lifecycle 为 null 只可能来自
 * 来源判据，这条用例因此对判据失效敏感。
 */

interface Handle {
    engine: SyncEngine
    store: Store
    /** CLI 房间 emit 记录（证明「没有回灌」——空数组只有在能录到时才有意义，见正向对照） */
    cliEmits: { event: string; room: string }[]
    /** 投出去的载荷（localId 就是落库行的 local_id，只在 RPC 参数里可见） */
    deliveries: { sessionId: string; messageId: string }[]
    sender: string
    target: string
    cleanup: () => void
}

function makeHandle(): Handle {
    const store = new Store(':memory:')
    const cliEmits: { event: string; room: string }[] = []
    const deliveries: { sessionId: string; messageId: string }[] = []

    const fakeSocket = {
        timeout() { return this },
        async emitWithAck(_event: string, payload: { method: string; params: unknown }) {
            if (payload.method.endsWith(':push-agent-message')) {
                const params = payload.params as { messageId: string }
                deliveries.push({ sessionId: payload.method.split(':')[0], messageId: params.messageId })
                return { status: 'delivered' }
            }
            return { success: false }
        },
    }

    const io = {
        of() {
            return {
                sockets: new Map([['sock-1', fakeSocket]]),
                to(room: string) {
                    return {
                        emit(event: string) {
                            cliEmits.push({ event, room })
                        },
                    }
                },
            }
        },
    } as unknown as import('socket.io').Server

    // 只认 push-agent-message：metadata 补拉那类 RPC 一律「不在线」，省掉无关的异步噪声
    const registry = {
        getSocketIdForMethod(method: string) {
            return method.endsWith(':push-agent-message') ? 'sock-1' : null
        },
    } as unknown as RpcRegistry

    const sseManager = { broadcast: () => {} } as unknown as import('../../src/sse/sseManager').SSEManager

    // path / host 是 MetadataSchema 的必填项——缺了整份 metadata 会被 zod 判废，
    // 于是发件方名字降级成空串（本用例正要断言它落在 meta 上）
    const sender = store.sessions.getOrCreateSession(
        'agent-delivery-sender',
        { path: '/work/a', host: 'mac-a', name: '会话 A' },
        null,
        'default',
    )
    const target = store.sessions.getOrCreateSession(
        'agent-delivery-target',
        { path: '/work/b', host: 'mac-a', name: '会话 B' },
        null,
        'default',
    )

    const engine = new SyncEngine(store, io, registry, sseManager)
    // 目标必须 active（未激活的会话投递会被活性闸挡下），而 active 只在内存里
    engine.handleSessionAlive({ sid: target.id, time: Date.now() })

    return {
        engine,
        store,
        cliEmits,
        deliveries,
        sender: sender.id,
        target: target.id,
        cleanup: () => {
            engine.stop()
            store.close()
        },
    }
}

/** 取某会话唯一一条落库行的 content.meta（这些用例里每个会话只有一条） */
function metaOf(store: Store, sessionId: string): Record<string, unknown> {
    const rows = store.messages.getMessages(sessionId)
    expect(rows).toHaveLength(1)
    const content = rows[0].content as { meta?: Record<string, unknown> }
    return content.meta ?? {}
}

describe('跨会话投递的落库形状', () => {
    test('agent 投递的消息：带来源标注落库，且不进投递队列、不回灌 CLI 房间', async () => {
        const h = makeHandle()
        try {
            const results = await h.engine.agentSessions.sendMessageToSessions('default', h.sender, {
                targets: [h.target],
                content: 'hi from A',
            })

            expect(results).toHaveLength(1)
            expect(results[0].ok).toBe(true)

            const rows = h.store.messages.getMessages(h.target)
            expect(rows).toHaveLength(1)
            // 有 localId 的 user 消息本来会进排队轨道——它是「这条为什么没排队」的对照面
            expect(rows[0].localId).toBe(h.deliveries[0].messageId)
            expect(rows[0].lifecycle).toBeNull()

            // 来源身份落在 meta 上（一条跨会话消息该有的样子）：Web 的「来自 xxx」标签读它
            const meta = metaOf(h.store, h.target)
            expect(meta.crossSession).toEqual({ from: '会话 A' })
            expect(meta.fromSessionId).toBe(h.sender)

            // 投递已由 push-agent-message RPC 完成，再回灌 CLI 房间就是同一句话投两遍
            expect(h.cliEmits).toEqual([])
        } finally {
            h.cleanup()
        }
    })

    /**
     * 正向对照：同一条落库链上，Web 用户提交**应当**排队并回灌 CLI（那是把消息送进
     * CLI 的正常路径）。没有这一条，「cliEmits 为空」与「lifecycle 为 null」都可能只是
     * 探针/落库本身没工作——空断言看不出区别。
     */
    test('对照：Web 用户提交照常入队并回灌 CLI 房间', async () => {
        const h = makeHandle()
        try {
            await h.engine.sendMessage(h.target, {
                content: 'hi from web',
                localId: 'loc-web-1',
                sentFrom: 'webapp',
            })

            const rows = h.store.messages.getMessages(h.target)
            expect(rows).toHaveLength(1)
            expect(rows[0].lifecycle).toBe('queued')
            expect(h.cliEmits.map((e) => e.event)).toEqual(['session-update'])
        } finally {
            h.cleanup()
        }
    })
})
