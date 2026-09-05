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

import { describe, test, expect, beforeEach, afterEach } from 'bun:test'

import { Store } from '../../src/store'
import { SessionCache } from '../../src/sync/sessionCache'
import { registerSessionHandlers, type SessionHandlersDeps } from '../../src/socket/handlers/cli/sessionHandlers'
import { BackgroundTaskTracker } from '../../src/sync/backgroundTaskTracker'
import type { EventPublisher } from '../../src/sync/eventPublisher'

// SessionCache 仅依赖 publisher.emit，用最小 stub
const stubPublisher = { emit: () => {} } as unknown as EventPublisher

const USAGE = { totalTokens: 124000, maxTokens: 200000, percentage: 62, costUsd: 0.043 }

/** assistant TodoWrite tool_use 消息（真实信封形态），todos 含未完成项避免自动清除 */
const TODO_MESSAGE = {
    role: 'agent',
    content: {
        type: 'output',
        data: {
            type: 'assistant',
            message: {
                content: [{
                    type: 'tool_use',
                    id: 'tu-1',
                    name: 'TodoWrite',
                    input: { todos: [{ content: '做一件事', status: 'in_progress', activeForm: '做一件事' }] },
                }],
            },
        },
    },
}

/** 最小 fake socket：捕获 handler；session-message 尾部的 room 广播走 no-op */
function makeFakeSocket() {
    const handlers = new Map<string, (...args: unknown[]) => void>()
    return {
        on(event: string, handler: (...args: unknown[]) => void) {
            handlers.set(event, handler)
        },
        to() {
            return { emit: () => {} }
        },
        emit(event: string, ...args: unknown[]) {
            handlers.get(event)?.(...args)
        },
    }
}

function makeHandlerDeps(store: Store): SessionHandlersDeps {
    return {
        store,
        resolveSessionAccess: (sid: string) => {
            const session = store.sessions.getSession(sid)
            if (session) return { ok: true as const, value: session }
            return { ok: false as const, reason: 'not-found' as const }
        },
        emitAccessError: () => {},
        backgroundTaskTracker: new BackgroundTaskTracker(),
    }
}

function storedRuntimeState(store: Store, sid: string): Record<string, unknown> {
    return (store.sessions.getSession(sid)?.runtimeState ?? {}) as Record<string, unknown>
}

