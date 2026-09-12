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
import { registerSessionHandlers } from '../../src/socket/handlers/cli/sessionHandlers'
import type { SessionHandlersDeps } from '../../src/socket/handlers/cli/sessionHandlers'
import { BackgroundTaskTracker } from '../../src/sync/backgroundTaskTracker'
import { SnapshotSync } from '../../src/sync/snapshotSync'
import { Store } from '../../src/store'
import type { StoredMessage, StoredSession } from '../../src/store/types'
import type { SyncEvent } from '../../src/sync/syncEngine'

/** 构造最小 StoredSession mock（仅含必要字段） */
function makeStoredSession(sid: string): StoredSession {
    return {
        id: sid, tag: null, namespace: 'default', machineId: null,
        createdAt: 1, updatedAt: 1, metadata: null, metadataVersion: 0,
        agentState: null, agentStateVersion: 0, runtimeState: null,
        runtimeStateUpdatedAt: null, projectId: null, pinned: false, seq: 1,
    }
}

/** 构造 StoredMessage mock */
function makeMsg(id: string, localId: string | null, seq: number): StoredMessage {
    return {
        id, sessionId: 's1', content: {}, createdAt: seq, seq,
        localId, metadata: null, deletedAt: null, isSidechain: false, parentToolUseId: null,
        category: 'persistent', lifecycleAt: null,
        lifecycle: 'queued', positionAt: seq,
    }
}

/**
 * 最小化 fake socket：按 event 名捕获 handler，便于直接触发 session-end。
 * registerSessionHandlers 注册多个 handler，我们只关心 session-end。
 */
function makeFakeSocket() {
    const handlers = new Map<string, (...args: unknown[]) => void>()
    const updates: { event: string; payload: unknown }[] = []
    return {
        updates,
        on(event: string, handler: (...args: unknown[]) => void) {
            handlers.set(event, handler)
        },
        to() {
            return {
                emit(event: string, payload: unknown) {
                    updates.push({ event, payload })
                },
            }
        },
        emit(event: string, ...args: unknown[]) {
            handlers.get(event)?.(...args)
        },
    }
}

/**
 * 构造 SessionHandlersDeps，注入可控的 messages mock 与事件捕获。
 * markInvokedSpy 捕获 markMessagesPushed 的参数。
 */
function makeDeps(opts: {
    unsubmitted: StoredMessage[]
    markPushedReturn: { localIds: string[]; positionAt: number }
    sessionOk?: boolean
}): { deps: SessionHandlersDeps; events: SyncEvent[]; markInvokedSpy: { args: { sid: string; lids: string[]; at: number } | null }; accessError: { called: boolean } } {
    const events: SyncEvent[] = []
    const markInvokedSpy = { args: null as { sid: string; lids: string[]; at: number } | null }
    const accessError = { called: false }

    const deps: SessionHandlersDeps = {
        store: {
            messages: {
                getUnsubmittedLocalMessages: () => opts.unsubmitted,
                markMessagesPushed: (sid: string, lids: string[], at: number) => {
                    markInvokedSpy.args = { sid, lids, at }
                    return opts.markPushedReturn
                },
            },
            sessions: {},
        } as unknown as SessionHandlersDeps['store'],
        resolveSessionAccess: (sid: string) => {
            if (opts.sessionOk === false) return { ok: false, reason: 'not-found' as const }
            return { ok: true as const, value: makeStoredSession(sid) }
        },
        emitAccessError: () => { accessError.called = true },
        backgroundTaskTracker: new BackgroundTaskTracker(),
        snapshotSync: new SnapshotSync(),
        onWebappEvent: (e: SyncEvent) => { events.push(e) },
    }

    return { deps, events, markInvokedSpy, accessError }
}

