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
 * SyncEngine.wakeSession 单测（dormancy spec §B）：休眠会话唤醒 = fire-and-forget
 * 触发 resume spawn（fork 激活同管线）。spawn 选项组装/时序窗处理由 fork 测试与
 * resumeSession 自身覆盖，这里验证 wake 的编排契约：触发、防重入、活跃 no-op、
 * 失败不丢消息。
 */

/** 构造带 spawn 计数的 SyncEngine（spawn fake 同步创建新会话并上报 alive） */
function makeWakeEngine(): {
    engine: SyncEngine
    store: Store
    spawnCalls: () => Record<string, unknown>[]
    cleanup: () => void
} {
    const store = new Store(':memory:')
    const engineRef: { engine?: SyncEngine } = {}
    const calls: Record<string, unknown>[] = []

    const fakeSocket = {
        timeout() { return this },
        async emitWithAck(_event: string, payload: { method: string; params: unknown }) {
            if (payload.method.endsWith(':spawn-mobi-session')) {
                calls.push(payload.params as Record<string, unknown>)
                const engine = engineRef.engine!
                const spawned = engine.getOrCreateSession(
                    `tag-wake-${calls.length}`, { path: '/tmp/proj', host: 'h-1' }, null, 'default'
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
    return {
        engine,
        store,
        spawnCalls: () => calls,
        cleanup: () => {
            engine.stop()
            store.close()
        },
    }
}

/** 在线机器 + 休眠会话（有 machineId/nativeSessionId 的完整 metadata） */
function seedDormantSession(h: ReturnType<typeof makeWakeEngine>) {
    h.engine.getOrCreateMachine('machine-1', { host: 'h-1', platform: 'darwin', mobiCliVersion: 'test' }, null, 'default')
    h.engine.handleMachineAlive({ machineId: 'machine-1', time: Date.now() })
    const session = h.engine.getOrCreateSession(
        'wake-session',
        { path: '/tmp/proj', host: 'h-1', machineId: 'machine-1', nativeSessionId: 'native-1' },
        null,
        'default',
    )
    expect(session.active).toBe(false)
    return session
}

/** wakeSession 是 fire-and-forget：轮询到 spawn 发生（或超时）为止 */
async function waitForSpawns(h: ReturnType<typeof makeWakeEngine>, count: number, timeoutMs = 1000): Promise<boolean> {
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
        if (h.spawnCalls().length >= count) return true
        await new Promise((resolve) => setTimeout(resolve, 10))
    }
    return false
}

describe('SyncEngine.wakeSession（dormancy 唤醒管线）', () => {
    test('非活跃会话 → 触发 resume spawn，spawn 选项携带 runtime_state 持久化配置', async () => {
        const h = makeWakeEngine()
        try {
            const session = seedDormantSession(h)
            // 休眠期间的配置暂存（spec §C）：唤醒时必须经 spawn 选项带回
            h.engine.applyDormantSessionConfig(session.id, {
                model: 'claude-opus-5',
                permissionMode: 'acceptEdits',
                effort: 'high',
                outputStyle: 'Concise',
            })

            h.engine.wakeSession(session.id)
            expect(await waitForSpawns(h, 1)).toBe(true)

            const params = h.spawnCalls()[0] as {
                model?: string
                permissionMode?: string
                effort?: string
                outputStyle?: string
                resumeSessionId?: string
            }
            expect(params.model).toBe('claude-opus-5')
            expect(params.permissionMode).toBe('acceptEdits')
            expect(params.effort).toBe('high')
            expect(params.outputStyle).toBe('Concise')
            // resume 语义：带原会话 native id
            expect(params.resumeSessionId).toBe('native-1')
        } finally {
            h.cleanup()
        }
    })

    test('防重入：在途 spawn 期间重复触发只 spawn 一次', async () => {
        const h = makeWakeEngine()
        try {
            const session = seedDormantSession(h)
            h.engine.wakeSession(session.id)
            h.engine.wakeSession(session.id)
            h.engine.wakeSession(session.id)

            expect(await waitForSpawns(h, 1)).toBe(true)
            // 在途集合释放前不会二次 spawn（fake 同步完成，此处只断言无并发放大）
            await new Promise((resolve) => setTimeout(resolve, 50))
            expect(h.spawnCalls().length).toBe(1)
        } finally {
            h.cleanup()
        }
    })

    test('活跃会话 → no-op 不触发 spawn', async () => {
        const h = makeWakeEngine()
        try {
            const session = seedDormantSession(h)
            h.engine.handleSessionAlive({ sid: session.id, time: Date.now() })
            expect(h.engine.getSession(session.id)!.active).toBe(true)

            h.engine.wakeSession(session.id)
            await new Promise((resolve) => setTimeout(resolve, 50))
            expect(h.spawnCalls()).toEqual([])
        } finally {
            h.cleanup()
        }
    })

    test('无机器在线 → 唤醒静默失败，入队消息保留在 queued', async () => {
        const h = makeWakeEngine()
        try {
            h.engine.getOrCreateMachine('machine-1', { host: 'h-1', platform: 'darwin', mobiCliVersion: 'test' }, null, 'default')
            // 不发 handleMachineAlive：机器存在但离线 → resumeSession 走 no_machine_online
            const session = h.engine.getOrCreateSession(
                'wake-offline',
                { path: '/tmp/proj', host: 'h-1', machineId: 'machine-1', nativeSessionId: 'native-1' },
                null,
                'default',
            )
            h.store.messages.addMessage(session.id, { role: 'user', content: [{ type: 'text', text: 'hi' }], meta: { sentFrom: 'webapp' } }, 'l1')

            // fire-and-forget：不 throw 即为过
            h.engine.wakeSession(session.id)
            await new Promise((resolve) => setTimeout(resolve, 50))

            expect(h.spawnCalls()).toEqual([])
            const queued = h.store.messages.getMessages(session.id).filter((m) => m.lifecycle === 'queued')
            expect(queued).toHaveLength(1)
        } finally {
            h.cleanup()
        }
    })
})
