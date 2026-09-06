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

import { describe, test, expect, afterEach } from 'bun:test'
import { setupTestApp, getAuthToken } from '../helpers/setupTestApp'
import type { SyncEngine } from '../../src/sync/syncEngine'
import type { Session } from '@mobi/shared'

/**
 * POST /api/sessions/:id/fork 路由层测试：HTTP 状态映射（404/400/409/200）与响应形状。
 * fork 业务逻辑由 store/sessionFork 与 sync/syncEngine.fork 测试覆盖，这里 mock engine。
 */

const mockSession: Session = {
    id: 'test-session-1',
    namespace: 'default',
    seq: 1,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    active: false,
    activeAt: Date.now(),
    metadata: { path: '/tmp/test', host: 'test-host', nativeSessionId: 'parent-native-1' },
    metadataVersion: 1,
    agentState: null,
    agentStateVersion: 0,
    running: false,
    runningAt: Date.now(),
    permissionMode: 'default',
}

/** forkSession 结果驱动的 mock engine */
function makeMockEngine(forkResult: { ok: true; sessionId: string } | { ok: false; reason: string }) {
    return {
        resolveSessionAccess: (_id: string, _ns: string) => ({
            ok: true as const,
            sessionId: 'test-session-1',
            session: mockSession,
        }),
        forkSession: (_sessionId: string, _anchorNativeId: string, _namespace: string) => forkResult,
    } as unknown as SyncEngine
}

describe('POST /api/sessions/:id/fork', () => {
    let app: ReturnType<typeof import('../../src/web/server').createWebApp>
    let cleanup: () => void

    function setup(mockEngine: SyncEngine) {
        return setupTestApp(mockEngine).then(s => {
            app = s.app
            cleanup = s.cleanup
        })
    }

    afterEach(() => {
        cleanup()
    })

    test('成功 → 200 + 新会话 id', async () => {
        await setup(makeMockEngine({ ok: true, sessionId: 'fork-session-1' }))
        const token = await getAuthToken(app)

        const res = await app.request('/api/sessions/test-session-1/fork', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
            body: JSON.stringify({ anchorNativeId: 'anchor-native' }),
        })

        expect(res.status).toBe(200)
        const body = await res.json() as { sessionId: string }
        expect(body.sessionId).toBe('fork-session-1')
    })

    test('未认证 → 401', async () => {
        await setup(makeMockEngine({ ok: true, sessionId: 'fork-session-1' }))

        const res = await app.request('/api/sessions/test-session-1/fork', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ anchorNativeId: 'anchor-native' }),
        })

        expect(res.status).toBe(401)
    })

    test('body 缺 anchorNativeId → 400', async () => {
        await setup(makeMockEngine({ ok: true, sessionId: 'fork-session-1' }))
        const token = await getAuthToken(app)

        const res = await app.request('/api/sessions/test-session-1/fork', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
            body: JSON.stringify({}),
        })

        expect(res.status).toBe(400)
    })

    test('锚点校验失败分支 → 400（带 reason code）', async () => {
        await setup(makeMockEngine({ ok: false, reason: 'anchor-not-found' }))
        const token = await getAuthToken(app)

        const res = await app.request('/api/sessions/test-session-1/fork', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
            body: JSON.stringify({ anchorNativeId: 'anchor-native' }),
        })

        expect(res.status).toBe(400)
        const body = await res.json() as { code: string }
        expect(body.code).toBe('anchor-not-found')
    })

    test('锚点在边界之前 → 400', async () => {
        await setup(makeMockEngine({ ok: false, reason: 'anchor-before-boundary' }))
        const token = await getAuthToken(app)

        const res = await app.request('/api/sessions/test-session-1/fork', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
            body: JSON.stringify({ anchorNativeId: 'anchor-native' }),
        })

        expect(res.status).toBe(400)
    })

    test('turn 起点找不到 → 400', async () => {
        await setup(makeMockEngine({ ok: false, reason: 'turn-start-not-found' }))
        const token = await getAuthToken(app)

        const res = await app.request('/api/sessions/test-session-1/fork', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
            body: JSON.stringify({ anchorNativeId: 'anchor-native' }),
        })

        expect(res.status).toBe(400)
    })

    test('会话不存在 → 404', async () => {
        await setup(makeMockEngine({ ok: false, reason: 'session-not-found' }))
        const token = await getAuthToken(app)

        const res = await app.request('/api/sessions/test-session-1/fork', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
            body: JSON.stringify({ anchorNativeId: 'anchor-native' }),
        })

        expect(res.status).toBe(404)
    })

    test('parent 无 nativeSessionId → 409', async () => {
        await setup(makeMockEngine({ ok: false, reason: 'parent-native-missing' }))
        const token = await getAuthToken(app)

        const res = await app.request('/api/sessions/test-session-1/fork', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
            body: JSON.stringify({ anchorNativeId: 'anchor-native' }),
        })

        expect(res.status).toBe(409)
    })
})