describe('session-end：CLI 离线时 force-invoke 排队消息', () => {
    test('有 unsubmitted local 消息 → 全部 submit + 广播 messages-submitted', () => {
        const fakeSocket = makeFakeSocket()
        const { deps, events, markInvokedSpy } = makeDeps({
            unsubmitted: [makeMsg('m1', 'loc-1', 1), makeMsg('m2', 'loc-2', 2)],
            markPushedReturn: { localIds: ['loc-1', 'loc-2'], positionAt: 1000 },
        })

        registerSessionHandlers(fakeSocket as unknown as Parameters<typeof registerSessionHandlers>[0], deps)
        fakeSocket.emit('session-end', { sid: 's1', time: Date.now() })

        // markMessagesPushed 被调用，localId 全部传入
        expect(markInvokedSpy.args).not.toBeNull()
        expect(markInvokedSpy.args!.sid).toBe('s1')
        expect(markInvokedSpy.args!.lids).toEqual(['loc-1', 'loc-2'])

        // 广播 messages-submitted
        expect(events).toHaveLength(1)
        const evt = events[0] as Extract<SyncEvent, { type: 'messages-submitted' }>
        expect(evt.type).toBe('messages-submitted')
        expect(evt.sessionId).toBe('s1')
        expect(evt.localIds).toEqual(['loc-1', 'loc-2'])
    })

    test('无 unsubmitted local 消息 → 不 invoke、不广播', () => {
        const fakeSocket = makeFakeSocket()
        const { deps, events, markInvokedSpy } = makeDeps({ unsubmitted: [], markPushedReturn: { localIds: [], positionAt: 0 } })

        registerSessionHandlers(fakeSocket as unknown as Parameters<typeof registerSessionHandlers>[0], deps)
        fakeSocket.emit('session-end', { sid: 's1', time: Date.now() })

        expect(markInvokedSpy.args).toBeNull()
        expect(events).toHaveLength(0)
    })

    test('部分 localId 为 null 被 filter 掉', () => {
        const fakeSocket = makeFakeSocket()
        const { deps, events, markInvokedSpy } = makeDeps({
            unsubmitted: [makeMsg('m1', 'loc-1', 1), makeMsg('m2', null, 2)],
            markPushedReturn: { localIds: ['loc-1'], positionAt: 1000 },
        })

        registerSessionHandlers(fakeSocket as unknown as Parameters<typeof registerSessionHandlers>[0], deps)
        fakeSocket.emit('session-end', { sid: 's1', time: Date.now() })

        // null localId 被 filter 掉，只有 loc-1 传入
        expect(markInvokedSpy.args!.lids).toEqual(['loc-1'])
        expect(events).toHaveLength(1)
        expect((events[0] as Extract<SyncEvent, { type: 'messages-submitted' }>).localIds).toEqual(['loc-1'])
    })

    test('session 不存在 → resolveSessionAccess 失败，不 invoke', () => {
        const fakeSocket = makeFakeSocket()
        const { deps, events, markInvokedSpy, accessError } = makeDeps({
            unsubmitted: [],
            markPushedReturn: { localIds: [], positionAt: 0 },
            sessionOk: false,
        })

        registerSessionHandlers(fakeSocket as unknown as Parameters<typeof registerSessionHandlers>[0], deps)
        fakeSocket.emit('session-end', { sid: 'unknown', time: Date.now() })

        expect(accessError.called).toBe(true)
        expect(markInvokedSpy.args).toBeNull()
        expect(events).toHaveLength(0)
    })

    test('markMessagesPushed 返回空（竞态：被别处先 invoke）→ 不广播', () => {
        const fakeSocket = makeFakeSocket()
        const { deps, events } = makeDeps({
            unsubmitted: [makeMsg('m1', 'loc-1', 1)],
            markPushedReturn: { localIds: [], positionAt: 0 },  // 竞态：UPDATE 时已被 invoke
        })

        registerSessionHandlers(fakeSocket as unknown as Parameters<typeof registerSessionHandlers>[0], deps)
        fakeSocket.emit('session-end', { sid: 's1', time: Date.now() })

        // fresh.length === 0 → 不广播（防幽灵消息）
        expect(events).toHaveLength(0)
    })
})

