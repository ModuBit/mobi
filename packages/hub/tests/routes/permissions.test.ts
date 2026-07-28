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

const REQUEST_ID = 'req-1'

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
    agentState: {
        requests: {
            [REQUEST_ID]: { tool: 'Bash', arguments: { command: 'ls' } },
        },
    } as unknown as Session['agentState'],
    agentStateVersion: 1,
    running: true,
    runningAt: Date.now(),
    permissionMode: 'default',
}

// approvePermission mock：捕获调用参数以断言 updatedPermissions 透传
const approveCalls: unknown[][] = []
const approvePermissionMock = (...args: unknown[]) => {
    approveCalls.push(args)
    return Promise.resolve()
}

const mockSyncEngine = {
    resolveSessionAccess: (_id: string, _ns: string) => ({
        ok: true as const,
        sessionId: 'test-session-1',
        session: mockSession,
    }),
    approvePermission: approvePermissionMock,
} as unknown as SyncEngine

describe('Permissions API — POST /api/sessions/:id/permissions/:requestId/approve', () => {
    let app: ReturnType<typeof import('../../src/web/server').createWebApp>
    let cleanup: () => void

    beforeEach(async () => {
        approveCalls.length = 0
        const setup = await setupTestApp(mockSyncEngine)
        app = setup.app
        cleanup = setup.cleanup
    })

    afterEach(() => {
        cleanup()
    })

    test('body 带 updatedPermissions 时透传给 engine.approvePermission（destination=session）', async () => {
        const token = await getAuthToken(app)

        const updatedPermissions = [
            {
                type: 'addRules',
                rules: [{ toolName: 'Bash', ruleContent: 'ls' }],
                behavior: 'allow',
                destination: 'session',
            },
        ]

        const res = await app.request(
            `/api/sessions/test-session-1/permissions/${REQUEST_ID}/approve`,
            {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${token}`,
                },
                body: JSON.stringify({ updatedPermissions }),
            },
        )

        expect(res.status).toBe(200)
        const body = await res.json() as { ok: boolean }
        expect(body.ok).toBe(true)

        // approvePermission 必须被调用，且最后一个参数为 updatedPermissions 数组
        expect(approveCalls).toHaveLength(1)
        const args = approveCalls[0]
        const lastArg = args[args.length - 1]
        expect(lastArg).toEqual(updatedPermissions)
    })

    test('body 不含 updatedPermissions 时透传 undefined', async () => {
        const token = await getAuthToken(app)

        const res = await app.request(
            `/api/sessions/test-session-1/permissions/${REQUEST_ID}/approve`,
            {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${token}`,
                },
                body: JSON.stringify({ decision: 'approved' }),
            },
        )

        expect(res.status).toBe(200)
        expect(approveCalls).toHaveLength(1)
        const args = approveCalls[0]
        const lastArg = args[args.length - 1]
        expect(lastArg).toBeUndefined()
    })
})
