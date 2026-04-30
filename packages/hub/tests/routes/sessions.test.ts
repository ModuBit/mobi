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
})