describe('runtime_state 写入收敛（#62 双写竞态丢字段回归）', () => {
    let store: Store
    let cache: SessionCache
    let sid: string

    beforeEach(() => {
        store = new Store(':memory:')
        cache = new SessionCache(store, stubPublisher)
        sid = cache.getOrCreateSession('rs-convergence', { path: '/tmp/x' }, null, 'default').id
    })

    afterEach(() => {
        store.close()
    })

    /**
     * 复现路径：cache 加载内存快照（无 todos）→ session-message 路径直写 DB 落 todos
     * → updateRuntimeStateField 用陈旧内存快照全量覆盖 → todos 被抹掉。
     * 修复后：字段级合并写（读 DB 最新 → patch 合并 → 写回），todos 保留。
     */
    test('session-message 落 todos 后，handleContextUsage 不抹掉 todos', () => {
        // cache 内存快照在此刻加载（runtimeState 空）
        const fakeSocket = makeFakeSocket()
        registerSessionHandlers(fakeSocket as unknown as Parameters<typeof registerSessionHandlers>[0], makeHandlerDeps(store))

        fakeSocket.emit('session-message', { sid, message: TODO_MESSAGE, localId: 'local-1' })
        expect(storedRuntimeState(store, sid).todos).toBeDefined() // 前置：todos 已落库

        cache.handleContextUsage({ sid, contextUsage: USAGE })

        const rs = storedRuntimeState(store, sid)
        expect(rs.contextUsage).toBeDefined()
        expect(rs.todos).toBeDefined() // ← 修复前：被陈旧内存快照全量覆盖抹掉
    })

    test('session-message 落 todos 后，handleSessionEnd 的 teamState 收尾不抹掉 todos', () => {
        // 预置 teamState：让 handleSessionEnd 走 team 收尾分支（该分支也是陈旧内存快照全量覆盖）
        store.sessions.setRuntimeState(sid, { teamState: { teamName: 't-1' } }, Date.now(), 'default')
        cache.refreshSession(sid)

        const fakeSocket = makeFakeSocket()
        registerSessionHandlers(fakeSocket as unknown as Parameters<typeof registerSessionHandlers>[0], makeHandlerDeps(store))
        fakeSocket.emit('session-message', { sid, message: TODO_MESSAGE, localId: 'local-1' })
        expect(storedRuntimeState(store, sid).todos).toBeDefined()

        // session 处于活跃态才会走收尾写入
        cache.handleSessionAlive({ sid, time: Date.now(), running: true })
        cache.handleSessionEnd({ sid, time: Date.now() })

        const rs = storedRuntimeState(store, sid)
        expect(rs.todos).toBeDefined() // ← 修复前：被陈旧内存快照全量覆盖抹掉
    })

    test('handleContextUsage 后内存缓存与 DB 一致（含 DB 侧已有字段）', () => {
        store.sessions.setRuntimeState(sid, { todos: [{ content: 'x', status: 'pending', activeForm: 'x' }] }, Date.now(), 'default')
        cache.refreshSession(sid)

        cache.handleContextUsage({ sid, contextUsage: USAGE })

        expect(cache.getSession(sid)?.runtimeState?.todos).toBeDefined()
        expect(cache.getSession(sid)?.runtimeState?.contextUsage?.percentage).toBe(62)
    })
})

describe('store.sessions.mergeRuntimeState（字段级合并写单点）', () => {
    let store: Store
    let sid: string

    beforeEach(() => {
        store = new Store(':memory:')
        sid = store.sessions.getOrCreateSession('rs-merge-unit', { path: '/tmp/x' }, null, 'default').id
    })

    afterEach(() => {
        store.close()
    })

    test('patch 字段覆盖，未提及字段保留 DB 现值', () => {
        store.sessions.setRuntimeState(sid, { todos: [1], model: 'opus' }, Date.now(), 'default')

        const result = store.sessions.mergeRuntimeState(sid, { model: 'sonnet' }, Date.now(), 'default')

        expect(result).not.toBeNull()
        expect(result!.changed).toBe(true)
        expect(result!.merged).toEqual({ todos: [1], model: 'sonnet' })
        expect(storedRuntimeState(store, sid)).toEqual({ todos: [1], model: 'sonnet' })
    })

    test('patch 值 undefined = 清除该字段', () => {
        store.sessions.setRuntimeState(sid, { contextUsage: { a: 1 }, model: 'opus' }, Date.now(), 'default')

        const result = store.sessions.mergeRuntimeState(sid, { contextUsage: undefined }, Date.now(), 'default')

        expect(result!.merged).toEqual({ model: 'opus' })
        expect(storedRuntimeState(store, sid)).toEqual({ model: 'opus' })
    })

    test('合并结果与现值深等 → changed=false 且不写库（seq 不推进）', () => {
        store.sessions.setRuntimeState(sid, { model: 'opus' }, Date.now(), 'default')
        const seqBefore = store.sessions.getSession(sid)!.seq

        const result = store.sessions.mergeRuntimeState(sid, { model: 'opus' }, Date.now(), 'default')

        expect(result!.changed).toBe(false)
        expect(store.sessions.getSession(sid)!.seq).toBe(seqBefore)
    })

    test('会话不存在 → null', () => {
        expect(store.sessions.mergeRuntimeState('ghost', { model: 'opus' }, Date.now(), 'default')).toBeNull()
    })

    test('namespace 不匹配 → null（不跨租户写）', () => {
        expect(store.sessions.mergeRuntimeState(sid, { model: 'opus' }, Date.now(), 'other')).toBeNull()
    })
})
