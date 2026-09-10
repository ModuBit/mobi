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

import { describe, test, expect, beforeEach } from 'bun:test'

import { Store } from '../../src/store'
import { registerSessionHandlers, type SessionHandlersDeps } from '../../src/socket/handlers/cli/sessionHandlers'
import { BackgroundTaskTracker } from '../../src/sync/backgroundTaskTracker'
import { SnapshotSync } from '../../src/sync/snapshotSync'
import { RewindDeleteBoundTracker } from '../../src/sync/rewindDeleteBoundTracker'
import type { SyncEvent } from '../../src/sync/syncEngine'

/** webapp 用户消息内容（真实信封） */
const WEBAPP_USER = { role: 'user', content: { type: 'text', text: 'hi' }, meta: { sentFrom: 'webapp' } }

/** 最小 fake socket：按 event 名捕获 handler；同时捕获 room 广播 */
function makeFakeSocket() {
    const handlers = new Map<string, (...args: unknown[]) => void>()
    const updates: { room: string; payload: unknown }[] = []
    return {
        on(event: string, handler: (...args: unknown[]) => void) {
            handlers.set(event, handler)
        },
        to(room: string) {
            return {
                emit(event: string, payload: unknown) {
                    if (event === 'session-update') updates.push({ room, payload })
                },
            }
        },
        emit(event: string, ...args: unknown[]) {
            handlers.get(event)?.(...args)
        },
        updates,
    }
}

function makeDeps(store: Store, opts: { rewindDeleteBoundTracker?: RewindDeleteBoundTracker } = {}) {
    const events: SyncEvent[] = []
    const accessError = { called: false }
    const deps: SessionHandlersDeps = {
        store,
        resolveSessionAccess: (sid: string) => {
            const session = store.sessions.getSession(sid)
            if (session) return { ok: true as const, value: session }
            return { ok: false as const, reason: 'not-found' as const }
        },
        emitAccessError: () => { accessError.called = true },
        backgroundTaskTracker: new BackgroundTaskTracker(),
        snapshotSync: new SnapshotSync(),
        rewindDeleteBoundTracker: opts.rewindDeleteBoundTracker,
        onWebappEvent: (e: SyncEvent) => { events.push(e) },
    }
    // rewind 两段回报事件尚未收录进 shared SyncEventSchema（hub 本地扩展形态），断言侧放宽读取
    const rewindEvents = events as unknown as { type: string; deleteFromSeq?: number; filesRestored?: boolean; error?: string }[]
    return { deps, events, rewindEvents, accessError }
}

describe('message 事件带 metadata', () => {
    let store: Store
    let sid: string

    beforeEach(() => {
        store = new Store(':memory:')
        sid = store.sessions.getOrCreateSession('messages-metadata-test', { path: '/tmp/x' }, null, 'default').id
    })

    test('落库到 metadata 列并广播', () => {
        const fakeSocket = makeFakeSocket()
        const { deps, events } = makeDeps(store)
        registerSessionHandlers(fakeSocket as unknown as Parameters<typeof registerSessionHandlers>[0], deps)

        fakeSocket.emit('session-message', {
            sid,
            message: WEBAPP_USER,
            localId: 'local-1',
            metadata: { nativeId: 'uu-1', nativeSessionId: 'sess-9' },
            category: 'persistent',
        })

        const rows = store.messages.getMessages(sid, 10)
        expect(rows).toHaveLength(1)
        expect(rows[0].metadata).toEqual({ nativeId: 'uu-1', nativeSessionId: 'sess-9' })

        // 落库后广播：room update + SSE message-received，DTO 直出 metadata
        expect(fakeSocket.updates).toHaveLength(1)
        const update = fakeSocket.updates[0].payload as { body: { message: { metadata: unknown } } }
        expect(update.body.message.metadata).toEqual({ nativeId: 'uu-1', nativeSessionId: 'sess-9' })
        expect(events.some(e => e.type === 'message-received')).toBe(true)
    })

    test('无 metadata 的消息照常落库（metadata 列 NULL）', () => {
        const fakeSocket = makeFakeSocket()
        const { deps } = makeDeps(store)
        registerSessionHandlers(fakeSocket as unknown as Parameters<typeof registerSessionHandlers>[0], deps)

        fakeSocket.emit('session-message', { sid, message: WEBAPP_USER, localId: 'local-2' })
        expect(store.messages.getMessages(sid, 10)[0].metadata).toBeNull()
    })
})

