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

import { setupTestApp, getAuthToken } from '../helpers/setupTestApp'
import { BackgroundTaskTracker } from '../../src/sync/backgroundTaskTracker'
import { createSessionsRoutes } from '../../src/web/routes/sessions'
import type { SyncEngine } from '../../src/sync/syncEngine'
import type { Session } from '@mobi/shared'

const mockSession: Session = {
    id: 'test-session-1',
    namespace: 'default',
    seq: 1,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    active: true,
    activeAt: Date.now(),
    metadata: { path: '/tmp/test', host: 'test-host', flavor: 'claude' },
    metadataVersion: 1,
    agentState: null,
    agentStateVersion: 0,
    running: false,
    runningAt: Date.now(),
    permissionMode: 'default',
}

/** 构造 mock SyncEngine：捕获 rewindDryRun / rewind 调用 */
function makeRewindEngine(opts: { dryRunResult?: unknown; rewindResult?: unknown; rewindThrows?: Error } = {}) {
    const calls = {
        rewindDryRun: null as { sessionId: string; nativeId: string } | null,
        rewind: null as { sessionId: string; nativeId: string; restoreFiles: boolean } | null,
    }
    const engine = {
        resolveSessionAccess: (id: string) => ({
            ok: true as const,
            sessionId: id,
            session: { ...mockSession, id },
        }),
        rewindDryRun: async (sessionId: string, nativeId: string) => {
            calls.rewindDryRun = { sessionId, nativeId }
            if (opts.rewindThrows) throw opts.rewindThrows
            return opts.dryRunResult ?? { canRewind: true, canRestoreFiles: false }
        },
        rewind: async (sessionId: string, nativeId: string, restoreFiles: boolean) => {
            calls.rewind = { sessionId, nativeId, restoreFiles }
            if (opts.rewindThrows) throw opts.rewindThrows
            return opts.rewindResult ?? { accepted: true }
        },
    } as unknown as SyncEngine
    return { engine, calls }
}

/** 直接在 sessions 路由上挂 tracker（不走 createWebApp 的可选透传，闸门行为在此单测） */
function makeApp(getEngine: () => SyncEngine | null, tracker: BackgroundTaskTracker) {
    return createSessionsRoutes(getEngine, () => tracker)
}

