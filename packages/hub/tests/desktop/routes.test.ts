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
import { createDesktopBroker } from '../../src/desktop/broker'
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
        platform: 'darwin',
        mobiCliVersion: '0.1.0',
        homeDir: '/home/testuser',
    },
    metadataVersion: 1,
    runnerState: null,
    runnerStateVersion: 0,
}

/** 捕获 desktop-stream RPC 下发参数（断言票据与路径到达 cli 侧） */
const desktopStreamCalls: Array<{ machineId: string; ticket: string; attachPath: string }> = []

const vncPasswordCalls: Array<{ machineId: string; vncPassword: string }> = []

const mockSyncEngine = {
    getMachine: (id: string) => (id === 'test-machine-1' ? mockMachine : null),
    machineDesktopStream: async (machineId: string, ticket: string, attachPath: string) => {
        desktopStreamCalls.push({ machineId, ticket, attachPath })
    },
    machineDesktopSetVncPassword: async (machineId: string, vncPassword: string) => {
        vncPasswordCalls.push({ machineId, vncPassword })
    },
    machineDesktopVncStatus: async () => ({ configured: true }),
} as unknown as SyncEngine

describe('Desktop watch API', () => {
    let app: ReturnType<typeof import('../../src/web/server').createWebApp>
    let cleanup: () => void

    function setup(syncEngine: SyncEngine | null = mockSyncEngine) {
        const broker = createDesktopBroker()
        return setupTestApp(syncEngine, { getDesktopBroker: () => broker }).then((result) => ({ ...result, broker }))
    }

    beforeEach(async () => {
        const result = await setup()
        app = result.app
        cleanup = result.cleanup
    })

    afterEach(() => {
        desktopStreamCalls.length = 0
        vncPasswordCalls.length = 0
        cleanup()
    })

    test('watch 签发 observe 凭据并经 RPC 触发 cli 反连', async () => {
        const token = await getAuthToken(app)

        const res = await app.request('/api/desktop/watch', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
            body: JSON.stringify({ machineId: 'test-machine-1' }),
        })
        expect(res.status).toBe(200)
        const body = await res.json() as { observeToken: string; expiresAtMs: number }
        expect(body.observeToken).toMatch(/^[0-9a-f]{48}$/)
        expect(body.expiresAtMs).toBeGreaterThan(Date.now())

        expect(desktopStreamCalls).toHaveLength(1)
        expect(desktopStreamCalls[0]).toMatchObject({
            machineId: 'test-machine-1',
            attachPath: '/desktop/attach',
        })
        expect(desktopStreamCalls[0].ticket).toMatch(/^[0-9a-f]{48}$/)
    })

    test('watch 无会话占用残留：同 machineId 重复 watch 签发新凭据', async () => {
        const token = await getAuthToken(app)

        const first = await app.request('/api/desktop/watch', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
            body: JSON.stringify({ machineId: 'test-machine-1' }),
        })
        const second = await app.request('/api/desktop/watch', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
            body: JSON.stringify({ machineId: 'test-machine-1' }),
        })
        expect(first.status).toBe(200)
        expect(second.status).toBe(200)

        const firstBody = await first.json() as { observeToken: string }
        const secondBody = await second.json() as { observeToken: string }
        expect(firstBody.observeToken).not.toBe(secondBody.observeToken)
    })

    test('cli 不可达（RPC 抛错）→ 502 且会话回滚', async () => {
        const broker = createDesktopBroker()
        const failingEngine = {
            getMachine: (id: string) => (id === 'test-machine-1' ? mockMachine : null),
            machineDesktopStream: async () => {
                throw new Error('RPC handler not registered')
            },
        } as unknown as SyncEngine

        const failing = await setupTestApp(failingEngine, { getDesktopBroker: () => broker })
        try {
            const token = await getAuthToken(failing.app)
            const res = await failing.app.request('/api/desktop/watch', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
                body: JSON.stringify({ machineId: 'test-machine-1' }),
            })
            expect(res.status).toBe(502)
            // 回滚：broker 上无残留会话
            expect(broker.listSessions()).toHaveLength(0)
        } finally {
            failing.cleanup()
        }
    })

    test('未认证请求被拒', async () => {
        const res = await app.request('/api/desktop/watch', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ machineId: 'test-machine-1' }),
        })
        expect(res.status).toBe(401)
    })

    test('未知 machineId → 404', async () => {
        const token = await getAuthToken(app)
        const res = await app.request('/api/desktop/watch', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
            body: JSON.stringify({ machineId: 'no-such-machine' }),
        })
        expect(res.status).toBe(404)
    })

    test('请求体不合法 → 400', async () => {
        const token = await getAuthToken(app)
        const res = await app.request('/api/desktop/watch', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
            body: JSON.stringify({}),
        })
        expect(res.status).toBe(400)
    })

    test('vnc-password 经 RPC 中转到 cli（1-16 字符）', async () => {
        const token = await getAuthToken(app)
        const res = await app.request('/api/desktop/vnc-password', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
            body: JSON.stringify({ machineId: 'test-machine-1', vncPassword: 'ab12cd34ef56gh78' }),
        })
        expect(res.status).toBe(200)
        expect(vncPasswordCalls).toEqual([{ machineId: 'test-machine-1', vncPassword: 'ab12cd34ef56gh78' }])
    })

    test('vnc-password 超长被 schema 拒绝（400，不下发 RPC）', async () => {
        const token = await getAuthToken(app)
        const res = await app.request('/api/desktop/vnc-password', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
            body: JSON.stringify({ machineId: 'test-machine-1', vncPassword: '12345678901234567' }),
        })
        expect(res.status).toBe(400)
        expect(vncPasswordCalls).toHaveLength(0)
    })

    test('vnc-status 回 cli 侧配置状态', async () => {
        const token = await getAuthToken(app)
        const res = await app.request('/api/desktop/vnc-status?machineId=test-machine-1', {
            headers: { Authorization: `Bearer ${token}` },
        })
        expect(res.status).toBe(200)
        expect(await res.json()).toEqual({ configured: true })
    })

    test('vnc-status 未知 machineId → 404', async () => {
        const token = await getAuthToken(app)
        const res = await app.request('/api/desktop/vnc-status?machineId=no-such', {
            headers: { Authorization: `Bearer ${token}` },
        })
        expect(res.status).toBe(404)
    })
})

