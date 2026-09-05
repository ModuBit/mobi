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
import { RewindDeleteBoundTracker } from '../../src/sync/rewindDeleteBoundTracker'

/**
 * renameSession 单测：验证 sessionCache 更新后 best-effort 同步 RPC 到 CLI。
 * rpcGateway 的细节由 rpcGateway.test.ts 覆盖，这里只验证组合行为。
 */

interface EngineHandle {
    engine: SyncEngine
    store: Store
    /** 捕获 emitWithAck 的 rpc-request 信封 */
    emitCalls: { method: string; params: unknown }[]
    cleanup: () => void
}

/** 构造真实 SyncEngine + 可控 fake io/registry/sse */
function makeEngine(opts: { renameOnline: boolean; emitDelayMs?: number; onlineMethods?: string[] }): EngineHandle {
    const store = new Store(':memory:')
    const emitCalls: { method: string; params: unknown }[] = []

    const fakeSocket = {
        timeout() { return this },
        async emitWithAck(_event: string, payload: { method: string; params: unknown }) {
            if (opts.emitDelayMs) {
                await new Promise(r => setTimeout(r, opts.emitDelayMs))
            }
            emitCalls.push(payload)
            return { ok: true }
        },
    }
    const sockets = new Map<string, unknown>([['sock-1', fakeSocket]])
    const io = {
        of() { return { sockets } },
    } as unknown as import('socket.io').Server

    const registry = {
        getSocketIdForMethod(method: string) {
            if (opts.onlineMethods?.some(m => method.endsWith(`:${m}`))) {
                return 'sock-1'
            }
            if (method.endsWith(':rename-session')) {
                return opts.renameOnline ? 'sock-1' : null
            }
            return null
        },
    } as unknown as RpcRegistry

    const sseManager = { broadcast: () => {} } as unknown as import('../../src/sse/sseManager').SSEManager

    const engine = new SyncEngine(store, io, registry, sseManager)

    return {
        engine,
        store,
        emitCalls,
        cleanup: () => {
            engine.stop()
            store.close()
        },
    }
}

describe('SyncEngine.renameSession', () => {
    test('sessionCache 更新后 fire-and-forget 同步 rename-session RPC 到 CLI', async () => {
        const h = makeEngine({ renameOnline: true })
        try {
            const session = h.engine.getOrCreateSession(
                'tag-rename-rpc-1',
                { path: '/tmp/proj', host: 'h-1' },
                null,
                'default'
            )

            await h.engine.renameSession(session.id, '新标题')

            // 1. Hub DB 已立即更新（不等 RPC）
            const after = h.engine.getSession(session.id)
            expect(after?.metadata?.name).toBe('新标题')

            // 2. RPC 是 fire-and-forget，等一个 tick 让它实际执行
            await new Promise(r => setTimeout(r, 0))
            expect(h.emitCalls).toHaveLength(1)
            expect(h.emitCalls[0].method).toBe(`${session.id}:rename-session`)
            expect(h.emitCalls[0].params).toEqual({ title: '新标题' })
        } finally {
            h.cleanup()
        }
    })

    test('RPC 慢时不阻塞 renameSession 返回 —— fire-and-forget 不 await', async () => {
        const h = makeEngine({ renameOnline: true, emitDelayMs: 300 })
        try {
            const session = h.engine.getOrCreateSession(
                'tag-rename-ff',
                { path: '/tmp/proj', host: 'h-ff' },
                null,
                'default'
            )

            const start = Date.now()
            await h.engine.renameSession(session.id, '标题')
            const elapsed = Date.now() - start

            // renameSession 应在远小于 RPC 延时（300ms）内返回 —— 证明未 await RPC
            expect(elapsed).toBeLessThan(100)

            // RPC 在后台执行，等待后落地
            await new Promise(r => setTimeout(r, 350))
            expect(h.emitCalls).toHaveLength(1)
        } finally {
            h.cleanup()
        }
    })

    test('RPC 失败（CLI 不在线）不阻断 renameSession —— best-effort', async () => {
        const h = makeEngine({ renameOnline: false })
        try {
            const session = h.engine.getOrCreateSession(
                'tag-rename-rpc-2',
                { path: '/tmp/proj', host: 'h-2' },
                null,
                'default'
            )

            // renameSession 应静默吞掉 RPC 错误，不 throw
            await expect(h.engine.renameSession(session.id, '离线标题')).resolves.toBeUndefined()

            // Hub DB 仍然更新成功（RPC 失败不影响本地一致性）
            const after = h.engine.getSession(session.id)
            expect(after?.metadata?.name).toBe('离线标题')

            // RPC 确实尝试过（registry 返回 null → rpcCall throw，emitWithAck 未被调用）
            expect(h.emitCalls).toHaveLength(0)
        } finally {
            h.cleanup()
        }
    })
})

