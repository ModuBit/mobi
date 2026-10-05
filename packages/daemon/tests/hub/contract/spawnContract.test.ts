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

import { describe, test, expect, beforeEach, afterEach, mock } from 'bun:test'
import { randomUUID } from 'node:crypto'
import type { Server } from 'socket.io'
import { SyncEngine } from '../../../src/sync/syncEngine'
import { LocalMachineHost } from '../../../src/machine/LocalMachineHost'
import { Store } from '../../../src/store'
import type { RpcRegistry } from '../../../src/socket/rpcRegistry'
import type { SSEManager } from '../../../src/sse/sseManager'

const MACHINE_ID = 'test-machine'
const NAMESPACE = 'default'

interface EngineHandle {
    engine: SyncEngine
    store: Store
    cleanup: () => void
    /** 手动标记会话为 active（模拟 /session-started webhook） */
    markActive: (sessionId: string) => void
    /** 获取底层 machineHost，用于恢复原始方法 */
    getMachineHost: () => any
}

/**
 * 创建会话（正确的参数顺序）
 * @param h engine handle
 * @param path 会话工作目录路径
 * @param nativeId native_id（可选）
 */
function createSessionWithPath(h: EngineHandle, path: string, nativeId?: string) {
    return h.store.sessions.getOrCreateSession(
        path,                                              // tag
        {
            path,
            host: 'test-host',                             // MetadataSchema 必填
            machineId: MACHINE_ID,                         // 用于匹配在线 machine
            nativeSessionId: nativeId                      // 用于 resume token
        },
        {},                                                // agentState
        NAMESPACE,                                         // namespace
        undefined,                                         // runtimeState
        undefined                                          // workspaceId
    )
}

/** 构造测试 engine，注册一台在线 machine（executorReady 缺省就绪；executorNotReady 用例外） */
function makeEngine(opts: { executorReady?: boolean } = {}): EngineHandle {
    const store = new Store(':memory:')

    const io = {
        of() {
            return { sockets: new Map(), emit: () => {} }
        },
        emit: () => {},
    } as unknown as Server

    const registry = {
        getSocketIdForMethod: () => null,
    } as unknown as RpcRegistry

    const sseManager = {
        broadcast: () => {},
    } as unknown as SSEManager

    // LocalMachineHost 只带 bridge 槽（socket 兜底已删，ticket-20）——用例真正穿过
    // LocalMachineHost 的直调路径
    const engine = new SyncEngine(store, io, registry, sseManager, undefined, new LocalMachineHost())

    // 注册本机 machine（spawn 寻址前提；ticket-20 起自注册即常驻 active）
    engine.registerLocalMachine(MACHINE_ID, { host: 'test-host' }, {}, NAMESPACE)

    // executor 就绪（ticket 201 起 resume/spawn 判据；机器列表层已删）
    if (opts.executorReady !== false) {
        engine.markExecutorReady()
    }

    return {
        engine,
        store,
        cleanup: () => {
            engine.stop()
            store.close()
        },
        markActive: (sessionId: string) => {
            // 使用 sessionCache.handleSessionAlive 正确标记会话为 active
            const sessionCache = (engine as any).sessionCache
            sessionCache.handleSessionAlive({
                sid: sessionId,
                time: Date.now(),
                running: false,
            })
        },
        getMachineHost: () => (engine as any).machineHost,
    }
}

