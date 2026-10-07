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

/**
 * ticket-18 Q8 验收：daemon 重启后（追踪表清空）会话重连 → 追踪表补登 →
 * 同一 nativeSessionId 的 wake 命中 already-running 不再 spawn；查重键随
 * nativeSessionId 演进刷新；pid 退出后表项清理、再 wake 正常放行。
 *
 * fake bridge 用与 run.ts 同款的数据面（Map<number, TrackedSession> +
 * createResumeDedupGuard + applySessionTrackingSignal）——测的是 server 侧 glue 与
 * executor 侧决策函数的组合，真实 spawn 管线由 spawnContract / E2E 覆盖。
 */

import { describe, test, expect, beforeEach } from 'bun:test'
import type { Server } from 'socket.io'
import { SyncEngine } from '../../../src/sync/syncEngine'
import { Store } from '../../../src/store'
import type { RpcRegistry } from '../../../src/socket/rpcRegistry'
import type { SSEManager } from '../../../src/sse/sseManager'
import { LocalExecutor } from '../../../src/executor/localExecutor'
import { createResumeDedupGuard } from '../../../src/executor/spawnDedup'
import { applySessionTrackingSignal, createSessionTrackingSync, pruneDeadTrackedSessions } from '../../../src/executor/sessionTracking'
import type { SessionTrackingSignal } from '../../../src/executor/sessionTracking'
import type { ExecutorBridge } from '../../../src/executor/lifecycle'
import type { TrackedSession } from '../../../src/executor/types'
import type { SpawnSessionOptions, SpawnSessionResult } from '@mobi/shared/hostProtocol'

const NAMESPACE = 'default'

interface Harness {
    engine: SyncEngine
    store: Store
    executorHost: LocalExecutor
    tracked: Map<number, TrackedSession>
    /** 可控存活判定：deadPids 里的 pid 视为已退出 */
    killPid: (pid: number) => void
    isAlive: (pid: number) => boolean
    spawnCalls: SpawnSessionOptions[]
    cleanup: () => void
}

function makeHarness(): Harness {
    const store = new Store(':memory:')
    const io = {
        of() {
            return { sockets: new Map(), emit: () => {} }
        },
        emit: () => {},
    } as unknown as Server
    const registry = { getSocketIdForMethod: () => null } as unknown as RpcRegistry
    const sseManager = { broadcast: () => {} } as unknown as SSEManager

    // in-memory executor 数据面（与 lifecycle.ts 同款组合）
    const tracked = new Map<number, TrackedSession>()
    const deadPids = new Set<number>()
    const isAlive = (pid: number) => !deadPids.has(pid)
    const spawnCalls: SpawnSessionOptions[] = []

    let bridge: ExecutorBridge | null = {
        spawnSession: async (options) => {
            spawnCalls.push(options)
            const hit = createResumeDedupGuard(tracked)(options.resumeSessionId)
            if (hit) return hit
            return { type: 'success', sessionId: `spawned-${spawnCalls.length}` }
        },
        registerSessionTracking: (signal) => {
            applySessionTrackingSignal(tracked, signal, isAlive)
        },
        stopSession: () => true,
    }

    // LocalExecutor 只带 bridge——socket 兜底已删（ticket-20），直调是唯一路径
    const executorHost = new LocalExecutor(() => bridge)

    const engine = new SyncEngine(store, io, registry, sseManager, undefined, executorHost)

    // server.setExecutorBridge 同款 glue（单源 createSessionTrackingSync）
    engine.setSessionTrackingSync(createSessionTrackingSync((sid) => engine.getSession(sid), (signal) => bridge!.registerSessionTracking(signal)))

    return {
        engine,
        store,
        executorHost,
        tracked,
        killPid: (pid) => deadPids.add(pid),
        isAlive,
        spawnCalls,
        cleanup: () => {
            bridge = null
            engine.stop()
            store.close()
        },
    }
}