describe('Desktop streams 管理 API', () => {
    let app: ReturnType<typeof import('../../src/web/server').createWebApp>
    let cleanup: () => void
    let broker: ReturnType<typeof createDesktopBroker>

    beforeEach(async () => {
        broker = createDesktopBroker()
        const result = await setupTestApp(mockSyncEngine, { getDesktopBroker: () => broker })
        app = result.app
        cleanup = result.cleanup
    })

    afterEach(() => {
        desktopStreamCalls.length = 0
        cleanup()
    })

    test('streams 列表返回活跃流（machineId + 开始时间）', async () => {
        broker.watchSession('test-machine-1')
        broker.watchSession('another-machine')

        const token = await getAuthToken(app)
        const res = await app.request('/api/desktop/streams', {
            headers: { Authorization: `Bearer ${token}` },
        })
        expect(res.status).toBe(200)
        const body = await res.json() as { streams: Array<{ sessionId: string; machineId: string; startedAtMs: number }> }
        expect(body.streams).toHaveLength(2)
        expect(body.streams.map((s) => s.machineId).sort()).toEqual(['another-machine', 'test-machine-1'])
        for (const s of body.streams) {
            expect(s.startedAtMs).toBeGreaterThan(0)
        }
    })

    test('关闭流：拆会话 + 作废票据，重新观看可正常建立', async () => {
        const session = broker.watchSession('test-machine-1')

        const token = await getAuthToken(app)
        const res = await app.request(`/api/desktop/streams/${session.sessionId}`, {
            method: 'DELETE',
            headers: { Authorization: `Bearer ${token}` },
        })
        expect(res.status).toBe(200)

        // 注册表清空 + 票据作废
        expect(broker.listSessions()).toHaveLength(0)
        expect(broker.consumeAttachTicket(session.attachTicket)).toBeNull()
        expect(broker.consumeObserveToken(session.observeToken)).toBeNull()

        // 关闭后重新观看可正常建立
        const rewatch = await app.request('/api/desktop/watch', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
            body: JSON.stringify({ machineId: 'test-machine-1' }),
        })
        expect(rewatch.status).toBe(200)
    })

    test('关闭不存在的流 → 404', async () => {
        const token = await getAuthToken(app)
        const res = await app.request('/api/desktop/streams/no-such-session', {
            method: 'DELETE',
            headers: { Authorization: `Bearer ${token}` },
        })
        expect(res.status).toBe(404)
    })
})
