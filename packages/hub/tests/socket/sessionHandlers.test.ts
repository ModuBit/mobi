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
        category: 'persistent', submittedAt: null,
        queueState: 'pending', positionAt: seq,
    }
}

/**
 * 最小化 fake socket：按 event 名捕获 handler，便于直接触发 session-end。
 * registerSessionHandlers 注册多个 handler，我们只关心 session-end。
 */
function makeFakeSocket() {
    const handlers = new Map<string, (...args: unknown[]) => void>()
    return {
        on(event: string, handler: (...args: unknown[]) => void) {
            handlers.set(event, handler)
        },
        to() {
            return { emit() {} }
        },
        emit(event: string, ...args: unknown[]) {
            handlers.get(event)?.(...args)
        },
    }
}

/**
 * 构造 SessionHandlersDeps，注入可控的 messages mock 与事件捕获。
 * markInvokedSpy 捕获 markMessagesSubmitted 的参数。
 */
function makeDeps(opts: {
    unsubmitted: StoredMessage[]
    markInvokedReturn: string[]
    sessionOk?: boolean
}): { deps: SessionHandlersDeps; events: SyncEvent[]; markInvokedSpy: { args: { sid: string; lids: string[]; at: number } | null }; accessError: { called: boolean } } {
    const events: SyncEvent[] = []
    const markInvokedSpy = { args: null as { sid: string; lids: string[]; at: number } | null }
    const accessError = { called: false }

    const deps: SessionHandlersDeps = {
        store: {
            messages: {
                getUnsubmittedLocalMessages: () => opts.unsubmitted,
                markMessagesSubmitted: (sid: string, lids: string[], at: number) => {
                    markInvokedSpy.args = { sid, lids, at }
                    return opts.markInvokedReturn
                },
            },
            sessions: {},
        } as unknown as SessionHandlersDeps['store'],
        resolveSessionAccess: (sid: string) => {
            if (opts.sessionOk === false) return { ok: false, reason: 'not-found' as const }
            return { ok: true as const, value: makeStoredSession(sid) }
        },
        emitAccessError: () => { accessError.called = true },
        onWebappEvent: (e: SyncEvent) => { events.push(e) },
    }

    return { deps, events, markInvokedSpy, accessError }
}

