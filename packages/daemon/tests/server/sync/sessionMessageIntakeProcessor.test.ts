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
import { SessionMessageIntakeProcessor } from '../../../src/sync/sessionMessageIntakeProcessor'
import { SessionMessageRuntimeProjector } from '../../../src/sync/sessionMessageRuntimeProjector'
import { SnapshotSync } from '../../../src/sync/snapshotSync'
import { BackgroundTaskTracker } from '../../../src/sync/backgroundTaskTracker'
import { RewindDeleteBoundTracker } from '../../../src/sync/rewindDeleteBoundTracker'
import { Store } from '../../../src/store'
import type { SessionMessageIntakePublication } from '../../../src/sync/sessionMessageIntakeProcessor'

const userEnvelope = (text: string) => ({ role: 'user', content: { type: 'text', text }, meta: { sentFrom: 'webapp' } })
const compactBoundary = { role: 'agent', content: { type: 'output', data: { type: 'system', subtype: 'compact_boundary' } } }
const todoEnvelope = {
    role: 'agent',
    content: {
        type: 'output',
        data: {
            type: 'assistant',
            message: { content: [{ type: 'tool_use', id: 'tu-1', name: 'TodoWrite', input: { todos: [{ content: 'x', status: 'pending', activeForm: 'doing x' }] } }] },
        },
    },
}

/** 搭建受理 module（真实 Store / Projector；SnapshotSync 记录 messagePersisted 调用） */
function makeHarness(opts: { enrich?: (sid: string, m: unknown) => unknown; tracker?: RewindDeleteBoundTracker } = {}) {
    const store = new Store(':memory:')
    const sid = store.sessions.getOrCreateSession('intake-test', { path: '/tmp/x' }, null, 'default').id
    const persistedCalls: Array<{ sid: string; localId: string | null }> = []
    const snapshotSync = new SnapshotSync()
    const originalMessagePersisted = snapshotSync.messagePersisted.bind(snapshotSync)
    snapshotSync.messagePersisted = (sessionId: string, localId: string | null) => {
        persistedCalls.push({ sid: sessionId, localId })
        originalMessagePersisted(sessionId, localId)
    }
    const projector = new SessionMessageRuntimeProjector(store, new BackgroundTaskTracker())
    const enrichCalls: Array<{ sid: string; metadata: unknown }> = []
    const processor = new SessionMessageIntakeProcessor(
        store,
        snapshotSync,
        projector,
        (sessionId, metadata) => {
            enrichCalls.push({ sid: sessionId, metadata })
            return opts.enrich?.(sessionId, metadata) as never ?? metadata
        },
        opts.tracker,
    )
    const intake = (input: Partial<Parameters<SessionMessageIntakeProcessor['intake']>[0]> = {}) =>
        [...processor.intake({
            sessionId: sid,
            category: 'persistent',
            content: userEnvelope('hello'),
            metadata: null,
            namespace: 'default',
            ...input,
        })]
    return { store, sid, module: processor, intake, persistedCalls, enrichCalls }
}

const types = (pubs: SessionMessageIntakePublication[]) => pubs.map(p => p.type)