describe('goal-status：CLI 上报 goal 状态 → 校验 + 委派 onGoalStatus', () => {
    /** 构造 goal-status 专用 deps，捕获 onGoalStatus 回调与 accessError */
    function makeGoalDeps(opts: { sessionOk?: boolean } = {}) {
        const captured: { sid: string; goalStatus: unknown }[] = []
        const accessError = { called: false }
        const deps: SessionHandlersDeps = {
            store: { sessions: {}, messages: {} } as unknown as SessionHandlersDeps['store'],
            resolveSessionAccess: (sid: string) => {
                if (opts.sessionOk === false) return { ok: false, reason: 'not-found' as const }
                return { ok: true as const, value: makeStoredSession(sid) }
            },
            emitAccessError: () => { accessError.called = true },
            backgroundTaskTracker: new BackgroundTaskTracker(),
            snapshotSync: new SnapshotSync(),
            factsSink: { handleGoalStatus: (payload: { sid: string; goalStatus: unknown }) => { captured.push(payload) } },
        }
        return { deps, captured, accessError }
    }

    test('合法 goalStatus 对象 → onGoalStatus 被调用，透传 payload', () => {
        const fakeSocket = makeFakeSocket()
        const { deps, captured, accessError } = makeGoalDeps()
        registerSessionHandlers(fakeSocket as unknown as Parameters<typeof registerSessionHandlers>[0], deps)

        fakeSocket.emit('goal-status', { sid: 's1', goalStatus: { met: false, condition: 'x' } })

        expect(captured).toHaveLength(1)
        expect(captured[0].sid).toBe('s1')
        expect(captured[0].goalStatus).toEqual({ met: false, condition: 'x' })
        expect(accessError.called).toBe(false)
    })

    test('goalStatus:null（清空）→ onGoalStatus 透传 null', () => {
        const fakeSocket = makeFakeSocket()
        const { deps, captured } = makeGoalDeps()
        registerSessionHandlers(fakeSocket as unknown as Parameters<typeof registerSessionHandlers>[0], deps)

        fakeSocket.emit('goal-status', { sid: 's1', goalStatus: null })

        expect(captured).toHaveLength(1)
        expect(captured[0].goalStatus).toBeNull()
    })

    test('非法 payload（sid 非字符串）→ 静默丢弃，不调 onGoalStatus', () => {
        const fakeSocket = makeFakeSocket()
        const { deps, captured } = makeGoalDeps()
        registerSessionHandlers(fakeSocket as unknown as Parameters<typeof registerSessionHandlers>[0], deps)

        fakeSocket.emit('goal-status', { sid: 123, goalStatus: { met: false, condition: 'x' } })

        expect(captured).toHaveLength(0)
    })

    test('非法 goalStatus（基本类型而非对象）→ 静默丢弃', () => {
        const fakeSocket = makeFakeSocket()
        const { deps, captured } = makeGoalDeps()
        registerSessionHandlers(fakeSocket as unknown as Parameters<typeof registerSessionHandlers>[0], deps)

        // goalStatus 必须是 null 或对象；字符串/数字/布尔均非法
        fakeSocket.emit('goal-status', { sid: 's1', goalStatus: 'met' as unknown })

        expect(captured).toHaveLength(0)
    })

    test('未知 sid → emitAccessError，不调 onGoalStatus', () => {
        const fakeSocket = makeFakeSocket()
        const { deps, captured, accessError } = makeGoalDeps({ sessionOk: false })
        registerSessionHandlers(fakeSocket as unknown as Parameters<typeof registerSessionHandlers>[0], deps)

        fakeSocket.emit('goal-status', { sid: 'unknown', goalStatus: { met: false, condition: 'x' } })

        expect(captured).toHaveLength(0)
        expect(accessError.called).toBe(true)
    })
})

