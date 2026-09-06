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
 * SyncEngine.forkSession 单测：验证编排层（锚点/边界/turn 起点校验 → store 事务 → 缓存刷新）。
 * store 层复制细节由 sessionFork.test.ts 覆盖，这里只验证组合行为与各失败分支。
 */

interface EngineHandle {
    engine: SyncEngine
    store: Store
    cleanup: () => void
}

/** 构造真实 SyncEngine + 可控 fake io/registry/sse（同 syncEngine.test.ts 的 makeEngine） */
function makeEngine(): EngineHandle {
    const store = new Store(':memory:')
    const io = {
        of() { return { sockets: new Map() } },
    } as unknown as import('socket.io').Server
    const registry = {
        getSocketIdForMethod() { return null },
    } as unknown as RpcRegistry
    const sseManager = { broadcast: () => {} } as unknown as import('../../src/sse/sseManager').SSEManager
    const engine = new SyncEngine(store, io, registry, sseManager)
    return {
        engine,
        store,
        cleanup: () => {
            engine.stop()
            store.close()
        },
    }
}

const userMsg = (text: string) => ({
    role: 'user',
    content: [{ type: 'text', text }],
    meta: { sentFrom: 'webapp' },
})

const agentResult = () => ({
    role: 'agent',
    content: { type: 'output', data: { type: 'result', subtype: 'success' } },
})

const compactBoundary = () => ({
    role: 'agent',
    content: { type: 'output', data: { type: 'system', subtype: 'compact_boundary' } },
})

/** 建带 native id 的 parent 会话并落两轮 transcript（锚点 = 末条 agent result） */
function seedParent(h: EngineHandle, metadata?: Record<string, unknown>) {
    const parent = h.engine.getOrCreateSession(
        'fork-parent',
        metadata ?? { path: '/tmp/proj', host: 'h-1', nativeSessionId: 'parent-native-1' },
        null,
        'default',
    )
    h.store.messages.addMessage(parent.id, userMsg('第一个问题'), 'l1')                // seq 1
    h.store.messages.addMessage(parent.id, userMsg('第二个问题'), 'l2')                // seq 2
    const anchor = h.store.messages.addMessage(                                       // seq 3（锚点）
        parent.id, agentResult(), null, 'persistent',
        { nativeId: 'anchor-native', nativeSessionId: 'parent-native-1' },
    )
    return { parent, anchor }
}

describe('SyncEngine.forkSession', () => {
    test('happy path：建 fork 会话进缓存 + 时间线 = 溯源消息 + 锚点 turn 复制行', () => {
        const h = makeEngine()
        try {
            const { parent } = seedParent(h)

            const result = h.engine.forkSession(parent.id, 'anchor-native', 'default')
            expect(result.ok).toBe(true)
            if (!result.ok) return

            const forkSession = h.engine.getSession(result.sessionId)
            expect(forkSession).toBeDefined()
            expect(forkSession?.metadata?.nativeSessionId).not.toBe('parent-native-1')
            expect(forkSession?.metadata?.forkFrom).toEqual({
                parentSessionId: parent.id,
                parentNativeId: 'parent-native-1',
                anchorNativeId: 'anchor-native',
            })
            expect(forkSession?.metadata?.forkedFrom).toEqual({ sessionId: parent.id })

            const messages = h.store.messages.getMessages(result.sessionId, 200)
            expect(messages.map(m => m.seq)).toEqual([1, 2, 3])
            expect(JSON.stringify(messages[0].content)).toContain('custom')
        } finally {
            h.cleanup()
        }
    })

    test('锚点在边界之前 → anchor-before-boundary', () => {
        const h = makeEngine()
        try {
            const { parent } = seedParent(h)
            // 边界落在锚点之后：seq4 compact_boundary，指针 = 4 > 锚点 seq3
            h.store.messages.addMessage(parent.id, compactBoundary())
            h.store.contextBoundary.advance(parent.id, h.store.messages.getMaxSeq(parent.id))

            const result = h.engine.forkSession(parent.id, 'anchor-native', 'default')
            expect(result).toEqual({ ok: false, reason: 'anchor-before-boundary' })
        } finally {
            h.cleanup()
        }
    })

    test('锚点 native id 不存在 → anchor-not-found', () => {
        const h = makeEngine()
        try {
            const { parent } = seedParent(h)
            const result = h.engine.forkSession(parent.id, 'no-such-native', 'default')
            expect(result).toEqual({ ok: false, reason: 'anchor-not-found' })
        } finally {
            h.cleanup()
        }
    })

    test('会话不存在 / 跨 namespace → session-not-found', () => {
        const h = makeEngine()
        try {
            const result = h.engine.forkSession('no-such-session', 'anchor-native', 'default')
            expect(result).toEqual({ ok: false, reason: 'session-not-found' })
        } finally {
            h.cleanup()
        }
    })

    test('turn 起点找不到（防御分支）→ turn-start-not-found', () => {
        const h = makeEngine()
        try {
            // 整个 transcript 无 user 行、无边界行 → 找不到 turn 起点
            const parent = h.engine.getOrCreateSession(
                'fork-parent-no-turn-start',
                { path: '/tmp/proj', host: 'h-1', nativeSessionId: 'parent-native-1' },
                null,
                'default',
            )
            h.store.messages.addMessage(
                parent.id, agentResult(), null, 'persistent',
                { nativeId: 'anchor-native', nativeSessionId: 'parent-native-1' },
            )
            const result = h.engine.forkSession(parent.id, 'anchor-native', 'default')
            expect(result).toEqual({ ok: false, reason: 'turn-start-not-found' })
        } finally {
            h.cleanup()
        }
    })

    test('parent 无 nativeSessionId（激活无 resumeToken）→ parent-native-missing', () => {
        const h = makeEngine()
        try {
            const { parent } = seedParent(h, { path: '/tmp/proj', host: 'h-1' })
            const result = h.engine.forkSession(parent.id, 'anchor-native', 'default')
            expect(result).toEqual({ ok: false, reason: 'parent-native-missing' })
        } finally {
            h.cleanup()
        }
    })

    test('fork 行不继承 parent 的 contextBoundarySeq（指针按 fork 自身行回填）', () => {
        const h = makeEngine()
        try {
            const { parent, anchor } = seedParent(h)
            // parent 有边界指针（数值来自 parent 的 seq 序列，对 fork 会话无意义）
            h.store.messages.addMessage(parent.id, compactBoundary())
            h.store.contextBoundary.advance(parent.id, h.store.messages.getMaxSeq(parent.id))
            expect(h.store.contextBoundary.resolve(parent.id)).toBeGreaterThan(anchor.seq - 1)

            // turn 起点即锚点所在 turn 的 user 行（seq2），不受边界行（seq4，在锚点后）影响——
            // 但锚点 seq3 <= 指针 seq4 会先被拒；直接在 store 层落 fork 后断言指针字段不残留
            const forkNativeId = 'fork-native-1'
            const forkResult = h.store.sessionFork.forkSessionAtAnchor({
                parent: h.store.sessions.getSession(parent.id)!,
                anchor,
                turnStartSeq: 2,
                forkNativeId,
                parentNativeId: 'parent-native-1',
            })
            const raw = h.store.sessions.getSession(forkResult.sessionId)!.metadata as Record<string, unknown>
            expect(raw).not.toHaveProperty('contextBoundarySeq')
            // fork 会话自身无边界行 → resolve 回填为 0
            expect(h.store.contextBoundary.resolve(forkResult.sessionId)).toBe(0)
        } finally {
            h.cleanup()
        }
    })
})