describe('Spawn Contract: 新会话 spawn (S01)', () => {
    let h: EngineHandle
    let originalSpawn: any

    beforeEach(() => {
        h = makeEngine()
        originalSpawn = h.getMachineHost().spawnSession
    })

    afterEach(() => {
        // 恢复原始方法
        if (originalSpawn) {
            h.getMachineHost().spawnSession = originalSpawn
        }
        h.cleanup()
    })

    test('新会话 spawn → RPC 成功返回 sessionId', async () => {
        // Mock machineHost.spawnSession 返回成功
        h.getMachineHost().spawnSession = mock(async () => ({
            type: 'success' as const,
            sessionId: 'session-new-1',
        }))

        const result = await h.engine.spawnSession(MACHINE_ID, '/tmp/new', {})

        expect(result.type).toBe('success')
        if (result.type !== 'success') return

        expect(result.sessionId).toBe('session-new-1')
    })

    test('新会话收到 unexpected already-running → error (S09)', async () => {
        // Mock machineHost 返回 already-running（新会话不应该出现）
        h.getMachineHost().spawnSession = mock(async () => ({
            type: 'already-running' as const,
        }))

        const result = await h.engine.spawnSession(MACHINE_ID, '/tmp/unexpected', {})

        expect(result.type).toBe('error')
        if (result.type === 'error') {
            expect(result.message).toContain('Unexpected already-running')
        }
    })
})

describe('Spawn Contract: Resume 会话 (S02)', () => {
    let h: EngineHandle
    let originalSpawn: any

    beforeEach(() => {
        h = makeEngine()
        originalSpawn = h.getMachineHost().spawnSession
    })

    afterEach(() => {
        if (originalSpawn) {
            h.getMachineHost().spawnSession = originalSpawn
        }
        h.cleanup()
    })

    test('resume 已 active 会话 → 零等待返回 success', async () => {
        // 创建一个已 active 的会话（必须有完整的 metadata.path）
        const existing = createSessionWithPath(h, '/tmp/active')
        h.markActive(existing.id)

        // Mock spawnSession（不应该被调用）
        const spawnMock = mock(async () => ({ type: 'success' as const, sessionId: 'should-not-call' }))
        h.getMachineHost().spawnSession = spawnMock

        const result = await h.engine.resumeSession(existing.id, NAMESPACE)

        expect(result.type).toBe('success')
        if (result.type === 'success') {
            expect(result.sessionId).toBe(existing.id)
        }

        // 验证没有调用 RPC
        expect(spawnMock).not.toHaveBeenCalled()
    })

    test('resume 未 active 会话 → spawn + waitActive', async () => {
        // 创建一个未 active 的会话（必须有完整的 metadata.path）
        const existing = createSessionWithPath(h, '/tmp/inactive')

        // Mock spawnSession 返回成功（sessionId 相同）
        h.getMachineHost().spawnSession = mock(async () => ({
            type: 'success' as const,
            sessionId: existing.id,
        }))

        // 启动 resumeSession，它会调用 waitForSessionActive 轮询
        const resumePromise = h.engine.resumeSession(existing.id, NAMESPACE)

        // 异步标记会话为 active，模拟 runner 发送 /session-started
        setTimeout(() => h.markActive(existing.id), 100)

        const result = await resumePromise

        expect(result.type).toBe('success')
        if (result.type === 'success') {
            expect(result.sessionId).toBe(existing.id)
        }
    })
})

describe('Spawn Contract: already-running 结果 (S03)', () => {
    let h: EngineHandle
    let originalSpawn: any

    beforeEach(() => {
        h = makeEngine()
        originalSpawn = h.getMachineHost().spawnSession
    })

    afterEach(() => {
        if (originalSpawn) {
            h.getMachineHost().spawnSession = originalSpawn
        }
        h.cleanup()
    })

    test('runner 返回 already-running → hub 零等待 success', async () => {
        // 创建一个未 active 的会话（用于 resume），必须有完整的 metadata.path
        const existing = createSessionWithPath(h, '/tmp/already')

        // Mock machineHost 返回 already-running
        h.getMachineHost().spawnSession = mock(async () => ({
            type: 'already-running' as const,
        }))

        const result = await h.engine.resumeSession(existing.id, NAMESPACE)

        // 期望：零等待返回 success（不进入 waitForSessionActive）
        expect(result.type).toBe('success')
        if (result.type === 'success') {
            expect(result.sessionId).toBe(existing.id)
        }
    })
})

