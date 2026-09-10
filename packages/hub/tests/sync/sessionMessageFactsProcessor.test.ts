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

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

import { Store } from '../../src/store'
import { SessionMessageFactsProcessor, type MessageFactsPublication } from '../../src/sync/sessionMessageFactsProcessor'

const WEBAPP_USER = {
    role: 'user',
    content: [{ type: 'text', text: '消息内容' }],
    meta: { sentFrom: 'webapp' },
}

describe('SessionMessageFactsProcessor', () => {
    let store: Store
    let sessionId: string
    let nowCalls: number
    let processor: SessionMessageFactsProcessor

    beforeEach(() => {
        store = new Store(':memory:')
        sessionId = store.sessions.getOrCreateSession(
            'message-facts-processor',
            { path: '/tmp/message-facts' },
            null,
            'default',
        ).id
        nowCalls = 0
        processor = new SessionMessageFactsProcessor(store, {
            now: () => {
                nowCalls += 1
                return 5_000
            },
        })
    })

    afterEach(() => {
        store.close()
    })

    function addQueued(localId: string, nativeId?: string) {
        return store.messages.addMessage(
            sessionId,
            WEBAPP_USER,
            localId,
            'persistent',
            nativeId ? { nativeId } : null,
        )
    }

    /** process 是惰性生成器，多数用例只需要快照数组——统一在此消费 */
    function processAll(input: Parameters<SessionMessageFactsProcessor['process']>[0]) {
        return [...processor.process(input)]
    }

    test('pushed 事实推进排队消息，并发布存储层实际排序时间', () => {
        addQueued('local-1')

        const publications = processAll({
            sessionId,
            facts: [{ kind: 'pushed', localIds: ['local-1'], at: 1_000 }],
        })

        const row = store.messages.getMessages(sessionId, 10)[0]
        expect(row).toMatchObject({ lifecycle: 'pushed', lifecycleAt: 1_000 })
        expect(publications).toEqual([{
            type: 'messages-submitted',
            sessionId,
            localIds: ['local-1'],
            submittedAt: row.positionAt,
        }])
    })

    test('bound 事实幂等绑定 native id，并返回更新后的消息行', () => {
        addQueued('local-1')

        const first = processAll({
            sessionId,
            facts: [{ kind: 'bound', localId: 'local-1', nativeId: 'native-1' }],
        })
        const duplicate = processAll({
            sessionId,
            facts: [{ kind: 'bound', localId: 'local-1', nativeId: 'native-2' }],
        })

        expect(first).toHaveLength(1)
        expect(first[0]).toMatchObject({
            type: 'stored-messages',
            sessionId,
            messages: [{ localId: 'local-1', metadata: { nativeId: 'native-1' } }],
        })
        expect(duplicate).toEqual([])
    })

    test('attached 事实补写历史行并以 backfill 发布', () => {
        addQueued('local-1', 'native-1')

        const publications = processAll({
            sessionId,
            facts: [{ kind: 'attached', nativeSessionId: 'native-session-1' }],
        })

        expect(publications).toHaveLength(1)
        expect(publications[0]).toMatchObject({
            type: 'stored-messages',
            sessionId,
            backfill: true,
            messages: [{ metadata: { nativeSessionId: 'native-session-1' } }],
        })
    })

    test('attached 建立连接上下文，补齐后续合成消息但不覆盖显式值', () => {
        processAll({
            sessionId,
            facts: [{ kind: 'attached', nativeSessionId: 'native-session-1' }],
        })

        expect(processor.enrichMetadata(sessionId, null)).toEqual({
            nativeSessionId: 'native-session-1',
        })
        expect(processor.enrichMetadata(sessionId, {
            nativeId: 'native-1',
            nativeSessionId: 'explicit-session',
        })).toEqual({
            nativeId: 'native-1',
            nativeSessionId: 'explicit-session',
        })
    })

    test('acked 同时推进 lifecycle 与 nativeAckAt，并广播两次写入的并集', () => {
        addQueued('local-1', 'native-1')
        store.messages.markMessagesPushed(sessionId, ['local-1'], 900)

        const publications = processAll({
            sessionId,
            facts: [{ kind: 'acked', nativeId: 'native-1', at: 1_100 }],
        })

        const row = store.messages.getMessages(sessionId, 10)[0]
        expect(row).toMatchObject({
            lifecycle: 'acked',
            lifecycleAt: 1_100,
            metadata: { nativeId: 'native-1', nativeAckAt: 1_100 },
        })
        expect(publications).toHaveLength(1)
        expect(publications[0]).toMatchObject({
            type: 'stored-messages',
            messages: [{ id: row.id, lifecycle: 'acked' }],
        })
    })

    test('acked 在 nativeAckAt 已存在但 lifecycle 仍可推进时仍发布更新', () => {
        addQueued('local-1', 'native-1')
        store.messages.markMessagesAcked(sessionId, 'native-1', 1_000)
        store.messages.markMessagesPushed(sessionId, ['local-1'], 1_100)

        const publications = processAll({
            sessionId,
            facts: [{ kind: 'acked', nativeId: 'native-1', at: 1_200 }],
        })

        const row = store.messages.getMessages(sessionId, 10)[0]
        expect(row).toMatchObject({
            lifecycle: 'acked',
            lifecycleAt: 1_200,
            metadata: { nativeAckAt: 1_000 },
        })
        expect(publications).toHaveLength(1)
        expect(publications[0]).toMatchObject({
            type: 'stored-messages',
            messages: [{ id: row.id, lifecycle: 'acked' }],
        })
    })

    test('acked 两次写入都无增量时不重复发布', () => {
        addQueued('local-1', 'native-1')
        store.messages.markMessagesPushed(sessionId, ['local-1'], 900)
        processAll({
            sessionId,
            facts: [{ kind: 'acked', nativeId: 'native-1', at: 1_100 }],
        })

        expect(processAll({
            sessionId,
            facts: [{ kind: 'acked', nativeId: 'native-1', at: 1_200 }],
        })).toEqual([])
    })

    test('lifecycle 单调推进，processing 不落档临时 reason，终态才落档', () => {
        addQueued('local-1', 'native-1')

        processAll({
            sessionId,
            facts: [{
                kind: 'lifecycle',
                nativeId: 'native-1',
                state: 'processing',
                terminalReason: 'transient',
                at: 1_200,
            }],
        })
        const publications = processAll({
            sessionId,
            facts: [{
                kind: 'lifecycle',
                nativeId: 'native-1',
                state: 'refused',
                terminalReason: 'policy',
                at: 1_300,
            }],
        })

        const row = store.messages.getMessages(sessionId, 10)[0]
        expect(row).toMatchObject({
            lifecycle: 'refused',
            lifecycleAt: 1_300,
            metadata: { nativeId: 'native-1', terminalReason: 'policy' },
        })
        expect(publications[0]).toMatchObject({
            type: 'stored-messages',
            messages: [{ lifecycle: 'refused', metadata: { terminalReason: 'policy' } }],
        })
    })

    test('withdrawn 软删除锚点及后续行，并返回 composer 回填内容', () => {
        const first = addQueued('local-1', 'native-1')
        store.messages.markMessagesPushed(sessionId, ['local-1'], 900)
        store.messages.addMessage(
            sessionId,
            {
                ...WEBAPP_USER,
                content: [{ type: 'text', text: '派生行' }],
                meta: { sentFrom: 'cli' },
            },
            'derived',
            'persistent',
            null,
        )

        const publications = processAll({
            sessionId,
            facts: [{ kind: 'withdrawn', nativeId: 'native-1', at: 1_400 }],
        })

        expect(store.messages.getMessages(sessionId, 10)).toEqual([])
        expect(publications).toEqual([{
            type: 'message-withdrawn',
            sessionId,
            localId: 'local-1',
            blocks: WEBAPP_USER.content,
            originalText: '消息内容',
        }])
    })

    test('withdrawn 遇到已终态锚点时不删除', () => {
        addQueued('local-1', 'native-1')
        store.messages.advanceMessagesLifecycle(sessionId, 'native-1', 'done', 1_300)

        const publications = processAll({
            sessionId,
            facts: [{ kind: 'withdrawn', nativeId: 'native-1', at: 1_400 }],
        })

        expect(publications).toEqual([])
        expect(store.messages.getMessages(sessionId, 10)).toHaveLength(1)
    })

    test('withdrawn 遇到锚点后仍有 queued 消息时不连带删除', () => {
        addQueued('local-1', 'native-1')
        store.messages.markMessagesPushed(sessionId, ['local-1'], 900)
        addQueued('local-2')

        const publications = processAll({
            sessionId,
            facts: [{ kind: 'withdrawn', nativeId: 'native-1', at: 1_400 }],
        })

        expect(publications).toEqual([])
        expect(store.messages.getMessages(sessionId, 10)).toHaveLength(2)
    })

    test('同一批缺省 at 的事实共用一个 Hub 接收时刻', () => {
        addQueued('local-1')
        addQueued('local-2')

        processAll({
            sessionId,
            facts: [
                { kind: 'pushed', localIds: ['local-1'] },
                { kind: 'pushed', localIds: ['local-2'] },
            ],
        })

        const rows = store.messages.getMessages(sessionId, 10)
        expect(rows.map(row => row.lifecycleAt)).toEqual([5_000, 5_000])
        expect(nowCalls).toBe(1)
    })

    test('bound 事实 nsid 无效时仅省略 nsid，不弃整条绑定', () => {
        addQueued('local-1')

        const publications = [...processor.process({
            sessionId,
            facts: [{ kind: 'bound', localId: 'local-1', nativeId: 'native-1', nativeSessionId: null }],
        })]

        expect(publications).toHaveLength(1)
        expect(publications[0]).toMatchObject({
            type: 'stored-messages',
            messages: [{ localId: 'local-1', metadata: { nativeId: 'native-1' } }],
        })
        const row = store.messages.getMessages(sessionId, 10)[0]
        expect((row?.metadata as Record<string, unknown> | undefined)?.nativeSessionId).toBeUndefined()
    })

    test('批次中途存储异常：先产出已持久化事实的 publication，不被后续异常丢弃', () => {
        addQueued('local-1', 'native-1')
        store.messages.markMessagesPushed(sessionId, ['local-1'], 900)
        addQueued('local-2', 'native-2')

        // 第二条 fact 的 lifecycle 推进抛错，模拟批次中途存储异常
        store.messages.advanceMessagesLifecycle = () => {
            throw new Error('boom')
        }

        const collected: MessageFactsPublication[] = []
        expect(() => {
            for (const publication of processor.process({
                sessionId,
                facts: [
                    { kind: 'acked', nativeId: 'native-1', at: 1_100 },
                    { kind: 'lifecycle', nativeId: 'native-2', state: 'done', at: 1_200 },
                ],
            })) {
                collected.push(publication)
            }
        }).toThrow('boom')

        expect(collected).toHaveLength(1)
        expect(collected[0]).toMatchObject({ type: 'stored-messages' })
        expect(store.messages.getMessages(sessionId, 10)[0]?.lifecycle).toBe('acked')
    })

    test('非法事实字段被忽略，不写库不发布', () => {
        addQueued('local-1')

        const publications = processAll({
            sessionId,
            facts: [
                null,
                { kind: 'pushed', localIds: 'local-1' },
                { kind: 'bound', localId: '', nativeId: 'native-1' },
                { kind: 'attached', nativeSessionId: '' },
                { kind: 'acked', nativeId: '' },
                { kind: 'lifecycle', nativeId: 'native-1', state: 'unknown' },
                { kind: 'lifecycle', nativeId: 'native-1', state: { toString: () => 'done' } },
                { kind: 'withdrawn', nativeId: '' },
                { kind: 'unknown' },
            ],
        })

        expect(publications).toEqual([])
        expect(store.messages.getMessages(sessionId, 10)[0]?.lifecycle).toBe('queued')
    })
})
