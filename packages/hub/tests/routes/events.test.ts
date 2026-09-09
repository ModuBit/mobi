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
import type { SyncEngine } from '../../src/sync/syncEngine'

/**
 * /snapshot-resync 订阅属主校验（D1）：定向 resync 绕过 broadcast 的 namespace 过滤，
 * 订阅不属调用者 namespace 时必须 404 拒绝。
 */

function makeApp(namespace: string, synced = 1) {
    const resyncCalls: Array<{ subscriptionId: string; sessionId: string; namespace?: string }> = []
    // 最小 fake：路由只保留鉴权与订阅属主校验，具体基线构造由 SnapshotSync 测试覆盖。
    const manager = {
        getSubscription: (id: string) => (id === 'sub-1' ? { id: 'sub-1', namespace: 'ns-a' } : null),
        resyncSnapshots: (subscriptionId: string, sessionId: string, targetNamespace?: string) => {
            resyncCalls.push({ subscriptionId, sessionId, namespace: targetNamespace })
            return synced
        },
    }
    const engine = {
        resolveSessionAccess: (sessionId: string, ns: string) =>
            ns === namespace
                ? { ok: true as const, sessionId, session: { id: sessionId } }
                : { ok: false as const, reason: 'access-denied' as const },
    }
    const app = new Hono<{ Variables: { namespace: string } }>()
    app.use('*', async (c, next) => {
        c.set('namespace', namespace)
        await next()
    })
    app.route('/', createEventsRoutes(
        () => manager as never,
        () => engine as unknown as SyncEngine,
        () => null,
    ))
    return { app, resyncCalls }
}

describe('POST /snapshot-resync — 订阅属主校验（D1）', () => {
    test('订阅不属调用者 namespace → 404，不补发也不重置游标', async () => {
        const { app, resyncCalls } = makeApp('ns-b') // 调用者 ns-b，订阅属 ns-a

        const res = await app.request('/snapshot-resync', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ subscriptionId: 'sub-1', sessionId: 's1' }),
        })
        expect(res.status).toBe(404)
        expect(resyncCalls).toHaveLength(0)
    })

    test('订阅不存在 → 404', async () => {
        const { app } = makeApp('ns-a')
        const res = await app.request('/snapshot-resync', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ subscriptionId: 'sub-x', sessionId: 's1' }),
        })
        expect(res.status).toBe(404)
    })

    test('属主匹配 → 补发活跃流全量基线并重置游标', async () => {
        const { app, resyncCalls } = makeApp('ns-a', 2)

        const res = await app.request('/snapshot-resync', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ subscriptionId: 'sub-1', sessionId: 's1' }),
        })
        expect(res.status).toBe(200)
        expect(resyncCalls).toEqual([{ subscriptionId: 'sub-1', sessionId: 's1', namespace: 'ns-a' }])
        expect(await res.json()).toEqual({ ok: true, synced: 2 })
    })
})