describe('messages-facts attached（native session 补写）', () => {
    let store: Store
    let sid: string

    beforeEach(() => {
        store = new Store(':memory:')
        sid = store.sessions.getOrCreateSession('attach-test', { path: '/tmp/x' }, null, 'default').id
    })

    test('补写空缺行并按 message 落库后的模式广播消息更新', () => {
        store.messages.addMessage(sid, WEBAPP_USER, 'local-1', 'persistent', { nativeId: 'u1' })                     // 缺 session
        store.messages.addMessage(sid, WEBAPP_USER, 'local-2', 'persistent', { nativeId: 'u2', nativeSessionId: 'old' }) // 已归属

        const fakeSocket = makeFakeSocket()
        const { deps, events } = makeDeps(store)
        registerSessionHandlers(fakeSocket as unknown as Parameters<typeof registerSessionHandlers>[0], deps)

        fakeSocket.emit('messages-facts', { sid, facts: [{ kind: 'attached', nativeSessionId: 'ns-1' }] })

        const rows = store.messages.getMessages(sid, 10)
        expect(rows.find(r => r.localId === 'local-1')?.metadata?.nativeSessionId).toBe('ns-1')
        expect(rows.find(r => r.localId === 'local-2')?.metadata?.nativeSessionId).toBe('old')

        // 广播只覆盖被补写的行（1 条），DTO metadata 已含新 session id
        expect(fakeSocket.updates).toHaveLength(1)
        const update = fakeSocket.updates[0].payload as { body: { message: { localId: string; metadata: unknown } } }
        expect(update.body.message.localId).toBe('local-1')
        expect(update.body.message.metadata).toEqual({ nativeId: 'u1', nativeSessionId: 'ns-1' })
        expect(events.filter(e => e.type === 'message-received')).toHaveLength(1)
    })

    test('无空缺行 → 不广播', () => {
        store.messages.addMessage(sid, WEBAPP_USER, 'local-1', 'persistent', { nativeId: 'u1', nativeSessionId: 'ns-x' })

        const fakeSocket = makeFakeSocket()
        const { deps, events } = makeDeps(store)
        registerSessionHandlers(fakeSocket as unknown as Parameters<typeof registerSessionHandlers>[0], deps)

        fakeSocket.emit('messages-facts', { sid, facts: [{ kind: 'attached', nativeSessionId: 'ns-1' }] })
        expect(fakeSocket.updates).toHaveLength(0)
        expect(events).toEqual([])
    })

    test('非法载荷（缺 nativeSessionId / 空串 / facts 缺失）→ 忽略', () => {
        const fakeSocket = makeFakeSocket()
        const { deps, accessError } = makeDeps(store)
        registerSessionHandlers(fakeSocket as unknown as Parameters<typeof registerSessionHandlers>[0], deps)

        fakeSocket.emit('messages-facts', { sid, facts: [{ kind: 'attached' }] })
        fakeSocket.emit('messages-facts', { sid, facts: [{ kind: 'attached', nativeSessionId: '' }] })
        fakeSocket.emit('messages-facts', null)
        expect(accessError.called).toBe(false)  // 载荷校验先于 fact 分发，静默忽略
    })

    test('session 不存在 → access error，不落库', () => {
        const fakeSocket = makeFakeSocket()
        const { deps, accessError } = makeDeps(store)
        registerSessionHandlers(fakeSocket as unknown as Parameters<typeof registerSessionHandlers>[0], deps)

        fakeSocket.emit('messages-facts', { sid: 'ghost', facts: [{ kind: 'attached', nativeSessionId: 'ns-1' }] })
        expect(accessError.called).toBe(true)
    })

    test('attached 补写广播携带 backfill 标记（web 端据此只 merge 不 append）', () => {
        store.messages.addMessage(sid, WEBAPP_USER, 'local-1', 'persistent', { nativeId: 'u1' })

        const fakeSocket = makeFakeSocket()
        const { deps, events } = makeDeps(store)
        registerSessionHandlers(fakeSocket as unknown as Parameters<typeof registerSessionHandlers>[0], deps)

        fakeSocket.emit('messages-facts', { sid, facts: [{ kind: 'attached', nativeSessionId: 'ns-1' }] })

        // SSE message-received 带 backfill: true
        const sse = events.find(e => e.type === 'message-received') as { backfill?: boolean }
        expect(sse?.backfill).toBe(true)
        // CLI room new-message 载荷同步携带
        const update = fakeSocket.updates[0].payload as { body: { backfill?: boolean } }
        expect(update.body.backfill).toBe(true)
    })

    test('普通新消息广播不带 backfill 字段（真新消息语义不变）', () => {
        const fakeSocket = makeFakeSocket()
        const { deps, events } = makeDeps(store)
        registerSessionHandlers(fakeSocket as unknown as Parameters<typeof registerSessionHandlers>[0], deps)

        fakeSocket.emit('session-message', {
            sid,
            message: WEBAPP_USER,
            localId: 'local-plain',
        })

        const sse = events.find(e => e.type === 'message-received') as { backfill?: boolean }
        expect(sse?.backfill).toBeUndefined()
    })
})