describe('context-usage：CLI 上报水位 → 校验 + 委派 onContextUsage', () => {
    /** 构造 context-usage 专用 deps，捕获 onContextUsage 回调与 accessError */
    function makeUsageDeps(opts: { sessionOk?: boolean } = {}) {
        const captured: { sid: string; contextUsage: unknown }[] = []
        const accessError = { called: false }
        const deps: SessionHandlersDeps = {
            store: { sessions: {}, messages: {} } as unknown as SessionHandlersDeps['store'],
            resolveSessionAccess: (sid: string) => {
                if (opts.sessionOk === false) return { ok: false, reason: 'not-found' as const }
                return { ok: true as const, value: makeStoredSession(sid) }
            },
            emitAccessError: () => { accessError.called = true },
            backgroundTaskTracker: new BackgroundTaskTracker(),
            snapshotSync: new SnapshotSync(),
            factsSink: { handleContextUsage: (payload: { sid: string; contextUsage: unknown }) => { captured.push(payload) } },
        }
        return { deps, captured, accessError }
    }

    test('合法 contextUsage → onContextUsage 被调用', () => {
        const fakeSocket = makeFakeSocket()
        const { deps, captured, accessError } = makeUsageDeps()
        registerSessionHandlers(fakeSocket as unknown as Parameters<typeof registerSessionHandlers>[0], deps)

        fakeSocket.emit('context-usage', {
            sid: 's1',
            contextUsage: { totalTokens: 128943, maxTokens: 1_000_000, percentage: 12.9, costUsd: 0.5 },
        })

        expect(captured).toHaveLength(1)
        expect(captured[0].contextUsage).toEqual({ totalTokens: 128943, maxTokens: 1_000_000, percentage: 12.9, costUsd: 0.5 })
        expect(accessError.called).toBe(false)
    })

    test('contextUsage:null（清空）→ onContextUsage 透传 null', () => {
        const fakeSocket = makeFakeSocket()
        const { deps, captured } = makeUsageDeps()
        registerSessionHandlers(fakeSocket as unknown as Parameters<typeof registerSessionHandlers>[0], deps)

        fakeSocket.emit('context-usage', { sid: 's1', contextUsage: null })

        expect(captured).toHaveLength(1)
        expect(captured[0].contextUsage).toBeNull()
    })

    test('malformed contextUsage（空对象，缺必填字段）→ 静默丢弃，防落库 + SSE 推 web 崩溃', () => {
        const fakeSocket = makeFakeSocket()
        const { deps, captured } = makeUsageDeps()
        registerSessionHandlers(fakeSocket as unknown as Parameters<typeof registerSessionHandlers>[0], deps)

        // 旧版仅 typeof object 校验时 {} 会透传 → web ContextRing 读 costUsd.toFixed 崩 composer
        fakeSocket.emit('context-usage', { sid: 's1', contextUsage: {} })

        expect(captured).toHaveLength(0)
    })

    test('malformed contextUsage（基本类型而非对象）→ 静默丢弃', () => {
        const fakeSocket = makeFakeSocket()
        const { deps, captured } = makeUsageDeps()
        registerSessionHandlers(fakeSocket as unknown as Parameters<typeof registerSessionHandlers>[0], deps)

        fakeSocket.emit('context-usage', { sid: 's1', contextUsage: 128943 as unknown })

        expect(captured).toHaveLength(0)
    })

    test('未知 sid → emitAccessError，不调 onContextUsage', () => {
        const fakeSocket = makeFakeSocket()
        const { deps, captured, accessError } = makeUsageDeps({ sessionOk: false })
        registerSessionHandlers(fakeSocket as unknown as Parameters<typeof registerSessionHandlers>[0], deps)

        fakeSocket.emit('context-usage', { sid: 'unknown', contextUsage: null })

        expect(captured).toHaveLength(0)
        expect(accessError.called).toBe(true)
    })
})

