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

/**
 * 构造可配置的 mock SyncEngine，用于测试 DELETE 路由三分支。
 * cancelQueuedMessageReturn / cancelCliQueuedMessageImpl 由用例注入。
 */
function makeMockEngine(opts: {
    cancelQueuedMessageReturn: { cancelled: boolean; submitted: boolean }
    cancelCliQueuedMessageImpl?: (sessionId: string, localId: string) => Promise<{ status: 'cancelled' | 'submitted' }>
}): SyncEngine {
    return {
        resolveSessionAccess: (_id: string, _ns: string) => ({
            ok: true as const,
            sessionId: 'test-session-1',
            session: mockSession,
        }),
        cancelQueuedMessage: () => opts.cancelQueuedMessageReturn,
        cancelCliQueuedMessage: opts.cancelCliQueuedMessageImpl
            ?? (() => Promise.resolve({ status: 'submitted' })),
    } as unknown as SyncEngine
}

describe('DELETE /api/sessions/:id/messages/:messageId（排队消息两阶段取消）', () => {
    let cleanup: () => void
    let app: ReturnType<typeof import('../../src/web/server').createWebApp>

    afterEach(() => {
        cleanup?.()
    })

    async function deleteMessage(engine: SyncEngine, messageId: string = 'loc-1') {
        const setup = await setupTestApp(engine)
        app = setup.app
        cleanup = setup.cleanup
        const token = await getAuthToken(app)
        return await app.request(`/api/sessions/test-session-1/messages/${messageId}`, {
            method: 'DELETE',
            headers: { Authorization: `Bearer ${token}` },
        })
    }

    test('DB 已 invoke → 返回 {status:submitted}，不调 CLI RPC', async () => {
        let cliCalled = false
        const engine = makeMockEngine({
            cancelQueuedMessageReturn: { cancelled: false, submitted: true },
            cancelCliQueuedMessageImpl: async () => { cliCalled = true; return { status: 'submitted' } },
        })

        const res = await deleteMessage(engine)
        expect(res.status).toBe(200)
        const body = await res.json() as { status: string }
        expect(body.status).toBe('submitted')
        expect(cliCalled).toBe(false)
    })

    test('DB cancelled → 调 CLI RPC（best-effort）→ 返回 {status:cancelled}', async () => {
        let cliCalled = false
        const engine = makeMockEngine({
            cancelQueuedMessageReturn: { cancelled: true, submitted: false },
            cancelCliQueuedMessageImpl: async (sid, lid) => {
                cliCalled = true
                expect(sid).toBe('test-session-1')
                expect(lid).toBe('loc-1')
                return { status: 'cancelled' }
            },
        })

        const res = await deleteMessage(engine)
        expect(res.status).toBe(200)
        const body = await res.json() as { status: string }
        expect(body.status).toBe('cancelled')
        expect(cliCalled).toBe(true)
    })

    test('DB cancelled 但 CLI 不在线 → 优雅降级，仍返回 {status:cancelled}', async () => {
        const engine = makeMockEngine({
            cancelQueuedMessageReturn: { cancelled: true, submitted: false },
            cancelCliQueuedMessageImpl: async () => { throw new Error('CLI disconnected') },
        })

        const res = await deleteMessage(engine)
        expect(res.status).toBe(200)
        const body = await res.json() as { status: string }
        // DB 已删即可，CLI 异常被吞
        expect(body.status).toBe('cancelled')
    })

    test('DB 无行 → 问 CLI → CLI 返回 cancelled', async () => {
        let cliCalled = false
        const engine = makeMockEngine({
            cancelQueuedMessageReturn: { cancelled: false, submitted: false },
            cancelCliQueuedMessageImpl: async () => { cliCalled = true; return { status: 'cancelled' } },
        })

        const res = await deleteMessage(engine)
        expect(res.status).toBe(200)
        const body = await res.json() as { status: string }
        expect(body.status).toBe('cancelled')
        expect(cliCalled).toBe(true)
    })

    test('DB 无行 → CLI 返回 submitted', async () => {
        const engine = makeMockEngine({
            cancelQueuedMessageReturn: { cancelled: false, submitted: false },
            cancelCliQueuedMessageImpl: async () => ({ status: 'submitted' }),
        })

        const res = await deleteMessage(engine)
        expect(res.status).toBe(200)
        const body = await res.json() as { status: string }
        expect(body.status).toBe('submitted')
    })

    test('DB 无行 → CLI 不可达 → 优雅降级返回 submitted', async () => {
        const engine = makeMockEngine({
            cancelQueuedMessageReturn: { cancelled: false, submitted: false },
            cancelCliQueuedMessageImpl: async () => { throw new Error('RPC handler not registered') },
        })

        const res = await deleteMessage(engine)
        expect(res.status).toBe(200)
        const body = await res.json() as { status: string }
        expect(body.status).toBe('submitted')
    })
})
