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

import { MetadataSchema } from '@mobi/shared'

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

/**
 * resumeSession fork 待激活行（激活协议 spec §5.2 步骤 1 的 hub 侧前提）：
 * resumeToken 必须取 fork 行 metadata.nativeSessionId（预生成 fork id）——CLI 的
 * bootstrapSession 靠 --resume <该值> 经 getSessionByClaudeSessionId 命中 fork 行并复用
 * tag 绑定既有行（不触发 mergeSessions）。改成 parentNativeId 会把 CLI 绑到 parent 行，
 * 触发 fork 行向 parent 的 merge（数据污染）；forkFrom 缺失时的激活退化由 CLI 侧
 * forkFrom 驱动路径兜底（resolveStartSessionId），hub 侧不做特殊改写。
 * 本测试锁定该契约，防止未来把 resumeToken「修正」为 parentNativeId。
 */
describe('SyncEngine.resumeSession fork 待激活行', () => {
    function makeSpawnEngine(): { engine: SyncEngine; store: Store; spawnParams: () => Record<string, unknown> | null; cleanup: () => void } {
        const store = new Store(':memory:')
        let spawnCall: Record<string, unknown> | null = null
        const engineRef: { engine?: SyncEngine } = {}

        const fakeSocket = {
            timeout() { return this },
            async emitWithAck(_event: string, payload: { method: string; params: unknown }) {
                if (payload.method.endsWith(':spawn-mobi-session')) {
                    const engine = engineRef.engine!
                    const spawned = engine.getOrCreateSession(
                        'tag-fork-resumed', { path: '/tmp/proj', host: 'h-1' }, null, 'default'
                    )
                    engine.handleSessionAlive({ sid: spawned.id, time: Date.now() })
                    spawnCall = payload.params as Record<string, unknown>
                    return { type: 'success', sessionId: spawned.id }
                }
                return { ok: true }
            },
        }
        const io = {
            of() { return { sockets: new Map([['sock-1', fakeSocket]]) } },
        } as unknown as import('socket.io').Server
        const registry = {
            getSocketIdForMethod(method: string) {
                return method.endsWith(':spawn-mobi-session') ? 'sock-1' : null
            },
        } as unknown as RpcRegistry
        const sseManager = { broadcast: () => {} } as unknown as import('../../src/sse/sseManager').SSEManager
        const engine = new SyncEngine(store, io, registry, sseManager)
        engineRef.engine = engine
        return {
            engine,
            store,
            spawnParams: () => spawnCall,
            cleanup: () => {
                engine.stop()
                store.close()
            },
        }
    }

    test('resumeToken 用 fork 行预生成 nativeSessionId（禁改 parentNativeId）', async () => {
        const h = makeSpawnEngine()
        try {
            // 机器在线（同 namespace，targetMachine 匹配前置）
            h.engine.getOrCreateMachine('machine-1', { host: 'h-1', platform: 'darwin', mobiCliVersion: 'test' }, null, 'default')
            h.engine.handleMachineAlive({ machineId: 'machine-1', time: Date.now() })

            // 建 parent + fork 行（走 forkSession 编排，fork 行 metadata 由 store 层写入）
            const parent = h.engine.getOrCreateSession(
                'fork-resume-parent',
                { path: '/tmp/proj', host: 'h-1', machineId: 'machine-1', nativeSessionId: 'parent-native-1' },
                null,
                'default',
            )
            h.store.messages.addMessage(parent.id, userMsg('第一个问题'), 'l1')
            h.store.messages.addMessage(
                parent.id, agentResult(), null, 'persistent',
                { nativeId: 'anchor-native', nativeSessionId: 'parent-native-1' },
            )
            const forkResult = h.engine.forkSession(parent.id, 'anchor-native', 'default')
            expect(forkResult.ok).toBe(true)
            if (!forkResult.ok) return

            const forkSession = h.engine.getSession(forkResult.sessionId)!
            // fork 行建行时预生成 fork native id（≠ parent 的 native id）
            const forkNativeId = forkSession.metadata?.nativeSessionId
            expect(forkNativeId).toBeTruthy()
            expect(forkNativeId).not.toBe('parent-native-1')

            const result = await h.engine.resumeSession(forkSession.id, 'default')
            expect(result.type).toBe('success')

            const params = h.spawnParams()
            expect(params).toBeTruthy()
            // 契约：resumeToken = fork 行预生成 id（CLI bootstrapSession 据此绑定 fork 行）
            expect(params!.resumeSessionId).toBe(forkNativeId)
            expect(params!.resumeSessionId).not.toBe('parent-native-1')
        } finally {
            h.cleanup()
        }
    })

    test('分叉会话禁止再 fork（服务端兜底，spec §2）', () => {
        const h = makeSpawnEngine()
        try {
            const parent = h.engine.getOrCreateSession(
                'fork-of-fork-parent',
                { path: '/tmp/proj', host: 'h-1', nativeSessionId: 'parent-native-1' },
                null,
                'default',
            )
            h.store.messages.addMessage(parent.id, userMsg('第一个问题'), 'l1')
            h.store.messages.addMessage(
                parent.id, agentResult(), null, 'persistent',
                { nativeId: 'anchor-native', nativeSessionId: 'parent-native-1' },
            )
            const forkResult = h.engine.forkSession(parent.id, 'anchor-native', 'default')
            expect(forkResult.ok).toBe(true)
            if (!forkResult.ok) return

            // 对 fork 行再 fork：web 入口隐藏之外的服务端防线（直调 API）
            h.store.messages.addMessage(
                forkResult.sessionId, agentResult(), null, 'persistent',
                { nativeId: 'fork-anchor-native', nativeSessionId: 'parent-native-1' },
            )
            const again = h.engine.forkSession(forkResult.sessionId, 'fork-anchor-native', 'default')
            expect(again).toEqual({ ok: false, reason: 'fork-of-fork-forbidden' })
        } finally {
            h.cleanup()
        }
    })

    test('resumeSession 失败 → hub 落 forkError 错误态（CLI 离线场景，spec §5.3）', async () => {
        const h = makeSpawnEngine()
        try {
            // 不注册任何在线机器 → resumeSession 走 no_machine_online 失败路径
            const parent = h.engine.getOrCreateSession(
                'fork-offline-parent',
                { path: '/tmp/proj', host: 'h-1', nativeSessionId: 'parent-native-1' },
                null,
                'default',
            )
            h.store.messages.addMessage(parent.id, userMsg('第一个问题'), 'l1')
            h.store.messages.addMessage(
                parent.id, agentResult(), null, 'persistent',
                { nativeId: 'anchor-native', nativeSessionId: 'parent-native-1' },
            )
            const forkResult = h.engine.forkSession(parent.id, 'anchor-native', 'default')
            expect(forkResult.ok).toBe(true)
            if (!forkResult.ok) return

            const result = await h.engine.resumeSession(forkResult.sessionId, 'default')
            expect(result.type).toBe('error')

            // forkError 落档 + forkFrom 保留（未激活判定与删除守卫的依据，shared 契约）
            const forkRow = h.store.sessions.getSession(forkResult.sessionId)!
            const parsed = MetadataSchema.safeParse(forkRow.metadata)
            expect(parsed.success).toBe(true)
            const metadata = parsed.data!
            expect(metadata.forkError?.code).toBe('activation-failed')
            expect(metadata.forkFrom).toBeTruthy()
        } finally {
            h.cleanup()
        }
    })
})