describe('run-started：CLI 轮次起点上报 → 校验 + 委派 onRunStarted', () => {
    /** 构造 run-started 专用 deps，捕获 onRunStarted 回调与 accessError */
    function makeRunDeps(opts: { sessionOk?: boolean } = {}) {
        const captured: { sid: string; runStartedAt: number }[] = []
        const accessError = { called: false }
        const deps: SessionHandlersDeps = {
            store: { sessions: {}, messages: {} } as unknown as SessionHandlersDeps['store'],
            resolveSessionAccess: (sid: string) => {
                if (opts.sessionOk === false) return { ok: false, reason: 'not-found' as const }
                return { ok: true as const, value: makeStoredSession(sid) }
            },
            emitAccessError: () => { accessError.called = true },
            backgroundTaskTracker: new BackgroundTaskTracker(),
            snapshotSync: new SnapshotSync(),
            factsSink: { handleRunStarted: (payload: { sid: string; runStartedAt: number }) => { captured.push(payload) } },
        }
        return { deps, captured, accessError }
    }

    test('合法 payload → onRunStarted 被调用，透传 runStartedAt', () => {
        const fakeSocket = makeFakeSocket()
        const { deps, captured, accessError } = makeRunDeps()
        registerSessionHandlers(fakeSocket as unknown as Parameters<typeof registerSessionHandlers>[0], deps)

        fakeSocket.emit('run-started', { sid: 's1', runStartedAt: 1755800000000 })

        expect(captured).toHaveLength(1)
        expect(captured[0]).toEqual({ sid: 's1', runStartedAt: 1755800000000 })
        expect(accessError.called).toBe(false)
    })

    test('非法 payload（runStartedAt 非有限正数 / sid 非字符串）→ 静默丢弃', () => {
        const fakeSocket = makeFakeSocket()
        const { deps, captured } = makeRunDeps()
        registerSessionHandlers(fakeSocket as unknown as Parameters<typeof registerSessionHandlers>[0], deps)

        fakeSocket.emit('run-started', { sid: 's1', runStartedAt: 'now' as unknown })
        fakeSocket.emit('run-started', { sid: 's1', runStartedAt: -1 })
        fakeSocket.emit('run-started', { sid: 's1', runStartedAt: Number.NaN })
        fakeSocket.emit('run-started', { sid: 123, runStartedAt: 1755800000000 })

        expect(captured).toHaveLength(0)
    })

    test('未知 sid → emitAccessError，不调 onRunStarted', () => {
        const fakeSocket = makeFakeSocket()
        const { deps, captured, accessError } = makeRunDeps({ sessionOk: false })
        registerSessionHandlers(fakeSocket as unknown as Parameters<typeof registerSessionHandlers>[0], deps)

        fakeSocket.emit('run-started', { sid: 'unknown', runStartedAt: 1755800000000 })

        expect(captured).toHaveLength(0)
        expect(accessError.called).toBe(true)
    })
})

describe('receive-readiness：CLI 上报「此刻能不能收消息」→ 校验 + 委派 onReceiveReadiness', () => {
    /** 构造 receive-readiness 专用 deps，捕获 onReceiveReadiness 回调与 accessError。
     *  与其它事实不同，这条只在 hub 内存里翻转（不落库），故断言只到 sink 入参为止 */
    function makeReadinessDeps(opts: { sessionOk?: boolean } = {}) {
        const captured: { sid: string; canReceive: boolean }[] = []
        const accessError = { called: false }
        const deps: SessionHandlersDeps = {
            store: { sessions: {}, messages: {} } as unknown as SessionHandlersDeps['store'],
            resolveSessionAccess: (sid: string) => {
                if (opts.sessionOk === false) return { ok: false, reason: 'not-found' as const }
                return { ok: true as const, value: makeStoredSession(sid) }
            },
            emitAccessError: () => { accessError.called = true },
            backgroundTaskTracker: new BackgroundTaskTracker(),
            snapshotSync: new SnapshotSync(),
            factsSink: { handleReceiveReadiness: (payload: { sid: string; canReceive: boolean }) => { captured.push(payload) } },
        }
        return { deps, captured, accessError }
    }

    test('两种翻转都透传（true 接通 / false 断开）', () => {
        const fakeSocket = makeFakeSocket()
        const { deps, captured, accessError } = makeReadinessDeps()
        registerSessionHandlers(fakeSocket as unknown as Parameters<typeof registerSessionHandlers>[0], deps)

        fakeSocket.emit('receive-readiness', { sid: 's1', canReceive: true })
        fakeSocket.emit('receive-readiness', { sid: 's1', canReceive: false })

        expect(captured).toEqual([
            { sid: 's1', canReceive: true },
            { sid: 's1', canReceive: false },
        ])
        expect(accessError.called).toBe(false)
    })

    test('非法 payload（canReceive 非布尔 / 缺字段 / sid 非字符串）→ 静默丢弃', () => {
        const fakeSocket = makeFakeSocket()
        const { deps, captured } = makeReadinessDeps()
        registerSessionHandlers(fakeSocket as unknown as Parameters<typeof registerSessionHandlers>[0], deps)

        fakeSocket.emit('receive-readiness', { sid: 's1', canReceive: 'true' as unknown })
        fakeSocket.emit('receive-readiness', { sid: 's1' })
        fakeSocket.emit('receive-readiness', { sid: 123 as unknown, canReceive: true })

        expect(captured).toHaveLength(0)
    })

    test('未知 sid → emitAccessError，不转发', () => {
        const fakeSocket = makeFakeSocket()
        const { deps, captured, accessError } = makeReadinessDeps({ sessionOk: false })
        registerSessionHandlers(fakeSocket as unknown as Parameters<typeof registerSessionHandlers>[0], deps)

        fakeSocket.emit('receive-readiness', { sid: 'unknown', canReceive: true })

        expect(captured).toHaveLength(0)
        expect(accessError.called).toBe(true)
    })
})

