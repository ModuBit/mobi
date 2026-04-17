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
import type { Machine } from '../../src/sync/machineCache'

const mockMachine: Machine = {
    id: 'test-machine-1',
    namespace: 'default',
    seq: 1,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    active: true,
    activeAt: Date.now(),
    metadata: {
        host: 'test-host',
        platform: 'linux',
        mobiCliVersion: '0.1.0',
        homeDir: '/home/testuser',
    },
    metadataVersion: 1,
    runnerState: null,
    runnerStateVersion: 0,
}

const mockSyncEngine = {
    getMachine: (_id: string) => mockMachine,
    getOnlineMachinesByNamespace: (_ns: string) => [mockMachine],
    spawnSession: async () => ({ type: 'success', sessionId: 'new-session-1' }),
} as unknown as SyncEngine

describe('Machines API', () => {
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

    test('POST /api/machines/:id/spawn 拒绝 homeDir 外的路径', async () => {
        const token = await getAuthToken(app)

        const res = await app.request('/api/machines/test-machine-1/spawn', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify({ directory: '/etc/passwd' }),
        })

        expect(res.status).toBe(403)
        const body = await res.json() as { error: string }
        expect(body.error).toContain('outside the home directory')
    })

    test('POST /api/machines/:id/spawn 允许 homeDir 内的路径', async () => {
        const token = await getAuthToken(app)

        const res = await app.request('/api/machines/test-machine-1/spawn', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify({ directory: '/home/testuser/projects' }),
        })

        expect(res.status).toBe(200)
    })
})
