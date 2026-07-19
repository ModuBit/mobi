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
 * 构造可配置的 mock SyncEngine，用于测试 DELETE 路由。
 * 新语义：CLI 是「是否仍可安全取消」的权威——getMessageSubmitState 非破坏性探测 DB，
 * 仅当 DB 仍 pending 且 CLI 未 in-flight 时才 cancelQueuedMessage 物理删除。
 */
function makeMockEngine(opts: {
    submitState: { exists: boolean; submitted: boolean }
    cancelQueuedMessageReturn?: { cancelled: boolean; submitted: boolean }
    cancelCliQueuedMessageImpl?: (sessionId: string, localId: string) => Promise<{ status: 'cancelled' | 'submitted' | 'not-in-queue' }>
}): SyncEngine & { deleteCalled: boolean } {
    const engine = {
        deleteCalled: false,
        resolveSessionAccess: (_id: string, _ns: string) => ({
            ok: true as const,
            sessionId: 'test-session-1',
            session: mockSession,
        }),
        getMessageSubmitState: () => opts.submitState,
        cancelQueuedMessage: () => {
            engine.deleteCalled = true
            return opts.cancelQueuedMessageReturn ?? { cancelled: true, submitted: false }
        },
        cancelCliQueuedMessage: opts.cancelCliQueuedMessageImpl
            ?? (() => Promise.resolve({ status: 'submitted' as const })),
    }
    return engine as unknown as SyncEngine & { deleteCalled: boolean }
}

describe('DELETE /api/sessions/:id/messages/:messageId（CLI 权威的取消）', () => {
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

    test('DB 已 consumed → {status:submitted}，不调 CLI、不删 DB', async () => {
        let cliCalled = false
        const engine = makeMockEngine({
            submitState: { exists: true, submitted: true },
            cancelCliQueuedMessageImpl: async () => { cliCalled = true; return { status: 'submitted' } },
        })

        const res = await deleteMessage(engine)
        const body = await res.json() as { status: string }
        expect(body.status).toBe('submitted')
        expect(cliCalled).toBe(false)
        expect(engine.deleteCalled).toBe(false)
    })

    test('DB pending 且 CLI in-flight → {status:submitted}，不删 DB（防幽灵消息）', async () => {
        const engine = makeMockEngine({
            submitState: { exists: true, submitted: false },
            cancelCliQueuedMessageImpl: async () => ({ status: 'submitted' }),
        })

        const res = await deleteMessage(engine)
        const body = await res.json() as { status: string }
        expect(body.status).toBe('submitted')
        expect(engine.deleteCalled).toBe(false) // 关键：已 collect 的消息绝不删
    })

    test('DB pending 且 CLI 仍在队列 → 删 DB → {status:cancelled}', async () => {
        const engine = makeMockEngine({
            submitState: { exists: true, submitted: false },
            cancelCliQueuedMessageImpl: async () => ({ status: 'cancelled' }),
        })

        const res = await deleteMessage(engine)
        const body = await res.json() as { status: string }
        expect(body.status).toBe('cancelled')
        expect(engine.deleteCalled).toBe(true)
    })

    test('DB pending 且 CLI not-in-queue（尚未送达）→ 删 DB → {status:cancelled}', async () => {
        const engine = makeMockEngine({
            submitState: { exists: true, submitted: false },
            cancelCliQueuedMessageImpl: async () => ({ status: 'not-in-queue' }),
        })

        const res = await deleteMessage(engine)
        const body = await res.json() as { status: string }
        expect(body.status).toBe('cancelled')
        expect(engine.deleteCalled).toBe(true)
    })

    test('DB pending 但 CLI 不可达 → 保守返回 submitted，不删 DB', async () => {
        const engine = makeMockEngine({
            submitState: { exists: true, submitted: false },
            cancelCliQueuedMessageImpl: async () => { throw new Error('CLI disconnected') },
        })

        const res = await deleteMessage(engine)
        const body = await res.json() as { status: string }
        expect(body.status).toBe('submitted')
        expect(engine.deleteCalled).toBe(false) // CLI 状态未知时不冒险删除
    })

    test('DB 无行 → 问 CLI → CLI cancelled → {status:cancelled}，不删 DB', async () => {
        const engine = makeMockEngine({
            submitState: { exists: false, submitted: false },
            cancelCliQueuedMessageImpl: async () => ({ status: 'cancelled' }),
        })

        const res = await deleteMessage(engine)
        const body = await res.json() as { status: string }
        expect(body.status).toBe('cancelled')
        expect(engine.deleteCalled).toBe(false)
    })

    test('DB 无行 → CLI submitted → {status:submitted}', async () => {
        const engine = makeMockEngine({
            submitState: { exists: false, submitted: false },
            cancelCliQueuedMessageImpl: async () => ({ status: 'submitted' }),
        })

        const res = await deleteMessage(engine)
        const body = await res.json() as { status: string }
        expect(body.status).toBe('submitted')
    })

    test('DB 无行 → CLI not-in-queue → 归并 {status:submitted}（对齐 Web 契约，不泄漏 not-in-queue）', async () => {
        const engine = makeMockEngine({
            submitState: { exists: false, submitted: false },
            cancelCliQueuedMessageImpl: async () => ({ status: 'not-in-queue' }),
        })

        const res = await deleteMessage(engine)
        const body = await res.json() as { status: string }
        expect(body.status).toBe('submitted')
    })

    test('DB 无行 → CLI 不可达 → 优雅降级 submitted', async () => {
        const engine = makeMockEngine({
            submitState: { exists: false, submitted: false },
            cancelCliQueuedMessageImpl: async () => { throw new Error('RPC handler not registered') },
        })

        const res = await deleteMessage(engine)
        const body = await res.json() as { status: string }
        expect(body.status).toBe('submitted')
    })
})