describe('rewind API 路由', () => {
    let cleanup: () => void
    let app: ReturnType<typeof import('../../src/web/server').createWebApp>
    let token: string

    beforeEach(async () => {
        const { engine } = makeRewindEngine()
        const setup = await setupTestApp(engine)
        app = setup.app
        cleanup = setup.cleanup
        token = await getAuthToken(app)
    })

    afterEach(() => {
        cleanup()
    })

    describe('POST /api/sessions/:id/rewind/dry-run', () => {
        test('透传 CLI RPC 结果（canRewind / canRestoreFiles）', async () => {
            const { engine, calls } = makeRewindEngine({ dryRunResult: { canRewind: true, canRestoreFiles: false } })
            const route = makeApp(() => engine, new BackgroundTaskTracker())

            const res = await route.request('/sessions/test-session-1/rewind/dry-run', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ nativeId: 'uu-1' }),
            })

            expect(res.status).toBe(200)
            expect(await res.json()).toEqual({ canRewind: true, canRestoreFiles: false })
            expect(calls.rewindDryRun).toEqual({ sessionId: 'test-session-1', nativeId: 'uu-1' })
        })

        test('缺 nativeId → 400', async () => {
            const { engine } = makeRewindEngine()
            const route = makeApp(() => engine, new BackgroundTaskTracker())

            const res = await route.request('/sessions/test-session-1/rewind/dry-run', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({}),
            })
            expect(res.status).toBe(400)
        })

        test('RPC 失败（CLI 离线等）→ 409 携带错误信息', async () => {
            const { engine } = makeRewindEngine({ rewindThrows: new Error('RPC handler not registered: rewind-dry-run') })
            const route = makeApp(() => engine, new BackgroundTaskTracker())

            const res = await route.request('/sessions/test-session-1/rewind/dry-run', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ nativeId: 'uu-1' }),
            })
            expect(res.status).toBe(409)
            const body = await res.json() as { error: string }
            expect(body.error).toContain('rewind-dry-run')
        })

        test('经 createWebApp 全链路：未认证 → 401', async () => {
            const res = await app.request('/api/sessions/test-session-1/rewind/dry-run', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ nativeId: 'uu-1' }),
            })
            expect(res.status).toBe(401)
        })

        test('经 createWebApp 全链路：认证后透传结果', async () => {
            const res = await app.request('/api/sessions/test-session-1/rewind/dry-run', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${token}`,
                },
                body: JSON.stringify({ nativeId: 'uu-1' }),
            })
            expect(res.status).toBe(200)
            expect(await res.json()).toEqual({ canRewind: true, canRestoreFiles: false })
        })
    })

    describe('POST /api/sessions/:id/rewind', () => {
        test('有活跃后台任务 → 409 且不转发 RPC', async () => {
            const { engine, calls } = makeRewindEngine()
            const tracker = new BackgroundTaskTracker()
            tracker.replace('test-session-1', ['bt-001'])
            const route = makeApp(() => engine, tracker)

            const res = await route.request('/sessions/test-session-1/rewind', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ nativeId: 'uu-1', restoreFiles: true }),
            })

            expect(res.status).toBe(409)
            expect(await res.json()).toEqual({ error: 'session has background tasks in flight' })
            expect(calls.rewind).toBeNull()
        })

        test('无在途 → 转发 RPC 受理并返回 202 { accepted: true }', async () => {
            const { engine, calls } = makeRewindEngine()
            const route = makeApp(() => engine, new BackgroundTaskTracker())

            const res = await route.request('/sessions/test-session-1/rewind', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ nativeId: 'uu-1', restoreFiles: true }),
            })

            expect(res.status).toBe(202)
            expect(await res.json()).toEqual({ accepted: true })
            expect(calls.rewind).toEqual({ sessionId: 'test-session-1', nativeId: 'uu-1', restoreFiles: true })
        })

        test('CLI 干净拒绝（accepted:false，如 busy / 文件回滚失败）→ 409 透传 reason，不再恒 202', async () => {
            const { engine } = makeRewindEngine({ rewindResult: { accepted: false, reason: 'rewind is already in progress' } })
            const route = makeApp(() => engine, new BackgroundTaskTracker())

            const res = await route.request('/sessions/test-session-1/rewind', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ nativeId: 'uu-1', restoreFiles: false }),
            })

            expect(res.status).toBe(409)
            const body = await res.json() as { error: string }
            expect(body.error).toContain('in progress')
        })

        test('CLI 返回无 reason 的 accepted:false → 409 带兜底文案', async () => {
            const { engine } = makeRewindEngine({ rewindResult: { accepted: false } })
            const route = makeApp(() => engine, new BackgroundTaskTracker())

            const res = await route.request('/sessions/test-session-1/rewind', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ nativeId: 'uu-1', restoreFiles: false }),
            })

            expect(res.status).toBe(409)
            expect(await res.json()).toEqual({ error: 'rewind rejected' })
        })

        test('后台任务清空（replace 空数组）后 → 闸门放行', async () => {
            const { engine, calls } = makeRewindEngine()
            const tracker = new BackgroundTaskTracker()
            tracker.replace('test-session-1', ['bt-001'])
            tracker.replace('test-session-1', [])
            const route = makeApp(() => engine, tracker)

            const res = await route.request('/sessions/test-session-1/rewind', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ nativeId: 'uu-1', restoreFiles: false }),
            })

            expect(res.status).toBe(202)
            expect(calls.rewind).not.toBeNull()
        })

        test('缺字段 / 类型错 → 400', async () => {
            const { engine } = makeRewindEngine()
            const route = makeApp(() => engine, new BackgroundTaskTracker())

            for (const body of [{ nativeId: 'uu-1' }, { nativeId: '', restoreFiles: true }, { restoreFiles: true }]) {
                const res = await route.request('/sessions/test-session-1/rewind', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(body),
                })
                expect(res.status).toBe(400)
            }
        })

        test('session 不存在 → 404', async () => {
            const engineNoSession = {
                resolveSessionAccess: () => ({ ok: false as const, reason: 'not-found' as const }),
            } as unknown as SyncEngine
            const route = makeApp(() => engineNoSession, new BackgroundTaskTracker())

            const res = await route.request('/sessions/ghost/rewind', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ nativeId: 'uu-1', restoreFiles: true }),
            })
            expect(res.status).toBe(404)
        })

        test('经 createWebApp 全链路：未认证 → 401', async () => {
            const res = await app.request('/api/sessions/test-session-1/rewind', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ nativeId: 'uu-1', restoreFiles: true }),
            })
            expect(res.status).toBe(401)
        })
    })
})

describe('BackgroundTaskTracker', () => {
    test('replace 语义：整体替换，空数组清空', () => {
        const tracker = new BackgroundTaskTracker()
        expect(tracker.hasActive('s1')).toBe(false)

        tracker.replace('s1', ['a', 'b'])
        expect(tracker.hasActive('s1')).toBe(true)
        expect([...tracker.getActive('s1')]).toEqual(['a', 'b'])

        tracker.replace('s1', ['c'])
        expect([...tracker.getActive('s1')]).toEqual(['c'])

        tracker.replace('s1', [])
        expect(tracker.hasActive('s1')).toBe(false)
        expect(tracker.getActive('s1').size).toBe(0)
    })

    test('getActive 无记录时返回只读空集且不落 Map', () => {
        const tracker = new BackgroundTaskTracker()
        const empty = tracker.getActive('ghost')
        expect(empty.size).toBe(0)
    })

    test('会话间隔离', () => {
        const tracker = new BackgroundTaskTracker()
        tracker.replace('s1', ['a'])
        tracker.replace('s2', ['b'])
        expect(tracker.hasActive('s1')).toBe(true)
        expect(tracker.hasActive('s2')).toBe(true)
        tracker.replace('s1', [])
        expect(tracker.hasActive('s1')).toBe(false)
        expect(tracker.hasActive('s2')).toBe(true)
    })
})