/**
 * rewind 受理上界（M3 fail-safe）：上界在 RPC 前采样，RPC 结果未知（抛错）与受理成功
 * 两条路径都标记——CLI 文件回滚可超 RPC 30s 超时，hub 抛错但 CLI 已继续截断，迟到回报仍需上界防御。
 */
describe('SyncEngine.rewind 受理上界', () => {
    interface RewindHandle {
        engine: SyncEngine
        store: Store
        tracker: RewindDeleteBoundTracker
        sessionId: string
        cleanup: () => void
    }

    /** CLI RPC 行为可控的最小 engine：seed 3 条消息（seq 1..3，受理时点 maxSeq=3） */
    function makeRewindEngine(rpc: 'accepted' | 'rejected' | 'throw'): RewindHandle {
        const store = new Store(':memory:')
        const sessionId = store.sessions.getOrCreateSession('rewind-engine-test', null, null, 'default').id
        for (let i = 1; i <= 3; i++) {
            store.messages.addMessage(sessionId, { role: 'user', content: { text: `m${i}` } })
        }

        const fakeSocket = {
            timeout() { return this },
            async emitWithAck() {
                if (rpc === 'throw') throw new Error('rpc timeout after 30s')
                return rpc === 'accepted'
                    ? { accepted: true }
                    : { accepted: false, reason: 'rewind is already in progress' }
            },
        }
        const sockets = new Map([['sock-1', fakeSocket]])
        const io = { of() { return { sockets } } } as unknown as import('socket.io').Server
        const registry = {
            getSocketIdForMethod(method: string) {
                return method.endsWith(':rewind') ? 'sock-1' : null
            },
        } as unknown as RpcRegistry
        const sseManager = { broadcast: () => {} } as unknown as import('../../src/sse/sseManager').SSEManager

        const tracker = new RewindDeleteBoundTracker()
        const engine = new SyncEngine(store, io, registry, sseManager, tracker)
        return {
            engine, store, tracker, sessionId,
            cleanup: () => {
                engine.stop()
                store.close()
            },
        }
    }

    test('受理成功（accepted）→ 标记受理时点 maxSeq（=3）', async () => {
        const h = makeRewindEngine('accepted')
        try {
            await h.engine.rewind(h.sessionId, 'u1', false)
            expect(h.tracker.consume(h.sessionId)).toBe(3)
        } finally {
            h.cleanup()
        }
    })

    test('RPC 抛错（超时，CLI 结果未知）→ 上界已标记（fail-safe）：CLI 可能已受理并继续截断', async () => {
        const h = makeRewindEngine('throw')
        try {
            await expect(h.engine.rewind(h.sessionId, 'u1', false)).rejects.toThrow('rpc timeout')
            // 迟到的 rewind-truncated 消费到的上界 = 受理时点 maxSeq，不吞受理后新行
            expect(h.tracker.consume(h.sessionId)).toBe(3)
        } finally {
            h.cleanup()
        }
    })

    test('CLI 干净拒绝（accepted:false）→ 不标记（rewind 不会执行，无迟到回报可防御）', async () => {
        const h = makeRewindEngine('rejected')
        try {
            const result = await h.engine.rewind(h.sessionId, 'u1', false) as { accepted: boolean }
            expect(result.accepted).toBe(false)
            expect(h.tracker.consume(h.sessionId)).toBeNull()
        } finally {
            h.cleanup()
        }
    })
})

