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

/** 捕获 spawnSession 调用参数（projectId 应为最后一个位置参数） */
const spawnCalls: unknown[][] = []

/** mock 项目表：id → 项目（machineId 校验用） */
const projects = new Map<string, { id: string; namespace: string; machineId: string }>()

const mockSyncEngine = {
    getMachine: (_id: string) => mockMachine,
    getOnlineMachinesByNamespace: (_ns: string) => [mockMachine],
    getProject: (id: string) => projects.get(id),
    spawnSession: async (...args: unknown[]) => {
        spawnCalls.push(args)
        return { type: 'success', sessionId: 'new-session-1' }
    },
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

    test('POST /api/machines/:id/spawn body 中的 projectId 透传给 engine.spawnSession（最后一个位置参数）', async () => {
        const token = await getAuthToken(app)
        // project-7 归属目标机器 test-machine-1 → 校验通过
        projects.set('project-7', { id: 'project-7', namespace: 'default', machineId: 'test-machine-1' })
        const before = spawnCalls.length

        const res = await app.request('/api/machines/test-machine-1/spawn', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify({ directory: '/home/testuser/projects', projectId: 'project-7' }),
        })

        expect(res.status).toBe(200)
        expect(spawnCalls.length).toBe(before + 1)
        const args = spawnCalls[spawnCalls.length - 1]
        expect(args[args.length - 1]).toBe('project-7')
    })

    test('POST /api/machines/:id/spawn projectId 归属其它机器 → 403 且不触发 spawn', async () => {
        const token = await getAuthToken(app)
        projects.set('project-other', { id: 'project-other', namespace: 'default', machineId: 'another-machine' })
        const before = spawnCalls.length

        const res = await app.request('/api/machines/test-machine-1/spawn', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify({ directory: '/home/testuser/projects', projectId: 'project-other' }),
        })

        expect(res.status).toBe(403)
        expect(await res.json()).toMatchObject({ error: 'Project belongs to a different machine' })
        // 幽灵会话回归：spawn 未被调用，会话未被派生
        expect(spawnCalls.length).toBe(before)
    })

    test('POST /api/machines/:id/spawn projectId 不存在 → 404（存在性校验在前）', async () => {
        const token = await getAuthToken(app)

        const res = await app.request('/api/machines/test-machine-1/spawn', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify({ directory: '/home/testuser/projects', projectId: 'no-such-project' }),
        })

        expect(res.status).toBe(404)
        expect(await res.json()).toMatchObject({ error: 'Project not found' })
    })
})
