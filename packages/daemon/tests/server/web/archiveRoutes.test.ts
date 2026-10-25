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
import { Store } from '../../../src/store'
import { createTempRepo, git, type TempRepo } from '../../worktree/testRepo'

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
    return createSessionsRoutes({ getSyncEngine: () => engine, backgroundTaskTracker: new BackgroundTaskTracker(), store: new Store(':memory:') })
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
describe('POST /api/sessions/:id/archive 不处置 worktree（可复活语义）', () => {
    test('归档后 worktree 目录与分支原样保留', async () => {
        const temp: TempRepo = await createTempRepo()
        try {
            const worktreePath = await temp.addWorktree('revivable')
            const branch = 'mobi-revivable'
            const engine = {
                resolveSessionAccess: (id: string) => ({
                    ok: true as const,
                    sessionId: id,
                    session: {
                        ...mockSession,
                        id,
                        metadata: {
                            path: worktreePath,
                            host: 'test-host',
                            flavor: 'claude',
                            worktree: { basePath: temp.repo, branch, name: 'revivable', worktreePath }
                        }
                    }
                }),
                archiveSession: async () => {}
            } as unknown as SyncEngine

            const res = await makeApp(engine).request('/sessions/s1/archive', { method: 'POST' })

            expect(res.status).toBe(200)
            // 归档 = 可复活：目录与分支都不能被清理
            const { stat } = await import('node:fs/promises')
            expect(await stat(worktreePath).then(() => true, () => false)).toBe(true)
            expect((await git(temp.repo, ['branch', '--list', branch])).trim()).not.toBe('')
        } finally {
            await temp.cleanup()
        }
    })
})
