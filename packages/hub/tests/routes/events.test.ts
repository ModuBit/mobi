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

import { describe, test, expect } from 'bun:test'
import { Hono } from 'hono'
import { createEventsRoutes } from '../../src/web/routes/events'
import { SnapshotDeltaAssembler } from '../../src/sync/snapshotDeltaAssembler'
import { SnapshotDeltaForwarder } from '../../src/sse/snapshotDeltaForwarder'
import { textEnvelope } from '../helpers/snapshotDelta'
import type { SyncEngine } from '../../src/sync/syncEngine'

/**
 * /snapshot-resync 订阅属主校验（D1）：sendTo 绕过 shouldSend 的 namespace 过滤，
 * 订阅不属调用者 namespace 时必须 404 拒绝——否则跨 namespace 注入流式内容 + 重置受害者游标。
 */

function makeApp(namespace: string, assembler: SnapshotDeltaAssembler) {
    const sent: Array<{ id: string; event: { type: string; message: { localId: string | null; snapshotRev?: number } } }> = []
    const resetCalls: string[] = []
    // 最小 fake：manager 只实现 resync 路径用到的 getSubscription / sendTo
    const manager = {
        getSubscription: (id: string) => (id === 'sub-1' ? { id: 'sub-1', namespace: 'ns-a' } : null),
        sendTo: (id: string, event: never) => { sent.push({ id, event }) },
    }
    const engine = {
        resolveSessionAccess: (sessionId: string, ns: string) =>
            ns === namespace
                ? { ok: true as const, sessionId, session: { id: sessionId } }
                : { ok: false as const, reason: 'access-denied' as const },
    }
    const forwarder = new SnapshotDeltaForwarder(assembler)
    const originalReset = forwarder.resetSubscription.bind(forwarder)
    forwarder.resetSubscription = (id: string) => { resetCalls.push(id); originalReset(id) }

    const app = new Hono<{ Variables: { namespace: string } }>()
    app.use('*', async (c, next) => {
        c.set('namespace', namespace)
        await next()
    })
    app.route('/', createEventsRoutes(
        () => manager as never,
        () => engine as unknown as SyncEngine,
        () => null,
        () => ({ assembler, forwarder }),
    ))
    return { app, sent, resetCalls }
}

describe('POST /snapshot-resync — 订阅属主校验（D1）', () => {
    test('订阅不属调用者 namespace → 404，不补发也不重置游标', async () => {
        const assembler = new SnapshotDeltaAssembler()
        assembler.applyFull('s1', 'u1', textEnvelope('流式'), 1)
        const { app, sent, resetCalls } = makeApp('ns-b', assembler) // 调用者 ns-b，订阅属 ns-a

        const res = await app.request('/snapshot-resync', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ subscriptionId: 'sub-1', sessionId: 's1' }),
        })
        expect(res.status).toBe(404)
        expect(sent).toHaveLength(0)
        expect(resetCalls).toHaveLength(0)
    })

    test('订阅不存在 → 404', async () => {
        const { app } = makeApp('ns-a', new SnapshotDeltaAssembler())
        const res = await app.request('/snapshot-resync', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ subscriptionId: 'sub-x', sessionId: 's1' }),
        })
        expect(res.status).toBe(404)
    })

    test('属主匹配 → 补发活跃流全量基线并重置游标', async () => {
        const assembler = new SnapshotDeltaAssembler()
        assembler.applyFull('s1', 'u1', textEnvelope('流式'), 1)
        const { app, sent, resetCalls } = makeApp('ns-a', assembler)

        const res = await app.request('/snapshot-resync', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ subscriptionId: 'sub-1', sessionId: 's1' }),
        })
        expect(res.status).toBe(200)
        expect(resetCalls).toEqual(['sub-1'])
        expect(sent).toHaveLength(1)
        const event = sent[0].event
        expect(event.type).toBe('message-snapshot')
        expect(event.message.localId).toBe('u1')
        expect(event.message.snapshotRev).toBe(1)
    })
})