describe('messages-facts：Socket adapter', () => {
    test('把 module 的存储行 publication 翻译为 room update 与 SSE 事件', () => {
        const fakeSocket = makeFakeSocket()
        const events: SyncEvent[] = []
        const boundMessage: StoredMessage = {
            ...makeMsg('m1', 'loc-1', 1),
            metadata: { nativeId: 'nu-1' },
        }
        const deps: SessionHandlersDeps = {
            store: {
                messages: {
                    bindNativeIds: () => [boundMessage],
                },
                sessions: {},
            } as unknown as SessionHandlersDeps['store'],
            resolveSessionAccess: sid => ({ ok: true as const, value: makeStoredSession(sid) }),
            emitAccessError: () => {},
            backgroundTaskTracker: new BackgroundTaskTracker(),
            snapshotSync: new SnapshotSync(),
            onWebappEvent: event => { events.push(event) },
        }

        registerSessionHandlers(
            fakeSocket as unknown as Parameters<typeof registerSessionHandlers>[0],
            deps,
        )
        fakeSocket.emit('messages-facts', {
            sid: 's1',
            facts: [{ kind: 'bound', localId: 'loc-1', nativeId: 'nu-1' }],
        })

        expect(fakeSocket.updates).toHaveLength(1)
        expect(fakeSocket.updates[0]).toMatchObject({
            event: 'session-update',
            payload: {
                body: {
                    t: 'new-message',
                    sid: 's1',
                    message: { localId: 'loc-1', metadata: { nativeId: 'nu-1' } },
                },
            },
        })
        expect(events).toEqual([{
            type: 'message-received',
            sessionId: 's1',
            message: expect.objectContaining({
                localId: 'loc-1',
                metadata: { nativeId: 'nu-1' },
            }),
        }])
    })

    test('先校验批次外层与会话访问权，再交给 module', () => {
        const fakeSocket = makeFakeSocket()
        const accessErrors: string[] = []
        const deps: SessionHandlersDeps = {
            store: { messages: {}, sessions: {} } as unknown as SessionHandlersDeps['store'],
            resolveSessionAccess: () => ({ ok: false as const, reason: 'not-found' as const }),
            emitAccessError: (_scope, id) => { accessErrors.push(id) },
            backgroundTaskTracker: new BackgroundTaskTracker(),
            snapshotSync: new SnapshotSync(),
        }

        registerSessionHandlers(
            fakeSocket as unknown as Parameters<typeof registerSessionHandlers>[0],
            deps,
        )
        fakeSocket.emit('messages-facts', { facts: [] })
        fakeSocket.emit('messages-facts', { sid: 's1', facts: 'invalid' })
        fakeSocket.emit('messages-facts', { sid: 'missing', facts: [] })

        expect(accessErrors).toEqual(['missing'])
        expect(fakeSocket.updates).toEqual([])
    })
})