describe('落库自动补 nativeSessionId（attach 孤儿池源头收敛）', () => {
    let store: Store
    let sid: string

    beforeEach(() => {
        store = new Store(':memory:')
        sid = store.sessions.getOrCreateSession('nsid-autofill-test', { path: '/tmp/x' }, null, 'default').id
    })

    /** 模拟 CLI 本轮上报 native-attached（SDK init / 预生成 id 的 onSessionFound 通道） */
    function reportAttached(fakeSocket: ReturnType<typeof makeFakeSocket>, nsid: string): void {
        fakeSocket.emit('messages-facts', { sid, facts: [{ kind: 'attached', nativeSessionId: nsid }] })
    }

    test('CLI 已上报本轮 nsid → 后续合成行落库即补（不再进孤儿池）', () => {
        const fakeSocket = makeFakeSocket()
        const { deps } = makeDeps(store)
        registerSessionHandlers(fakeSocket as unknown as Parameters<typeof registerSessionHandlers>[0], deps)
        reportAttached(fakeSocket, 'ns-current')

        // 模拟 sendSessionEvent 事件行 / !bash 合成对：无 metadata 落库
        fakeSocket.emit('session-message', {
            sid,
            message: { role: 'agent', content: { type: 'event', data: { type: 'ready' } } },
        })

        expect(store.messages.getMessages(sid, 10)[0].metadata?.nativeSessionId).toBe('ns-current')
    })

    test('resume 的 pre-SDK 窗口：metadata 残留上一时代 nsid 且本轮未上报 → 不得盖旧值（保持 NULL 交由 attach 补写）', () => {
        // resume 轮不预生成 id（claudeRemote pregeneratedSessionId = !startFrom ? ... : undefined），
        // session.metadata.nativeSessionId 在 SDK init 前仍是旧时代值——盲信会把 pre-SDK 窗口内
        // 的合成行永久错绑旧 id，attach（只补 NULL）与 bind（first-write-wins）都无法纠正
        const s = store.sessions.getSession(sid)!
        store.sessions.updateSessionMetadata(sid, { ...(s.metadata as object), nativeSessionId: 'ns-old-era' }, s.metadataVersion, 'default')

        const fakeSocket = makeFakeSocket()
        const { deps } = makeDeps(store)
        registerSessionHandlers(fakeSocket as unknown as Parameters<typeof registerSessionHandlers>[0], deps)

        fakeSocket.emit('session-message', {
            sid,
            message: { role: 'agent', content: { type: 'event', data: { type: 'compact-started' } } },
        })

        expect(store.messages.getMessages(sid, 10)[0].metadata?.nativeSessionId).toBeUndefined()

        // SDK init 上报新 id 后：pre-SDK 窗口的 NULL 行由 attach 补写为真实新 id
        reportAttached(fakeSocket, 'ns-new-era')
        expect(store.messages.getMessages(sid, 10)[0].metadata?.nativeSessionId).toBe('ns-new-era')
    })

    test('消息自带 nsid → 不覆盖（CLI 显式值优先）', () => {
        const fakeSocket = makeFakeSocket()
        const { deps } = makeDeps(store)
        registerSessionHandlers(fakeSocket as unknown as Parameters<typeof registerSessionHandlers>[0], deps)
        reportAttached(fakeSocket, 'ns-current')

        fakeSocket.emit('session-message', {
            sid,
            message: WEBAPP_USER,
            localId: 'local-own',
            metadata: { nativeId: 'uu-1', nativeSessionId: 'ns-native' },
        })

        expect(store.messages.getMessages(sid, 10)[0].metadata?.nativeSessionId).toBe('ns-native')
    })

    test('本轮未上报且消息不自带（首条消息场景）→ 保持 NULL，交由 attach 补写', () => {
        const fakeSocket = makeFakeSocket()
        const { deps } = makeDeps(store)
        registerSessionHandlers(fakeSocket as unknown as Parameters<typeof registerSessionHandlers>[0], deps)

        fakeSocket.emit('session-message', {
            sid,
            message: WEBAPP_USER,
            localId: 'local-first',
            metadata: { nativeId: 'uu-1' },
        })

        expect(store.messages.getMessages(sid, 10)[0].metadata?.nativeSessionId).toBeUndefined()
    })
})

