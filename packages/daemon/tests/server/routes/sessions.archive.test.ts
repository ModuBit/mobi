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
 * 用户归档 API 契约（session-retention 票 04）：
 * - 归档成功 ok；休眠 gate 阻塞 → 409 { error, blockers }；找不到 → 404
 * - 默认列表排除 archived；includeArchived=1 才含
 * - unarchive 回列表（幂等成功）
 *
 * 引擎是 mock（路由测试缝隙 = HTTP 契约）；store 层行为由 store 测试覆盖。
 */

import { describe, test, expect, afterEach } from 'bun:test'
import { setupTestApp, getAuthToken } from '../helpers/setupTestApp'
import type { SyncEngine } from '../../../src/sync/syncEngine'
import type { Session } from '@mobi/shared'

const mockSession: Session = {
    id: 'test-session-1',
    namespace: 'default',
    seq: 1,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    active: false,
    activeAt: Date.now(),
    metadata: { path: '/tmp/test', host: 'test-host', flavor: 'claude' },
    metadataVersion: 1,
    agentState: null,
    agentStateVersion: 0,
    running: false,
    runningAt: Date.now(),
    status: 'dormant',
    archivedAt: null,
}

function makeArchiveEngine(overrides: {
    archiveResult?: { ok: boolean; blockers?: string[] }
    unarchiveResult?: boolean
} = {}): SyncEngine {
    return {
        resolveSessionAccess: (id: string) => ({
            ok: true as const,
            sessionId: id,
            session: mockSession,
        }),
        archiveSession: async () => overrides.archiveResult ?? { ok: true },
        unarchiveSession: () => overrides.unarchiveResult ?? true,
        getSessionsByNamespace: (_ns: string) => [mockSession],
    } as unknown as SyncEngine
}

async function authorizedApp(engine: SyncEngine) {
    const setup = await setupTestApp(engine)
    const token = await getAuthToken(setup.app)
    return { ...setup, token }
}

describe('POST /api/sessions/:id/archive（用户归档）', () => {
    afterEach(() => {
        // setupTestApp 的 cleanup 由各测试自行调用（返回值展开后丢失引用时兜底）
    })

    test('归档成功 → ok', async () => {
        const { app, cleanup, token } = await authorizedApp(makeArchiveEngine())
        try {
            const res = await app.request('/api/sessions/test-session-1/archive', {
                method: 'POST',
                headers: { Authorization: `Bearer ${token}` },
            })
            expect(res.status).toBe(200)
            expect(await res.json()).toEqual({ ok: true })
        } finally {
            cleanup()
        }
    })

    test('休眠 gate 阻塞 → 409 { error, blockers }', async () => {
        const { app, cleanup, token } = await authorizedApp(
            makeArchiveEngine({ archiveResult: { ok: false, blockers: ['turn_running'] } }),
        )
        try {
            const res = await app.request('/api/sessions/test-session-1/archive', {
                method: 'POST',
                headers: { Authorization: `Bearer ${token}` },
            })
            expect(res.status).toBe(409)
            const body = await res.json() as { error: string; blockers: string[] }
            expect(body.blockers).toEqual(['turn_running'])
        } finally {
            cleanup()
        }
    })

    test('会话不存在 → 404', async () => {
        const { app, cleanup, token } = await authorizedApp(
            makeArchiveEngine({ archiveResult: { ok: false, blockers: ['Session not found'] } }),
        )
        try {
            const res = await app.request('/api/sessions/nope/archive', {
                method: 'POST',
                headers: { Authorization: `Bearer ${token}` },
            })
            expect(res.status).toBe(404)
        } finally {
            cleanup()
        }
    })
})

describe('POST /api/sessions/:id/unarchive', () => {
    test('取消归档 → ok；失败 → 409', async () => {
        const ok = await authorizedApp(makeArchiveEngine({ unarchiveResult: true }))
        try {
            const res = await ok.app.request('/api/sessions/test-session-1/unarchive', {
                method: 'POST',
                headers: { Authorization: `Bearer ${ok.token}` },
            })
            expect(res.status).toBe(200)
        } finally {
            ok.cleanup()
        }

        const failed = await authorizedApp(makeArchiveEngine({ unarchiveResult: false }))
        try {
            const res = await failed.app.request('/api/sessions/test-session-1/unarchive', {
                method: 'POST',
                headers: { Authorization: `Bearer ${failed.token}` },
            })
            expect(res.status).toBe(409)
        } finally {
            failed.cleanup()
        }
    })
})

describe('归档会话禁收发（票 06）', () => {
    test('POST /sessions/:id/messages 对 archived → 409 session_archived', async () => {
        const archived: Session = { ...mockSession, status: 'archived', archivedAt: 1234 }
        const engine = {
            resolveSessionAccess: (id: string) => ({
                ok: true as const,
                sessionId: id,
                session: archived,
            }),
        } as unknown as SyncEngine
        const setup = await setupTestApp(engine)
        try {
            const token = await getAuthToken(setup.app)
            const res = await setup.app.request('/api/sessions/test-session-1/messages', {
                method: 'POST',
                headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({ content: [{ type: 'text', text: 'hi' }] }),
            })
            expect(res.status).toBe(409)
            const body = await res.json() as { code?: string }
            expect(body.code).toBe('session_archived')
        } finally {
            setup.cleanup()
        }
    })
})

describe('GET /api/sessions 的归档过滤', () => {
    function makeListEngine(session: Session): SyncEngine {
        return {
            getSessionsByNamespace: (_ns: string) => [session],
        } as unknown as SyncEngine
    }

    test('默认排除 archived；includeArchived=1 包含', async () => {
        const archived: Session = { ...mockSession, status: 'archived', archivedAt: 1234 }
        const { app, cleanup, token } = await authorizedApp(makeListEngine(archived))
        try {
            const headers = { Authorization: `Bearer ${token}` }
            const hidden = await app.request('/api/sessions', { headers })
            expect(((await hidden.json()) as { sessions: Session[] }).sessions).toHaveLength(0)

            const included = await app.request('/api/sessions?includeArchived=1', { headers })
            const sessions = ((await included.json()) as { sessions: Session[] }).sessions
            expect(sessions).toHaveLength(1)
            expect(sessions[0].status).toBe('archived')
            expect(sessions[0].archivedAt).toBe(1234)
        } finally {
            cleanup()
        }
    })

    test('非归档会话默认可见且携带 status', async () => {
        const { app, cleanup, token } = await authorizedApp(makeListEngine(mockSession))
        try {
            const res = await app.request('/api/sessions', {
                headers: { Authorization: `Bearer ${token}` },
            })
            const sessions = ((await res.json()) as { sessions: Session[] }).sessions
            expect(sessions).toHaveLength(1)
            expect(sessions[0].status).toBe('dormant')
        } finally {
            cleanup()
        }
    })
})
