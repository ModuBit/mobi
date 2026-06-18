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

describe('push routes — GET /api/push/subscription(查 namespace 订阅状态)', () => {
    let setup: Awaited<ReturnType<typeof setupTestApp>>
    let token: string

    beforeEach(async () => {
        setup = await setupTestApp()
        token = await getAuthToken(setup.app)
    })
    afterEach(() => setup.cleanup())

    test('无订阅 → subscribed=false', async () => {
        const res = await setup.app.request('/api/push/subscription', {
            headers: { Authorization: `Bearer ${token}` },
        })
        const body = await res.json() as { subscribed: boolean }
        expect(res.status).toBe(200)
        expect(body.subscribed).toBe(false)
    })

    test('已订阅(POST /api/push/subscribe 后)→ subscribed=true', async () => {
        // 先订阅一条
        const sub = await setup.app.request('/api/push/subscribe', {
            method: 'POST',
            headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ endpoint: 'https://push.test/ep', keys: { p256dh: 'p', auth: 'a' } }),
        })
        expect(sub.status).toBe(200)

        // 再查询 → 该 namespace 有订阅
        const res = await setup.app.request('/api/push/subscription', {
            headers: { Authorization: `Bearer ${token}` },
        })
        const body = await res.json() as { subscribed: boolean }
        expect(res.status).toBe(200)
        expect(body.subscribed).toBe(true)
    })
})