describe('fork 激活翻转补投排队消息', () => {
    test('session-alive 激活翻转时把仍 queued 的消息补发进 CLI 房间（入队广播早于 CLI 进房的时序窗）', () => {
        const store = new Store(':memory:')
        const emits: Array<{ room: string; args: unknown[] }> = []
        const io = {
            of: () => ({
                to: (room: string) => ({
                    emit: (...args: unknown[]) => { emits.push({ room, args }) },
                    sockets: new Map(),
                }),
            }),
        } as unknown as import('socket.io').Server
        const registry = { getSocketIdForMethod() { return null } } as unknown as RpcRegistry
        const sseManager = { broadcast: () => {} } as unknown as import('../../src/sse/sseManager').SSEManager
        const engine = new SyncEngine(store, io, registry, sseManager)
        try {
            const session = engine.getOrCreateSession(
                'fork-redeliver',
                { path: '/tmp/proj', host: 'h-1' },
                null,
                'default',
            )
            // 激活窗口期入队的首条消息（CLI 尚未进房，入队广播必然落空）
            store.messages.addMessage(session.id, userMsg('激活前的首条消息'), 'l-redeliver')

            engine.handleSessionAlive({ sid: session.id, time: Date.now(), running: true })

            const redelivered = emits.filter(e =>
                e.room === `session:${session.id}`
                && (e.args[0] as string) === 'session-update'
                && (e.args[1] as { body: { t: string } }).body.t === 'new-message')
            expect(redelivered).toHaveLength(1)
        } finally {
            engine.stop()
            store.close()
        }
    })
})