describe('session-end：CLI 离线时 force-invoke 排队消息', () => {
    test('有 unsubmitted local 消息 → 全部 submit + 广播 messages-submitted', () => {
        const fakeSocket = makeFakeSocket()
        const { deps, events, markInvokedSpy } = makeDeps({
            unsubmitted: [makeMsg('m1', 'loc-1', 1), makeMsg('m2', 'loc-2', 2)],
            markInvokedReturn: ['loc-1', 'loc-2'],
        })

        registerSessionHandlers(fakeSocket as unknown as Parameters<typeof registerSessionHandlers>[0], deps)
        fakeSocket.emit('session-end', { sid: 's1', time: Date.now() })

        // markMessagesSubmitted 被调用，localId 全部传入
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
        const { deps, events, markInvokedSpy } = makeDeps({ unsubmitted: [], markInvokedReturn: [] })

        registerSessionHandlers(fakeSocket as unknown as Parameters<typeof registerSessionHandlers>[0], deps)
        fakeSocket.emit('session-end', { sid: 's1', time: Date.now() })

        expect(markInvokedSpy.args).toBeNull()
        expect(events).toHaveLength(0)
    })

    test('部分 localId 为 null 被 filter 掉', () => {
        const fakeSocket = makeFakeSocket()
        const { deps, events, markInvokedSpy } = makeDeps({
            unsubmitted: [makeMsg('m1', 'loc-1', 1), makeMsg('m2', null, 2)],
            markInvokedReturn: ['loc-1'],
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
            markInvokedReturn: [],
            sessionOk: false,
        })

        registerSessionHandlers(fakeSocket as unknown as Parameters<typeof registerSessionHandlers>[0], deps)
        fakeSocket.emit('session-end', { sid: 'unknown', time: Date.now() })

        expect(accessError.called).toBe(true)
        expect(markInvokedSpy.args).toBeNull()
        expect(events).toHaveLength(0)
    })

    test('markMessagesSubmitted 返回空（竞态：被别处先 invoke）→ 不广播', () => {
        const fakeSocket = makeFakeSocket()
        const { deps, events } = makeDeps({
            unsubmitted: [makeMsg('m1', 'loc-1', 1)],
            markInvokedReturn: [],  // 竞态：UPDATE 时已被 invoke
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
            onGoalStatus: (payload: { sid: string; goalStatus: unknown }) => { captured.push(payload) },
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

// ============ teammate 完成出口：tool_result 消费（pending #11/#44）============

describe('message：Agent tool_use → tool_result 驱动 teamState 生命周期', () => {
    type TeamRuntimeState = { teamState?: { members?: Array<{ name: string; status?: string; toolUseIds?: string[] }>; tasks?: Array<{ id: string; status?: string }>; teamName: string } }

    /** 构造带内存态 runtimeState 的 deps：setRuntimeState 写回，模拟 DB 状态演进 */
    function makeTeamDeps() {
        const session = makeStoredSession('s1')
        const runtimeStateRef: { current: TeamRuntimeState | null } = { current: null }
        const events: SyncEvent[] = []
        const deps: SessionHandlersDeps = {
            store: {
                messages: {
                    addMessage: (_sid: string, content: unknown) => ({ ...makeMsg('m', 'loc', 1), content }),
                },
                sessions: {
                    getSession: (_sid: string) => ({ ...session, runtimeState: runtimeStateRef.current }),
                    setRuntimeState: (_sid: string, state: unknown) => {
                        runtimeStateRef.current = state as TeamRuntimeState | null
                        return true
                    },
                },
            } as unknown as SessionHandlersDeps['store'],
            resolveSessionAccess: (sid: string) => ({ ok: true as const, value: { ...session, runtimeState: runtimeStateRef.current } as never }),
            emitAccessError: () => {},
            onWebappEvent: (e: SyncEvent) => { events.push(e) },
        }
        return { deps, runtimeStateRef, events }
    }

    const agentDispatch = {
        sid: 's1', localId: 'loc-1',
        message: {
            role: 'agent',
            content: {
                type: 'output',
                data: {
                    type: 'assistant',
                    message: { content: [{ type: 'tool_use', id: 'tu-1', name: 'Agent', input: { name: 'analyzer', description: '分析任务' } }] },
                },
            },
        },
    }

    const agentResult = {
        sid: 's1', localId: 'loc-2',
        message: {
            role: 'agent',
            content: {
                type: 'output',
                data: {
                    type: 'user',
                    message: { content: [{ type: 'tool_result', tool_use_id: 'tu-1', content: 'done' }] },
                },
            },
        },
    }

    test('tool_use 注册 running member，tool_result 到达后 member completed 且 teamState 自动清空', () => {
        const fakeSocket = makeFakeSocket()
        const { deps, runtimeStateRef } = makeTeamDeps()
        registerSessionHandlers(fakeSocket as unknown as Parameters<typeof registerSessionHandlers>[0], deps)

        // 1. Agent tool_use → member running + task in_progress
        fakeSocket.emit('message', agentDispatch)
        const dispatchState = runtimeStateRef.current?.teamState
        expect(dispatchState).toBeDefined()
        expect(dispatchState!.members).toHaveLength(1)
        expect(dispatchState!.members![0]).toMatchObject({ name: 'analyzer', status: 'running' })
        expect(dispatchState!.members![0].toolUseIds).toEqual(['tu-1'])

        // 2. tool_result → member/task completed → 全 done → teamState 清空
        fakeSocket.emit('message', agentResult)
        expect(runtimeStateRef.current?.teamState).toBeUndefined()
    })

    test('部分完成：仅 analyzer 的 tool_result 到达时保留 coder', () => {
        const fakeSocket = makeFakeSocket()
        const { deps, runtimeStateRef } = makeTeamDeps()
        registerSessionHandlers(fakeSocket as unknown as Parameters<typeof registerSessionHandlers>[0], deps)

        fakeSocket.emit('message', {
            ...agentDispatch,
            message: {
                ...agentDispatch.message,
                content: {
                    type: 'output',
                    data: {
                        type: 'assistant',
                        message: {
                            content: [
                                { type: 'tool_use', id: 'tu-1', name: 'Agent', input: { name: 'analyzer', description: '分析' } },
                                { type: 'tool_use', id: 'tu-2', name: 'Agent', input: { name: 'coder', description: '编码' } },
                            ],
                        },
                    },
                },
            },
        })
        fakeSocket.emit('message', agentResult)

        const state = runtimeStateRef.current?.teamState
        expect(state).toBeDefined()
        const analyzer = state!.members!.find(m => m.name === 'analyzer')
        const coder = state!.members!.find(m => m.name === 'coder')
        expect(analyzer?.status).toBe('completed')
        expect(coder?.status).toBe('running')
    })
})

describe('messages-bound：CLI 上报用户消息 native_id 绑定', () => {
    function makeBoundDeps(opts: { bindReturn: string[]; sessionOk?: boolean }) {
        const events: SyncEvent[] = []
        const bindSpy = { args: null as { sid: string; bindings: { localId: string; metadata: { nativeId: string; nativeSessionId?: string } }[] } | null }
        const accessError = { called: false }
        const deps: SessionHandlersDeps = {
            store: {
                messages: {
                    bindNativeIds: (sid: string, bindings: { localId: string; metadata: { nativeId: string; nativeSessionId?: string } }[]) => {
                        bindSpy.args = { sid, bindings }
                        return opts.bindReturn
                    },
                },
                sessions: {},
            } as unknown as SessionHandlersDeps['store'],
            resolveSessionAccess: (sid: string) =>
                opts.sessionOk === false
                    ? { ok: false, reason: 'not-found' as const }
                    : { ok: true as const, value: makeStoredSession(sid) },
            emitAccessError: () => { accessError.called = true },
            onWebappEvent: (e: SyncEvent) => { events.push(e) },
        }
        return { deps, events, bindSpy, accessError }
    }

    test('合法 bindings → 委托 store.bindNativeIds', () => {
        const fakeSocket = makeFakeSocket()
        const { deps, bindSpy, events } = makeBoundDeps({ bindReturn: ['loc-1'] })
        registerSessionHandlers(fakeSocket as unknown as Parameters<typeof registerSessionHandlers>[0], deps)
        fakeSocket.emit('messages-bound', { sid: 's1', bindings: [{ localId: 'loc-1', metadata: { nativeId: 'uu-1' } }] })
        expect(bindSpy.args!.sid).toBe('s1')
        expect(bindSpy.args!.bindings).toEqual([{ localId: 'loc-1', metadata: { nativeId: 'uu-1' } }])
        // messages-bound 不广播 SSE，仅落库绑定
        expect(events).toEqual([])
    })

    test('session 不存在 → 不 invoke', () => {
        const fakeSocket = makeFakeSocket()
        const { deps, bindSpy, accessError } = makeBoundDeps({ bindReturn: [], sessionOk: false })
        registerSessionHandlers(fakeSocket as unknown as Parameters<typeof registerSessionHandlers>[0], deps)
        fakeSocket.emit('messages-bound', { sid: 'unknown', bindings: [{ localId: 'loc-1', metadata: { nativeId: 'uu-1' } }] })
        expect(accessError.called).toBe(true)
        expect(bindSpy.args).toBeNull()
    })

    test('空 bindings / 非法 payload → 直接忽略', () => {
        const fakeSocket = makeFakeSocket()
        const { deps, bindSpy } = makeBoundDeps({ bindReturn: [] })
        registerSessionHandlers(fakeSocket as unknown as Parameters<typeof registerSessionHandlers>[0], deps)
        fakeSocket.emit('messages-bound', { sid: 's1', bindings: [] })
        fakeSocket.emit('messages-bound', null)
        fakeSocket.emit('messages-bound', { sid: 's1' })
        expect(bindSpy.args).toBeNull()
    })

    test('混入无效元素的 bindings → 只透传有效项（null/缺字段/空串不落库）', () => {
        const fakeSocket = makeFakeSocket()
        const { deps, bindSpy } = makeBoundDeps({ bindReturn: [] })
        registerSessionHandlers(fakeSocket as unknown as Parameters<typeof registerSessionHandlers>[0], deps)
        fakeSocket.emit('messages-bound', {
            sid: 's1',
            bindings: [
                null,
                { localId: 'loc-1', metadata: { nativeId: 'uu-1' } },                 // 有效
                { localId: 'loc-2', metadata: { nativeId: '' } },                     // 空串 nativeId → 占坑，丢弃
                { localId: 'loc-3', metadata: { nativeId: undefined } },              // 缺字段 → bindNativeIds 会抛错，丢弃
                { localId: 'loc-3' },                                                 // 整个 metadata 缺失 → 丢弃
                { localId: '', metadata: { nativeId: 'uu-3' } },                      // 空 localId → 永远匹配不到行，丢弃
                'garbage',
                { localId: 'loc-4', metadata: { nativeId: 'uu-4', nativeSessionId: 'ns-1' } },  // 有效（带 session 归属）
            ],
        })
        expect(bindSpy.args).not.toBeNull()
        expect(bindSpy.args!.bindings).toEqual([
            { localId: 'loc-1', metadata: { nativeId: 'uu-1' } },
            { localId: 'loc-4', metadata: { nativeId: 'uu-4', nativeSessionId: 'ns-1' } },
        ])
    })

    test('全部元素无效 → 不 invoke', () => {
        const fakeSocket = makeFakeSocket()
        const { deps, bindSpy } = makeBoundDeps({ bindReturn: [] })
        registerSessionHandlers(fakeSocket as unknown as Parameters<typeof registerSessionHandlers>[0], deps)
        fakeSocket.emit('messages-bound', { sid: 's1', bindings: [null, { localId: 'loc-1', nativeId: '' }] })
        expect(bindSpy.args).toBeNull()
    })
})