describe('messages-facts acked（isReplay 回显确认）', () => {
    let store: Store
    let sid: string

    beforeEach(() => {
        store = new Store(':memory:')
        sid = store.sessions.getOrCreateSession('ack-test', { path: '/tmp/x' }, null, 'default').id
    })

    test('有效 nativeId → 写 nativeAckAt 并按消息落库后模式广播', () => {
        store.messages.addMessage(sid, WEBAPP_USER, 'local-1', 'persistent', { nativeId: 'uu-1' })

        const fakeSocket = makeFakeSocket()
        const { deps, events } = makeDeps(store)
        registerSessionHandlers(fakeSocket as unknown as Parameters<typeof registerSessionHandlers>[0], deps)

        fakeSocket.emit('messages-facts', { sid, facts: [{ kind: 'acked', nativeId: 'uu-1' }] })

        const row = store.messages.getMessages(sid, 10)[0]
        expect(row.metadata?.nativeAckAt).toBeTypeOf('number')

        // 广播补写行：room update + SSE message-received，DTO metadata 已含 nativeAckAt
        expect(fakeSocket.updates).toHaveLength(1)
        const update = fakeSocket.updates[0].payload as { body: { message: { localId: string; metadata: unknown } } }
        expect(update.body.message.localId).toBe('local-1')
        expect((update.body.message.metadata as Record<string, unknown>).nativeAckAt).toBeTypeOf('number')
        expect(events.filter(e => e.type === 'message-received')).toHaveLength(1)
    })

    test('重复 ack → first-write-wins 不覆盖、不广播', () => {
        store.messages.addMessage(sid, WEBAPP_USER, 'local-1', 'persistent', { nativeId: 'uu-1' })
        store.messages.markMessagesAcked(sid, 'uu-1', 111)

        const fakeSocket = makeFakeSocket()
        const { deps, events } = makeDeps(store)
        registerSessionHandlers(fakeSocket as unknown as Parameters<typeof registerSessionHandlers>[0], deps)

        fakeSocket.emit('messages-facts', { sid, facts: [{ kind: 'acked', nativeId: 'uu-1' }] })
        expect(fakeSocket.updates).toHaveLength(0)
        expect(events).toEqual([])
    })

    test('非法载荷（缺 sid / nativeId 空串）→ 忽略', () => {
        const fakeSocket = makeFakeSocket()
        const { deps, accessError } = makeDeps(store)
        registerSessionHandlers(fakeSocket as unknown as Parameters<typeof registerSessionHandlers>[0], deps)

        fakeSocket.emit('messages-facts', { facts: [{ kind: 'acked', nativeId: 'uu-1' }] })
        fakeSocket.emit('messages-facts', { sid, facts: [{ kind: 'acked', nativeId: '' }] })
        fakeSocket.emit('messages-facts', null)
        expect(accessError.called).toBe(false)
        expect(fakeSocket.updates).toHaveLength(0)
    })

    test('session 不存在 → access error，不落库', () => {
        const fakeSocket = makeFakeSocket()
        const { deps, accessError } = makeDeps(store)
        registerSessionHandlers(fakeSocket as unknown as Parameters<typeof registerSessionHandlers>[0], deps)

        fakeSocket.emit('messages-facts', { sid: 'ghost', facts: [{ kind: 'acked', nativeId: 'uu-1' }] })
        expect(accessError.called).toBe(true)
    })
})

