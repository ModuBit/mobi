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
                    if (event === 'update') updates.push({ room, payload })
                },
            }
        },
        emit(event: string, ...args: unknown[]) {
            handlers.get(event)?.(...args)
        },
        updates,
    }
}

function makeDeps(store: Store) {
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

        fakeSocket.emit('message', {
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

        fakeSocket.emit('message', { sid, message: WEBAPP_USER, localId: 'local-2' })
        expect(store.messages.getMessages(sid, 10)[0].metadata).toBeNull()
    })
})

describe('messages-native-attached', () => {
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

        fakeSocket.emit('messages-native-attached', { sid, nativeSessionId: 'ns-1' })

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

        fakeSocket.emit('messages-native-attached', { sid, nativeSessionId: 'ns-1' })
        expect(fakeSocket.updates).toHaveLength(0)
        expect(events).toEqual([])
    })

    test('非法载荷（缺 nativeSessionId / 空串）→ 忽略', () => {
        const fakeSocket = makeFakeSocket()
        const { deps, accessError } = makeDeps(store)
        registerSessionHandlers(fakeSocket as unknown as Parameters<typeof registerSessionHandlers>[0], deps)

        fakeSocket.emit('messages-native-attached', { sid })
        fakeSocket.emit('messages-native-attached', { sid, nativeSessionId: '' })
        fakeSocket.emit('messages-native-attached', null)
        expect(accessError.called).toBe(false)  // 载荷校验先于 access 检查，静默忽略
    })

    test('session 不存在 → access error，不落库', () => {
        const fakeSocket = makeFakeSocket()
        const { deps, accessError } = makeDeps(store)
        registerSessionHandlers(fakeSocket as unknown as Parameters<typeof registerSessionHandlers>[0], deps)

        fakeSocket.emit('messages-native-attached', { sid: 'ghost', nativeSessionId: 'ns-1' })
        expect(accessError.called).toBe(true)
    })
})

describe('rewound-truncated / rewind-completed（两段回报）', () => {
    let store: Store
    let sid: string

    beforeEach(() => {
        store = new Store(':memory:')
        sid = store.sessions.getOrCreateSession('rewind-report-test', { path: '/tmp/x' }, null, 'default').id
    })

    test('rewound-truncated → 软删除 + SSE 广播', () => {
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

        fakeSocket.emit('rewound-truncated', { sid, nativeId: 'u3', deleteFromSeq: 3 })

        // seq >= 3 的行已软删除（读取路径过滤后只剩 1、2）
        expect(store.messages.getMessages(sid, 10).map(r => r.seq)).toEqual([1, 2])

        const truncated = rewindEvents.find(e => e.type === 'rewound-truncated')
        expect(truncated).toBeDefined()
        expect(truncated!.deleteFromSeq).toBe(3)
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

        fakeSocket.emit('rewound-truncated', { sid, nativeId: 'u1' })                          // 缺 deleteFromSeq
        fakeSocket.emit('rewound-truncated', { sid, nativeId: 'u1', deleteFromSeq: NaN })      // 非有限数
        fakeSocket.emit('rewind-completed', { sid })                                            // 缺 filesRestored
        fakeSocket.emit('rewind-completed', { sid, filesRestored: 'yes' })                      // 类型错
        expect(store.messages.getMessages(sid, 10)).toHaveLength(2)
        expect(events).toEqual([])
        expect(accessError.called).toBe(false)
    })
})
