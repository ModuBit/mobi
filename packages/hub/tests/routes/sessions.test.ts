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
    running: true,
    runningAt: Date.now(),
    permissionMode: 'default',
}

const mockSyncEngine = {
    resolveSessionAccess: (_id: string, _ns: string) => ({
        ok: true as const,
        sessionId: 'test-session-1',
        session: mockSession,
    }),
    applySessionConfig: async () => undefined,
    switchOutputStyle: async () => undefined,
    clearRuntimeStateFields: (_sessionId: string, _fields: string[], _namespace: string) => true,
} as unknown as SyncEngine

describe('Sessions API', () => {
    let app: ReturnType<typeof import('../../src/web/server').createWebApp>
    let cleanup: () => void

    beforeEach(async () => {
        const setup = await setupTestApp(mockSyncEngine)
        app = setup.app
        cleanup = setup.cleanup
    })

    afterEach(() => {
        cleanup()
    })

    describe('PATCH /api/sessions/:id/runtime-state', () => {
        test('清除指定字段返回 ok', async () => {
            const token = await getAuthToken(app)

            const res = await app.request('/api/sessions/test-session-1/runtime-state', {
                method: 'PATCH',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${token}`,
                },
                body: JSON.stringify({ clearFields: ['todos', 'backgroundTasks'] }),
            })

            expect(res.status).toBe(200)
            const body = await res.json() as { ok: boolean }
            expect(body.ok).toBe(true)
        })

        test('空 clearFields 返回 400', async () => {
            const token = await getAuthToken(app)

            const res = await app.request('/api/sessions/test-session-1/runtime-state', {
                method: 'PATCH',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${token}`,
                },
                body: JSON.stringify({ clearFields: [] }),
            })

            expect(res.status).toBe(400)
        })

        test('非法字段名返回 400', async () => {
            const token = await getAuthToken(app)

            const res = await app.request('/api/sessions/test-session-1/runtime-state', {
                method: 'PATCH',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${token}`,
                },
                body: JSON.stringify({ clearFields: ['invalidField'] }),
            })

            expect(res.status).toBe(400)
        })

        test('未认证返回 401', async () => {
            const res = await app.request('/api/sessions/test-session-1/runtime-state', {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ clearFields: ['todos'] }),
            })

            expect(res.status).toBe(401)
        })
    })

    describe('POST /api/sessions/:id/effort', () => {
        test('合法的 effort 值返回 ok', async () => {
            const token = await getAuthToken(app)

            const res = await app.request('/api/sessions/test-session-1/effort', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${token}`,
                },
                body: JSON.stringify({ effort: 'high' }),
            })

            expect(res.status).toBe(200)
            const body = await res.json() as { ok: boolean }
            expect(body.ok).toBe(true)
        })

        test('所有四个级别均可接受', async () => {
            const token = await getAuthToken(app)
            const levels = ['low', 'medium', 'high', 'xhigh']

            for (const level of levels) {
                const res = await app.request('/api/sessions/test-session-1/effort', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        Authorization: `Bearer ${token}`,
                    },
                    body: JSON.stringify({ effort: level }),
                })
                expect(res.status).toBe(200)
            }
        })

        test('非法 effort 值返回 400', async () => {
            const token = await getAuthToken(app)

            const res = await app.request('/api/sessions/test-session-1/effort', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${token}`,
                },
                body: JSON.stringify({ effort: 'max' }),
            })

            expect(res.status).toBe(400)
        })

        test('空 body 返回 400', async () => {
            const token = await getAuthToken(app)

            const res = await app.request('/api/sessions/test-session-1/effort', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${token}`,
                },
                body: JSON.stringify({}),
            })

            expect(res.status).toBe(400)
        })

        test('不存在的 session 返回 404', async () => {
            const engineWithNoSession = {
                resolveSessionAccess: () => ({ ok: false as const, reason: 'not-found' as const }),
            } as unknown as SyncEngine

            const setup = await setupTestApp(engineWithNoSession)
            const token = await getAuthToken(setup.app)

            const res = await setup.app.request('/api/sessions/non-existent/effort', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${token}`,
                },
                body: JSON.stringify({ effort: 'high' }),
            })

            expect(res.status).toBe(404)
            setup.cleanup()
        })
    })

    describe('POST /api/sessions/:id/output-style', () => {
        test('合法的 style 值返回 ok', async () => {
            const token = await getAuthToken(app)

            const res = await app.request('/api/sessions/test-session-1/output-style', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${token}`,
                },
                body: JSON.stringify({ style: 'Concise' }),
            })

            expect(res.status).toBe(200)
            const body = await res.json() as { ok: boolean }
            expect(body.ok).toBe(true)
        })

        test('空 style 返回 400', async () => {
            const token = await getAuthToken(app)

            const res = await app.request('/api/sessions/test-session-1/output-style', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${token}`,
                },
                body: JSON.stringify({ style: '' }),
            })

            expect(res.status).toBe(400)
        })

        test('CLI 明确拒绝（running/rewind 守卫，rejected message）返回 409 带原因', async () => {
            const engineRejected = {
                resolveSessionAccess: (_id: string, _ns: string) => ({
                    ok: true as const,
                    sessionId: 'test-session-1',
                    session: mockSession,
                }),
                // CLI handler throw 经 RPC 以 { error: 'switch-output-style rejected: ...' } 回传，syncEngine 原样上抛
                switchOutputStyle: async () => {
                    throw new Error('switch-output-style rejected: session is running')
                },
            } as unknown as SyncEngine

            const setup = await setupTestApp(engineRejected)
            const token = await getAuthToken(setup.app)

            const res = await setup.app.request('/api/sessions/test-session-1/output-style', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${token}`,
                },
                body: JSON.stringify({ style: 'Concise' }),
            })

            expect(res.status).toBe(409)
            const body = await res.json() as { error: string }
            expect(body.error).toContain('rejected')
            setup.cleanup()
        })

        test('结果未知（RPC 超时/断连，unconfirmed 标记）返回 502 + accepted unknown', async () => {
            // CLI 可能已受理并重启（副作用未知）：502 + accepted:'unknown' 引导刷新确认而非盲目重试
            const engineUnconfirmed = {
                resolveSessionAccess: (_id: string, _ns: string) => ({
                    ok: true as const,
                    sessionId: 'test-session-1',
                    session: mockSession,
                }),
                switchOutputStyle: async () => {
                    throw new Error('output style switch unconfirmed')
                },
            } as unknown as SyncEngine

            const setup = await setupTestApp(engineUnconfirmed)
            const token = await getAuthToken(setup.app)

            const res = await setup.app.request('/api/sessions/test-session-1/output-style', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${token}`,
                },
                body: JSON.stringify({ style: 'Concise' }),
            })

            expect(res.status).toBe(502)
            const body = await res.json() as { error: string; accepted: string }
            expect(body.error).toContain('unconfirmed')
            expect(body.accepted).toBe('unknown')
            setup.cleanup()
        })

        test('不存在的 session 返回 404', async () => {
            const engineWithNoSession = {
                resolveSessionAccess: () => ({ ok: false as const, reason: 'not-found' as const }),
            } as unknown as SyncEngine

            const setup = await setupTestApp(engineWithNoSession)
            const token = await getAuthToken(setup.app)

            const res = await setup.app.request('/api/sessions/non-existent/output-style', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${token}`,
                },
                body: JSON.stringify({ style: 'Concise' }),
            })

            expect(res.status).toBe(404)
            setup.cleanup()
        })
    })
})