describe('rewind-truncated / rewind-completed（两段回报）', () => {
    let store: Store
    let sid: string

    beforeEach(() => {
        store = new Store(':memory:')
        sid = store.sessions.getOrCreateSession('rewind-report-test', { path: '/tmp/x' }, null, 'default').id
    })

    test('rewind-truncated → 软删除 + SSE 广播', () => {
        for (let i = 1; i <= 5; i++) {
            store.messages.addMessage(
                sid,
                { ...WEBAPP_USER, content: { type: 'text', text: `m${i}` } },
                `local-${i}`, 'persistent', { nativeId: `u${i}` },
            )
        }

        const fakeSocket = makeFakeSocket()
        const { deps, rewindEvents } = makeDeps(store)
        registerSessionHandlers(fakeSocket as unknown as Parameters<typeof registerSessionHandlers>[0], deps)

        fakeSocket.emit('rewind-truncated', { sid, nativeId: 'u3', deleteFromSeq: 3 })

        // seq >= 3 的行已软删除（读取路径过滤后只剩 1、2）
        expect(store.messages.getMessages(sid, 10).map(r => r.seq)).toEqual([1, 2])

        const truncated = rewindEvents.find(e => e.type === 'rewind-truncated')
        expect(truncated).toBeDefined()
        expect(truncated!.deleteFromSeq).toBe(3)
    })

    test('rewind-truncated 带受理上界 → 只删受理时已存在的行（M3：迟到回报不吞新消息）', () => {
        for (let i = 1; i <= 3; i++) {
            store.messages.addMessage(
                sid,
                { ...WEBAPP_USER, content: { type: 'text', text: `m${i}` } },
                `local-${i}`, 'persistent', { nativeId: `u${i}` },
            )
        }
        // 受理时点：最大 seq = 3。之后（Web 超时解锁后）用户又发了 seq 4、5
        for (let i = 4; i <= 5; i++) {
            store.messages.addMessage(
                sid,
                { ...WEBAPP_USER, content: { type: 'text', text: `m${i}` } },
                `local-${i}`, 'persistent', { nativeId: `u${i}` },
            )
        }

        const tracker = new RewindDeleteBoundTracker()
        tracker.markAccepted(sid, 3)
        const fakeSocket = makeFakeSocket()
        const { deps } = makeDeps(store, { rewindDeleteBoundTracker: tracker })
        registerSessionHandlers(fakeSocket as unknown as Parameters<typeof registerSessionHandlers>[0], deps)

        // 迟到回报：deleteFromSeq = 2 → 只删 2..3，4..5（受理后新消息）保留
        fakeSocket.emit('rewind-truncated', { sid, nativeId: 'u2', deleteFromSeq: 2 })
        expect(store.messages.getMessages(sid, 10).map(r => r.seq)).toEqual([1, 4, 5])

        // 新 rewind（不同锚点）未受理（无上界记录）→ 回退无上界删除到尾
        fakeSocket.emit('rewind-truncated', { sid, nativeId: 'u1', deleteFromSeq: 1 })
        expect(store.messages.getMessages(sid, 10).map(r => r.seq)).toEqual([])
    })

    test('重放去重 + ack（M5）：同载荷重复回报不二次软删除/不二次广播，仍回 ack', () => {
        for (let i = 1; i <= 3; i++) {
            store.messages.addMessage(
                sid,
                { ...WEBAPP_USER, content: { type: 'text', text: `m${i}` } },
                `local-${i}`, 'persistent', { nativeId: `u${i}` },
            )
        }
        const tracker = new RewindDeleteBoundTracker()
        const fakeSocket = makeFakeSocket()
        const { deps, events } = makeDeps(store, { rewindDeleteBoundTracker: tracker })
        registerSessionHandlers(fakeSocket as unknown as Parameters<typeof registerSessionHandlers>[0], deps)

        const ack1 = { called: false }
        fakeSocket.emit('rewind-truncated', { sid, nativeId: 'u2', deleteFromSeq: 2 }, () => { ack1.called = true })
        expect(ack1.called).toBe(true)
        expect(store.messages.getMessages(sid, 10).map(r => r.seq)).toEqual([1])
        expect(events.filter(e => e.type === 'rewind-truncated')).toHaveLength(1)

        // CLI 可靠队列重放（ack 丢失场景）：原样重发 → 幂等跳过 + ack
        const ack2 = { called: false }
        fakeSocket.emit('rewind-truncated', { sid, nativeId: 'u2', deleteFromSeq: 2 }, () => { ack2.called = true })
        expect(ack2.called).toBe(true)
        expect(events.filter(e => e.type === 'rewind-truncated')).toHaveLength(1)

        // completed 同样回 ack（重放由 web 守卫消化，hub 不去重）
        const ack3 = { called: false }
        fakeSocket.emit('rewind-completed', { sid, filesRestored: true }, () => { ack3.called = true })
        expect(ack3.called).toBe(true)
        expect(events.filter(e => e.type === 'rewind-completed')).toHaveLength(1)
    })

    test('非法载荷 / session 不存在 → 仍回 ack（重试无价值，防 CLI 队列死循环）', () => {
        const fakeSocket = makeFakeSocket()
        const { deps } = makeDeps(store)
        registerSessionHandlers(fakeSocket as unknown as Parameters<typeof registerSessionHandlers>[0], deps)

        const acks: boolean[] = []
        fakeSocket.emit('rewind-truncated', { sid, nativeId: 'u1' }, () => { acks.push(true) })
        fakeSocket.emit('rewind-truncated', { sid: 'ghost', nativeId: 'u1', deleteFromSeq: 1 }, () => { acks.push(true) })
        fakeSocket.emit('rewind-completed', { sid: 'ghost', filesRestored: true }, () => { acks.push(true) })
        expect(acks).toEqual([true, true, true])
    })

    test('rewind-completed → SSE 广播终态（含 filesRestored 与 error）', () => {
        const fakeSocket = makeFakeSocket()
        const { deps, rewindEvents } = makeDeps(store)
        registerSessionHandlers(fakeSocket as unknown as Parameters<typeof registerSessionHandlers>[0], deps)

        fakeSocket.emit('rewind-completed', { sid, filesRestored: false, error: 'rewindFiles failed' })

        const completed = rewindEvents.find(e => e.type === 'rewind-completed')
        expect(completed).toBeDefined()
        expect(completed!.filesRestored).toBe(false)
        expect(completed!.error).toBe('rewindFiles failed')
    })

    test('非法载荷 → 忽略且不触发软删除', () => {
        for (let i = 1; i <= 2; i++) {
            store.messages.addMessage(sid, WEBAPP_USER, `local-${i}`)
        }
        const fakeSocket = makeFakeSocket()
        const { deps, events, accessError } = makeDeps(store)
        registerSessionHandlers(fakeSocket as unknown as Parameters<typeof registerSessionHandlers>[0], deps)

        fakeSocket.emit('rewind-truncated', { sid, nativeId: 'u1' })                          // 缺 deleteFromSeq
        fakeSocket.emit('rewind-truncated', { sid, nativeId: 'u1', deleteFromSeq: NaN })      // 非有限数
        fakeSocket.emit('rewind-truncated', { sid, nativeId: 'u1', deleteFromSeq: 0 })        // 下界：0 会命中全部行
        fakeSocket.emit('rewind-truncated', { sid, nativeId: 'u1', deleteFromSeq: -1 })       // 负数
        fakeSocket.emit('rewind-truncated', { sid, nativeId: 'u1', deleteFromSeq: 1.5 })      // 小数（非整数）
        fakeSocket.emit('rewind-completed', { sid })                                            // 缺 filesRestored
        fakeSocket.emit('rewind-completed', { sid, filesRestored: 'yes' })                      // 类型错
        expect(store.messages.getMessages(sid, 10)).toHaveLength(2)
        expect(events).toEqual([])
        expect(accessError.called).toBe(false)
    })
})