/** 建会话行（metadata 模拟 daemon 重启后从 DB 恢复的现场：hostPid + nativeSessionId） */
function seedSession(h: Harness, nativeId: string | null, hostPid: number) {
    return h.store.sessions.getOrCreateSession(
        `/tmp/bf-${hostPid}`,
        { path: `/tmp/bf-${hostPid}`, host: 'test-host', nativeSessionId: nativeId ?? undefined, hostPid, startedBy: 'daemon' },
        {},
        NAMESPACE,
    )
}

describe('会话追踪补登（Q8）：daemon 重启 → 重连 → wake 去重', () => {
    let h: Harness
    beforeEach(() => { h = makeHarness() })

    test('重连（session-alive）→ 追踪表补登 → 同 nativeSessionId wake 返回 already-running 且零 spawn', async () => {
        const session = seedSession(h, 'native-1', 4242)

        // daemon 重启后 CLI 重连：首个 session-alive 到达
        h.engine.handleSessionAlive({ sid: session.id, time: Date.now(), running: false })

        expect(h.tracked.get(4242)).toMatchObject({ MobiSessionId: session.id, pid: 4242, resumeSessionId: 'native-1' })

        const result = await h.executorHost.spawnSession('/tmp/bf-4242', { resumeSessionId: 'native-1' })
        expect(result).toEqual({ type: 'already-running' })
        expect(h.spawnCalls.length).toBe(1) // dedup 命中：spawn 入口被调但未放行二次进程
    })

    test('不同 nativeSessionId 的 wake 不受补登表项影响（正常放行）', async () => {
        const session = seedSession(h, 'native-1', 4242)
        h.engine.handleSessionAlive({ sid: session.id, time: Date.now(), running: false })

        const result = await h.executorHost.spawnSession('/tmp/other', { resumeSessionId: 'native-other' })
        expect(result.type).toBe('success')
    })

    test('nativeSessionId 变更（/clear、fork 换链）→ 重连刷新查重键 → 新 id wake 命中 already-running', async () => {
        const session = seedSession(h, 'native-old', 4242)
        h.engine.handleSessionAlive({ sid: session.id, time: Date.now(), running: false })

        // 换链：metadata.nativeSessionId 翻新（update-metadata 落库后的形态）
        const row = h.store.sessions.getSession(session.id)
        const metadata = (row?.metadata ?? {}) as Record<string, unknown>
        h.store.sessions.updateSessionMetadata(session.id, { ...metadata, nativeSessionId: 'native-new' }, row?.metadataVersion ?? 0, NAMESPACE)
        // 生产路径 metadata 更新经 sessionCache（update-metadata handler）——刷新缓存使 engine.getSession 读到新值
        ;(h.engine as any).sessionCache.refreshSession(session.id)
        h.engine.handleSessionAlive({ sid: session.id, time: Date.now(), running: false })

        expect(h.tracked.get(4242)?.resumeSessionId).toBe('native-new')
        expect(await h.executorHost.spawnSession('/tmp/bf-4242', { resumeSessionId: 'native-new' }))
            .toEqual({ type: 'already-running' })
    })

    test('补登表项的 pid 退出 → prune 清理 → 再 wake 正常放行', async () => {
        const session = seedSession(h, 'native-1', 4242)
        h.engine.handleSessionAlive({ sid: session.id, time: Date.now(), running: false })

        h.killPid(4242)
        // 心跳周期到达（与 run.ts 同款 prune）
        expect(pruneDeadTrackedSessions(h.tracked, h.isAlive)).toEqual([4242])
        expect(h.tracked.size).toBe(0)

        const result = await h.executorHost.spawnSession('/tmp/bf-4242', { resumeSessionId: 'native-1' })
        expect(result.type).toBe('success')
    })

    test('pid 已死时重连 → 不补登（pid 复用防护）', () => {
        const session = seedSession(h, 'native-1', 4242)
        h.killPid(4242)
        h.engine.handleSessionAlive({ sid: session.id, time: Date.now(), running: false })
        expect(h.tracked.size).toBe(0)
    })
})
