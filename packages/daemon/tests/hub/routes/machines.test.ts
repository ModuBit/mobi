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
import type { SyncEngine } from '../../../src/sync/syncEngine'
import type { Machine } from '../../../src/sync/machineCache'

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

/** 捕获 spawnSession 调用参数（workspaceId 应在 options 对象中） */
const spawnCalls: unknown[][] = []

/** mock 工作区表：id → 工作区（machineId 校验用） */
const workspaces = new Map<string, { id: string; namespace: string; machineId: string }>()

const mockSyncEngine = {
    getMachine: (_id: string) => mockMachine,
    getOnlineMachinesByNamespace: (_ns: string) => [mockMachine],
    getWorkspace: (id: string) => workspaces.get(id),
    spawnSession: async (...args: unknown[]) => {
        spawnCalls.push(args)
        return { type: 'success', sessionId: 'new-session-1' }
    },
} as unknown as SyncEngine

describe('Machines API', () => {
    let app: ReturnType<typeof import('../../../src/web/server').createWebApp>
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
            body: JSON.stringify({ directory: '/home/testuser/workspaces' }),
        })

        expect(res.status).toBe(200)
    })

    test('POST /api/machines/:id/spawn body 中的 workspaceId 透传给 engine.spawnSession options', async () => {
        const token = await getAuthToken(app)
        // workspace-7 归属目标机器 test-machine-1 → 校验通过
        workspaces.set('workspace-7', { id: 'workspace-7', namespace: 'default', machineId: 'test-machine-1' })
        const before = spawnCalls.length

        const res = await app.request('/api/machines/test-machine-1/spawn', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify({ directory: '/home/testuser/workspaces', workspaceId: 'workspace-7' }),
        })

        expect(res.status).toBe(200)
        expect(spawnCalls.length).toBe(before + 1)
        const args = spawnCalls[spawnCalls.length - 1]
        expect((args[2] as { workspaceId?: string }).workspaceId).toBe('workspace-7')
    })

    test('POST /api/machines/:id/spawn workspaceId 不存在 → 404（存在性校验在前）', async () => {
        const token = await getAuthToken(app)

        const res = await app.request('/api/machines/test-machine-1/spawn', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify({ directory: '/home/testuser/workspaces', workspaceId: 'no-such-workspace' }),
        })

        expect(res.status).toBe(404)
        expect(await res.json()).toMatchObject({ error: 'Workspace not found' })
    })
})