describe('SessionMessageIntakeProcessor：受理规则收口', () => {
    test('常规消息：enricher 补 nsid → 落库行携带；publication 只有 stored-messages', () => {
        const { store, sid, intake, persistedCalls } = makeHarness({
            enrich: (s, m) => ({ ...(m as object), nativeSessionId: 'ns-9' }),
        })

        const pubs = intake({ localId: 'loc-1' })

        expect(types(pubs)).toEqual(['stored-messages'])
        const row = store.messages.getMessages(sid, 10)[0]
        expect(row.metadata).toEqual({ nativeSessionId: 'ns-9' })
        // 快照清理时机：落库后按 localId 清流式快照
        expect(persistedCalls).toEqual([{ sid, localId: 'loc-1' }])
        // stored-messages publication 携带落库行（广播出口与 SSE 同源）
        expect(pubs[0]).toMatchObject({ type: 'stored-messages', sessionId: sid, messages: [row] })
    })

    test('enricher 未补（连接级上下文缺失）→ metadata 保持缺省由 attach 兜底', () => {
        const { store, sid, intake } = makeHarness()

        intake({ metadata: { nativeId: 'uu-1' } })

        expect(store.messages.getMessages(sid, 10)[0].metadata).toEqual({ nativeId: 'uu-1' })
    })

    test('positionBeforeResultId 锚定：position_at = 归属 result 行 position_at - 1', () => {
        const { store, sid, intake } = makeHarness()
        // 先落一条归属 result 行（result 行 nativeId = 落库 localId，data.type='result'）
        const resultContent = { role: 'agent', content: { type: 'output', data: { type: 'result', subtype: 'success' } } }
        store.messages.addMessage(sid, resultContent, 'result-1', 'persistent', null, 5000)
        const anchorRow = store.messages.getMessages(sid, 10).find(r => r.localId === 'result-1')!

        intake({ positionBeforeResultId: 'result-1' })

        const row = store.messages.getMessages(sid, 10).find(r => r.localId !== 'result-1')!
        expect(row.positionAt).toBe(anchorRow.positionAt - 1)
    })

    test('锚查不到（异常时序）→ position_at 退回默认落库时刻（= createdAt）', () => {
        const { store, sid, intake } = makeHarness()

        intake({ positionBeforeResultId: 'ghost-anchor' })

        const row = store.messages.getMessages(sid, 10)[0]
        expect(row.positionAt).toBe(row.createdAt)
    })

    test('边界内容：指针推进到 MAX(seq) 且产出 session-updated publication', () => {
        const { store, sid, intake } = makeHarness()
        intake({ content: userEnvelope('before'), localId: 'l1' })

        const pubs = intake({ content: compactBoundary })

        const boundarySeq = store.messages.getMaxSeq(sid)
        const meta = (store.sessions.getSession(sid)?.metadata ?? {}) as Record<string, unknown>
        expect(meta.contextBoundarySeq).toBe(boundarySeq)
        // 边界推进在 stored-messages 之前广播（与原 handler 顺序一致）
        expect(types(pubs)).toEqual(['session-updated', 'stored-messages'])
        expect(pubs[0]).toMatchObject({ type: 'session-updated', sessionId: sid })
    })

    test('非边界消息不产出 session-updated', () => {
        const { intake } = makeHarness()

        const pubs = intake({ content: userEnvelope('normal') })

        expect(types(pubs)).toEqual(['stored-messages'])
    })

    test('投影编排：TodoWrite 消息 → runtime-state-updated publication（投影顺序在广播前）', () => {
        const { intake } = makeHarness()

        const pubs = intake({ content: todoEnvelope })

        expect(types(pubs)).toEqual(['runtime-state-updated', 'stored-messages'])
        const runtimePub = pubs[0] as Extract<SessionMessageIntakePublication, { type: 'runtime-state-updated' }>
        expect(runtimePub.data.sid).toBeDefined()
        expect(runtimePub.data.runtimeState.todos).toBeInstanceOf(Array)
    })
})

describe('SessionMessageIntakeProcessor.rewindTruncate（rewind 软删受理）', () => {
    /** 落 n 条消息并返回实际 seq 列表（offset 区分批次：localId 是去重键，复用会被吞） */
    const seed = (h: ReturnType<typeof makeHarness>, n: number, offset = 0) => {
        for (let i = 1; i <= n; i++) h.store.messages.addMessage(h.sid, userEnvelope(`m${offset + i}`), `loc-${offset + i}`)
    }

    test('首次回报：消费受理上界，软删 [deleteFromSeq, bound]，受理后新行保留', () => {
        const tracker = new RewindDeleteBoundTracker()
        const h = makeHarness({ tracker })
        seed(h, 3)
        // 受理时点最大 seq=3，受理后新发 seq 4、5（迟到回报窗口）
        tracker.markAccepted(h.sid, 3)
        seed(h, 2, 3)

        const executed = h.module.rewindTruncate({ sessionId: h.sid, nativeId: 'u2', deleteFromSeq: 2 })

        expect(executed).toBe(true)
        expect(h.store.messages.getMessages(h.sid, 10).map(r => r.seq)).toEqual([1, 4, 5])
    })

    test('CLI 可靠队列重放（同 nativeId + deleteFromSeq）→ 幂等跳过（返回 false，不二次软删）', () => {
        const h = makeHarness({ tracker: new RewindDeleteBoundTracker() })
        seed(h, 3)

        expect(h.module.rewindTruncate({ sessionId: h.sid, nativeId: 'u2', deleteFromSeq: 2 })).toBe(true)
        expect(h.module.rewindTruncate({ sessionId: h.sid, nativeId: 'u2', deleteFromSeq: 2 })).toBe(false)
        expect(h.store.messages.getMessages(h.sid, 10).map(r => r.seq)).toEqual([1])
    })

    test('无上界记录（daemon 重启丢内存）→ 回退无上界删除到尾', () => {
        const h = makeHarness({ tracker: new RewindDeleteBoundTracker() })
        seed(h, 3)

        expect(h.module.rewindTruncate({ sessionId: h.sid, nativeId: 'u2', deleteFromSeq: 2 })).toBe(true)
        expect(h.store.messages.getMessages(h.sid, 10).map(r => r.seq)).toEqual([1])
    })

    test('tracker 缺装配 → 仍执行软删（旧行为兜底）', () => {
        const h = makeHarness()
        seed(h, 2)

        expect(h.module.rewindTruncate({ sessionId: h.sid, nativeId: 'u1', deleteFromSeq: 1 })).toBe(true)
        expect(h.store.messages.getMessages(h.sid, 10)).toHaveLength(0)
    })
})