describe('Spawn Contract: 等待 active 超时 (S06)', () => {
    let h: EngineHandle
    let originalSpawn: any

    beforeEach(() => {
        h = makeEngine()
        originalSpawn = h.getMachineHost().spawnSession
    })

    afterEach(() => {
        if (originalSpawn) {
            h.getMachineHost().spawnSession = originalSpawn
        }
        h.cleanup()
    })

    test('waitForSessionActive 超时 → error', async () => {
        const existing = createSessionWithPath(h, '/tmp/timeout')

        // Mock spawnSession 返回成功，但不标记为 active
        h.getMachineHost().spawnSession = mock(async () => ({
            type: 'success' as const,
            sessionId: existing.id,
        }))

        // 使用极短的超时时间加速测试（覆盖 waitForSessionActive 的默认 15s）
        const originalWait = h.engine.waitForSessionActive.bind(h.engine)
        h.engine.waitForSessionActive = async (sessionId: string) => {
            return await originalWait(sessionId, 100) // 100ms 超时
        }

        const result = await h.engine.resumeSession(existing.id, NAMESPACE)

        expect(result.type).toBe('error')
        if (result.type === 'error') {
            expect(result.code).toBe('resume_failed')
        }
    })
})

describe('Spawn Contract: RPC 错误处理 (S07)', () => {
    let h: EngineHandle
    let originalSpawn: any

    beforeEach(() => {
        h = makeEngine()
        originalSpawn = h.getMachineHost().spawnSession
    })

    afterEach(() => {
        if (originalSpawn) {
            h.getMachineHost().spawnSession = originalSpawn
        }
        h.cleanup()
    })

    test('runner 返回 error → 原样传递', async () => {
        const existing = createSessionWithPath(h, '/tmp/error')

        // Mock machineHost 返回错误
        h.getMachineHost().spawnSession = mock(async () => ({
            type: 'error' as const,
            message: 'Test spawn failed',
        }))

        const result = await h.engine.resumeSession(existing.id, NAMESPACE)

        expect(result.type).toBe('error')
        if (result.type === 'error') {
            expect(result.message).toContain('Test spawn failed')
            expect(result.code).toBe('resume_failed')
        }
    })
})

describe('Spawn Contract: 会话不存在或无权限', () => {
    let h: EngineHandle

    beforeEach(() => {
        h = makeEngine()
    })

    afterEach(() => {
        h.cleanup()
    })

    test('resume 不存在的会话 → session_not_found', async () => {
        const result = await h.engine.resumeSession('nonexistent', NAMESPACE)

        expect(result.type).toBe('error')
        if (result.type === 'error') {
            expect(result.code).toBe('session_not_found')
        }
    })

    test('resume 无元数据的会话 → resume_unavailable', async () => {
        // 手动插入一个缺少 metadata.path 的会话
        const sessionId = randomUUID()
        h.store.getDatabaseForTesting().prepare(`
            INSERT INTO sessions (
                id, tag, namespace, machine_id, created_at, updated_at,
                metadata, metadata_version,
                agent_state, agent_state_version,
                runtime_state, runtime_state_updated_at,
                workspace_id, seq
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
            sessionId,
            'test-tag',
            NAMESPACE,
            MACHINE_ID,
            Date.now(),
            Date.now(),
            JSON.stringify({}), // 空的 metadata，没有 path
            1,
            null,
            1,
            null,
            null,
            null,
            0
        )

        const result = await h.engine.resumeSession(sessionId, NAMESPACE)

        expect(result.type).toBe('error')
        if (result.type === 'error') {
            expect(result.code).toBe('resume_unavailable')
        }
    })

    test('resume executor 未就绪 → executor_not_ready', async () => {
        // 创建会话（必须有完整的 metadata.path）；engine 不标记 executor 就绪
        const h2 = makeEngine({ executorReady: false })
        try {
            const existing = createSessionWithPath(h2, '/tmp/offline')

            const result = await h2.engine.resumeSession(existing.id, NAMESPACE)

            expect(result.type).toBe('error')
            if (result.type === 'error') {
                expect(result.code).toBe('executor_not_ready')
            }
        } finally {
            h2.cleanup()
        }
    })
})
