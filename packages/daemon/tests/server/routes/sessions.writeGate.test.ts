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
 * 归档禁写闸（session-retention 票 11）：全部会话写端点对归档会话统一
 * 409 + code 'session_archived'（requireWritableSession 单源）。
 * 每个挂点一条用例——守卫插桩在 requireSessionFromParam 之后、body 校验之前，
 * 用例无需合法 body。
 */

import { describe, test, expect, afterEach } from 'bun:test'
import { setupTestApp, getAuthToken } from '../helpers/setupTestApp'
import type { SyncEngine } from '../../../src/sync/syncEngine'
import type { Session } from '@mobi/shared'

const archivedSession: Session = {
    id: 'test-session-1',
    namespace: 'default',
    seq: 1,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    active: false,
    activeAt: Date.now(),
    status: 'archived',
    archivedAt: Date.now(),
    metadata: { path: '/tmp/test', host: 'test-host', nativeSessionId: 'native-1' },
    metadataVersion: 1,
    agentState: null,
    agentStateVersion: 0,
    running: false,
    runningAt: Date.now(),
    permissionMode: 'default',
} as unknown as Session

/** 归档会话 + 休眠 gate 全放行的 mock engine：请求应死在写闸上 */
function makeArchivedEngine() {
    return {
        resolveSessionAccess: (_id: string, _ns: string) => ({
            ok: true as const,
            sessionId: 'test-session-1',
            session: archivedSession,
        }),
        dormantSession: () => Promise.resolve({ ok: true }),
    } as unknown as SyncEngine
}

describe('归档禁写闸（票 11）', () => {
    let app: ReturnType<typeof import('../../../src/web/server').createWebApp>
    let cleanup: () => void
    let token: string

    afterEach(() => cleanup())

    async function request(method: string, path: string, body?: unknown) {
        return app.request(path, {
            method,
            headers: {
                Authorization: `Bearer ${token}`,
                ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
            },
            ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
        })
    }

    /** 每端点统一断言：409 + code session_archived（错误先于 body 校验） */
    async function expectBlocked(method: string, path: string, body?: unknown) {
        const res = await request(method, path, body)
        expect(res.status).toBe(409)
        const json = await res.json() as { error?: string; code?: string }
        expect(json.code).toBe('session_archived')
        expect(json.error).toBe('Session is archived')
    }

    const endpoints: Array<[string, string, unknown?]> = [
        ['POST', '/api/sessions/test-session-1/messages', { content: { type: 'text', text: 'x' } }],
        ['DELETE', '/api/sessions/test-session-1/messages/msg-1'],
        ['POST', '/api/sessions/test-session-1/messages/msg-1/steer'],
        ['POST', '/api/sessions/test-session-1/resume'],
        ['POST', '/api/sessions/test-session-1/upload'],
        ['POST', '/api/sessions/test-session-1/save-file'],
        ['POST', '/api/sessions/test-session-1/upload/delete', { path: 'a.txt' }],
        ['POST', '/api/sessions/test-session-1/upload/replace'],
        ['POST', '/api/sessions/test-session-1/rewind/dry-run', { nativeId: 'n1' }],
        ['POST', '/api/sessions/test-session-1/rewind', { nativeId: 'n1', restoreFiles: false }],
        ['POST', '/api/sessions/test-session-1/switch'],
    ]

    for (const [method, path, body] of endpoints) {
        test(`${method} ${path.replace('/api/sessions/test-session-1', '/:id')} → 409 session_archived`, async () => {
            const setup = await setupTestApp(makeArchivedEngine())
            app = setup.app
            cleanup = setup.cleanup
            token = await getAuthToken(app)
            await expectBlocked(method, path, body)
        })
    }
})