describe('session-message：边界消息落库推进 contextBoundarySeq', () => {
    /** system:compact_boundary 输出信封 / context-cleared 事件信封 / 普通 user 信封（真实形态） */
    const compactBoundary = { role: 'agent', content: { type: 'output', data: { type: 'system', subtype: 'compact_boundary' } } }
    const contextCleared = { role: 'agent', content: { id: 'evt-1', type: 'event', data: { type: 'context-cleared' } } }
    const userEnvelope = (text: string) => ({ role: 'user', content: { type: 'text', text }, meta: { sentFrom: 'webapp' } })

    /** 真实 Store 注入（指针写回走完整 metadata CAS 链路），fake socket 只补消息通道 */
    function makeRealStoreDeps() {
        const store = new Store(':memory:')
        const sid = store.sessions.getOrCreateSession('boundary-handler-test', { path: '/tmp/x' }, null, 'default').id
        const events: SyncEvent[] = []
        const deps: SessionHandlersDeps = {
            store,
            resolveSessionAccess: (id: string) => {
                const session = store.sessions.getSession(id)
                return session ? { ok: true as const, value: session } : { ok: false as const, reason: 'not-found' as const }
            },
            emitAccessError: () => {},
            backgroundTaskTracker: new BackgroundTaskTracker(),
            snapshotSync: new SnapshotSync(),
            onWebappEvent: (e: SyncEvent) => { events.push(e) },
        }
        return { store, sid, deps, events }
    }

    /** 读取会话行 metadata 上的边界指针 */
    const readBoundarySeq = (store: Store, sid: string): number | undefined =>
        ((store.sessions.getSession(sid)?.metadata ?? {}) as Record<string, unknown>).contextBoundarySeq as number | undefined

    test('compact_boundary 落库 → 指针 = 该行 seq；之后落库的消息 seq > 指针', () => {
        const fakeSocket = makeFakeSocket()
        const { store, sid, deps, events } = makeRealStoreDeps()
        registerSessionHandlers(fakeSocket as unknown as Parameters<typeof registerSessionHandlers>[0], deps)

        fakeSocket.emit('session-message', { sid, message: userEnvelope('before') })
        fakeSocket.emit('session-message', { sid, message: compactBoundary })
        expect(readBoundarySeq(store, sid)).toBe(2)
        // 指针推进必须广播 session-updated（web fork/rewind 入口读会话摘要的
        // contextBoundarySeq，不广播则不刷新页面时入口不消失）
        const updated = events.find(e => e.type === 'session-updated')
        const updatedMeta = updated && 'data' in updated ? (updated.data as { metadata?: Record<string, unknown> } | null)?.metadata : undefined
        expect(updatedMeta?.contextBoundarySeq).toBe(2)

        fakeSocket.emit('session-message', { sid, message: userEnvelope('after') })
        const afterSeq = store.messages.getMaxSeq(sid)
        expect(afterSeq).toBe(3)
        expect(afterSeq).toBeGreaterThan(readBoundarySeq(store, sid)!)
    })

    test('context-cleared 事件 → 指针推进到当前 MAX(seq)；之后落库的消息 seq > 指针', () => {
        const fakeSocket = makeFakeSocket()
        const { store, sid, deps, events } = makeRealStoreDeps()
        registerSessionHandlers(fakeSocket as unknown as Parameters<typeof registerSessionHandlers>[0], deps)

        fakeSocket.emit('session-message', { sid, message: userEnvelope('before') })
        fakeSocket.emit('session-message', { sid, message: contextCleared })
        expect(readBoundarySeq(store, sid)).toBe(2)
        expect(events.some(e => e.type === 'session-updated')).toBe(true)

        fakeSocket.emit('session-message', { sid, message: userEnvelope('after') })
        expect(store.messages.getMaxSeq(sid)).toBeGreaterThan(readBoundarySeq(store, sid)!)
    })

    test('非边界消息不推进指针', () => {
        const fakeSocket = makeFakeSocket()
        const { store, sid, deps, events } = makeRealStoreDeps()
        registerSessionHandlers(fakeSocket as unknown as Parameters<typeof registerSessionHandlers>[0], deps)

        fakeSocket.emit('session-message', { sid, message: userEnvelope('普通消息') })
        // microcompact_boundary 不是边界（微压缩不换上下文）
        fakeSocket.emit('session-message', {
            sid,
            message: { role: 'agent', content: { type: 'output', data: { type: 'system', subtype: 'microcompact_boundary' } } },
        })

        expect(readBoundarySeq(store, sid)).toBeUndefined()
        expect(events.some(e => e.type === 'session-updated')).toBe(false)
    })
})