describe('SyncEngine.handleSessionAlive —— 首次激活补拉 sdkMetadata', () => {
    // 回归：新会话 web 打开页面的首次 metadata GET 常早于 CLI 就绪——阻塞 RPC 失败留空后，
    // 此前再无补拉信号（刷新页面才恢复真实模型/别名）。CLI 首个 session-alive 到达即
    // SDK handler 已注册（connect 时先重放注册再发心跳），此点 fire-and-forget 后台刷新，
    // 内容变化经既有 sdk-metadata-refreshed SSE → web invalidate refetch 闭环。
    test('inactive → active 翻转时后台拉取一次 refreshMetadata', async () => {
        const h = makeEngine({ renameOnline: false, onlineMethods: ['refreshMetadata'] })
        try {
            const session = h.engine.getOrCreateSession(
                'tag-alive-meta-1',
                { path: '/tmp/proj', host: 'h-alive' },
                null,
                'default'
            )

            h.engine.handleSessionAlive({ sid: session.id, time: Date.now(), running: false })
            await new Promise(r => setTimeout(r, 0))

            expect(h.emitCalls.some(c => c.method === `${session.id}:refreshMetadata`)).toBe(true)
        } finally {
            h.cleanup()
        }
    })

    test('已激活会话的后续心跳不重复触发（每次心跳都拉 = RPC 风暴）', async () => {
        const h = makeEngine({ renameOnline: false, onlineMethods: ['refreshMetadata'] })
        try {
            const session = h.engine.getOrCreateSession(
                'tag-alive-meta-2',
                { path: '/tmp/proj', host: 'h-alive2' },
                null,
                'default'
            )

            h.engine.handleSessionAlive({ sid: session.id, time: Date.now(), running: false })
            await new Promise(r => setTimeout(r, 0))
            h.engine.handleSessionAlive({ sid: session.id, time: Date.now() + 1, running: true })
            await new Promise(r => setTimeout(r, 0))

            expect(h.emitCalls.filter(c => c.method.endsWith(':refreshMetadata'))).toHaveLength(1)
        } finally {
            h.cleanup()
        }
    })
})

/**
 * abort stopKind 透传（批次 A：停止 × 队列语义闭环）：
 * - 清队列档（turn-queue / turn-queue-tasks）：hub 层 queued 行就地批量删除 + RPC payload 带 stopKind
 * - 默认档（turn）：只中断当前 turn，队列不动
 */
describe('SyncEngine.abortSession stopKind', () => {
    const WEBAPP_USER = { role: 'user', content: { type: 'text', text: 'hi' }, meta: { sentFrom: 'webapp' } }

    /** CLI RPC（abort）在线的 engine + 1 条 queued 消息 */
    function makeAbortEngine() {
        const store = new Store(':memory:')
        const sessionId = store.sessions.getOrCreateSession('abort-stopkind-test', null, null, 'default').id
        store.messages.addMessage(sessionId, WEBAPP_USER, 'loc-queued')

        const emitCalls: { method: string; params: unknown }[] = []
        const fakeSocket = {
            timeout() { return this },
            async emitWithAck(_event: string, payload: { method: string; params: unknown }) {
                emitCalls.push(payload)
                return { ok: true }
            },
        }
        const sockets = new Map([['sock-1', fakeSocket]])
        const io = { of() { return { sockets } } } as unknown as import('socket.io').Server
        const registry = {
            getSocketIdForMethod(method: string) {
                return method.endsWith(':abort') ? 'sock-1' : null
            },
        } as unknown as RpcRegistry
        const sseManager = { broadcast: () => {} } as unknown as import('../../src/sse/sseManager').SSEManager
        const engine = new SyncEngine(store, io, registry, sseManager)

        return {
            engine, store, sessionId, emitCalls,
            cleanup: () => {
                engine.stop()
                store.close()
            },
        }
    }

    test("清队列档 'turn-queue'：hub queued 行批量删除 + RPC payload 带 stopKind", async () => {
        const h = makeAbortEngine()
        try {
            await h.engine.abortSession(h.sessionId, 'turn-queue')

            expect(h.store.messages.getUnsubmittedLocalMessages(h.sessionId)).toEqual([])

            await new Promise(r => setTimeout(r, 0))
            expect(h.emitCalls).toHaveLength(1)
            expect(h.emitCalls[0].method).toBe(`${h.sessionId}:abort`)
            expect(h.emitCalls[0].params).toEqual({ reason: 'User aborted via Mobi', stopKind: 'turn-queue' })
        } finally {
            h.cleanup()
        }
    })

    test("默认档 'turn'：队列不动，RPC payload 带 stopKind（缺省参数回填）", async () => {
        const h = makeAbortEngine()
        try {
            await h.engine.abortSession(h.sessionId)

            expect(h.store.messages.getUnsubmittedLocalMessages(h.sessionId)).toHaveLength(1)

            await new Promise(r => setTimeout(r, 0))
            expect(h.emitCalls[0].params).toEqual({ reason: 'User aborted via Mobi', stopKind: 'turn' })
        } finally {
            h.cleanup()
        }
    })

    test("清队列档 RPC 抛错（CLI 离线/超时）→ queued 行保留（先受理后批删，少删不误删）", async () => {
        const store = new Store(':memory:')
        const sessionId = store.sessions.getOrCreateSession('abort-rpc-fail-test', null, null, 'default').id
        store.messages.addMessage(sessionId, WEBAPP_USER, 'loc-queued')

        const fakeSocket = {
            timeout() { return this },
            async emitWithAck() {
                throw new Error('cli offline')
            },
        }
        const sockets = new Map([['sock-1', fakeSocket]])
        const io = { of() { return { sockets } } } as unknown as import('socket.io').Server
        const registry = {
            getSocketIdForMethod(method: string) {
                return method.endsWith(':abort') ? 'sock-1' : null
            },
        } as unknown as RpcRegistry
        const sseManager = { broadcast: () => {} } as unknown as import('../../src/sse/sseManager').SSEManager
        const engine = new SyncEngine(store, io, registry, sseManager)

        try {
            await expect(engine.abortSession(sessionId, 'turn-queue')).rejects.toThrow('cli offline')

            // RPC 未受理 → 不批删：queued 行保留（安全方向：少删不误删，重试后仍有得删）
            expect(store.messages.getUnsubmittedLocalMessages(sessionId)).toHaveLength(1)
        } finally {
            engine.stop()
            store.close()
        }
    })
})

