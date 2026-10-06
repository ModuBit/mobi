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
import { createSessionsRoutes } from '../../../src/web/routes/sessions'
import { RpcFailure } from '../../../src/sync/rpcFailure'
import { BackgroundTaskTracker } from '../../../src/sync/backgroundTaskTracker'
import type { SyncEngine } from '../../../src/sync/syncEngine'

/**
 * POST /api/sessions/:id/archive 的异常收口（2026-09-30 事故）：会话 RPC 不可达时
 * archiveSession 抛 RpcFailure，路由若无 try/catch 会穿透成 500 Internal Server
 * Error——web 端只看到毫无信息量的通用错误。与 /dormant 的 attemptDormancyOrRespond
 * 同口径：归档未确认完成一律按冲突反馈。
 */

const mockSession = {
    id: 's1',
    namespace: 'default',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    active: true,
    activeAt: Date.now(),
    metadata: { path: '/tmp/test', host: 'test-host', flavor: 'claude' },
    metadataVersion: 1,
    agentState: null,
    running: false,
    runningAt: Date.now(),
    permissionMode: 'default',
}

function makeArchiveEngine(opts: { throws?: Error } = {}): SyncEngine {
    return {
        resolveSessionAccess: (id: string) => ({
            ok: true as const,
            sessionId: id,
            session: { ...mockSession, id },
        }),
        archiveSession: async () => {
            if (opts.throws) throw opts.throws
        },
    } as unknown as SyncEngine
}

function makeApp(engine: SyncEngine) {
    return createSessionsRoutes(() => engine, () => new BackgroundTaskTracker())
}

describe('POST /api/sessions/:id/archive 异常收口', () => {
    test('RpcFailure(unreachable) → 409 { error }，不穿透 500', async () => {
        const app = makeApp(makeArchiveEngine({
            throws: new RpcFailure('unreachable', 'RPC handler not registered: s1:killSession'),
        }))

        const res = await app.request('/sessions/s1/archive', { method: 'POST' })

        expect(res.status).toBe(409)
        const body = (await res.json()) as { error: string }
        expect(body.error).toBe('Session is not reachable')
    })

    test('RpcFailure(timeout) → 409（可能已送达，仍按未确认完成反馈冲突）', async () => {
        const app = makeApp(makeArchiveEngine({
            throws: new RpcFailure('timeout', 'operation has timed out'),
        }))

        const res = await app.request('/sessions/s1/archive', { method: 'POST' })

        expect(res.status).toBe(409)
        const body = (await res.json()) as { error: string }
        expect(body.error).toBe('Session is not reachable')
    })

    test('RpcFailure(other) → 409 且原样透出 message', async () => {
        const app = makeApp(makeArchiveEngine({
            throws: new RpcFailure('other', 'boom'),
        }))

        const res = await app.request('/sessions/s1/archive', { method: 'POST' })

        expect(res.status).toBe(409)
        const body = (await res.json()) as { error: string }
        expect(body.error).toBe('boom')
    })

    test('归档成功 → 200 { ok: true }', async () => {
        const app = makeApp(makeArchiveEngine())

        const res = await app.request('/sessions/s1/archive', { method: 'POST' })

        expect(res.status).toBe(200)
        expect(await res.json()).toEqual({ ok: true })
    })
})