/**
 * resume 回放：进程重启后 spawnSession 的 resume 分支必须把 runtimeState 持久化的
 * effort/outputStyle 回放给 CLI（否则回落默认值）。
 */
describe('SyncEngine.resumeSession 回放 runtimeState', () => {
    test('effort 与 outputStyle 均传入 spawn-mobi-session RPC 参数', async () => {
        const store = new Store(':memory:')
        const emitCalls: { method: string; params: unknown }[] = []
        // engine 后建（fakeSocket 构造时尚无引用）：spawn 受理时同步注册新会话并 active，
        // 让 resumeSession 的 waitForSessionActive 立即通过
        const engineRef: { engine?: SyncEngine } = {}

        const fakeSocket = {
            timeout() { return this },
            async emitWithAck(_event: string, payload: { method: string; params: unknown }) {
                emitCalls.push(payload)
                if (payload.method.endsWith(':spawn-mobi-session')) {
                    const engine = engineRef.engine!
                    const spawned = engine.getOrCreateSession(
                        'tag-resumed-new', { path: '/tmp/proj', host: 'h-1' }, null, 'default'
                    )
                    engine.handleSessionAlive({ sid: spawned.id, time: Date.now() })
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
        try {
            // 机器在线（同 namespace）
            engine.getOrCreateMachine('machine-1', { host: 'h-1', platform: 'darwin', mobiCliVersion: 'test' }, null, 'default')
            engine.handleMachineAlive({ machineId: 'machine-1', time: Date.now() })

            // 已结束会话：runtimeState 持久化 effort + outputStyle（keep-alive 落库的终态）
            const session = engine.getOrCreateSession(
                'tag-resume-replay',
                { path: '/tmp/proj', host: 'h-1', machineId: 'machine-1', nativeSessionId: 'native-1' },
                null,
                'default',
                'remote',
                { effort: 'high', outputStyle: 'Concise' }
            )

            const result = await engine.resumeSession(session.id, 'default')
            expect(result.type).toBe('success')

            const spawnCall = emitCalls.find(c => c.method.endsWith(':spawn-mobi-session'))
            expect(spawnCall).toBeTruthy()
            const params = spawnCall!.params as Record<string, unknown>
            expect(params.resumeSessionId).toBe('native-1')
            expect(params.effort).toBe('high')
            expect(params.outputStyle).toBe('Concise')
        } finally {
            engine.stop()
            store.close()
        }
    })
})
