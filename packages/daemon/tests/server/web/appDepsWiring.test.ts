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
import { createWebApp } from '../../../src/web/server'
import { getAuthToken, setupTestApp } from '../helpers/setupTestApp'
import { resetConfiguration, createConfiguration } from '../../../src/configuration'
import type { SyncEngine } from '../../../src/sync/syncEngine'

/**
 * WebAppDeps 装配透传测试（架构深化候选①）：锁「字段到达消费点」——
 * 类型 satisfies 只锁字段存在，装配行为要单独锁（getWarmOnOpen 曾在
 * startWebServer→createWebApp 手抄透传时漏掉，信号链整链 noop，8311f1df）。
 * 经 createWebApp 完整装配层注入信号出口，断言 events 路由收到 visible 信号。
 */

describe('WebAppDeps 装配：getWarmOnOpen 必达 events 路由', () => {
    test('snapshot-resync 经完整装配层触发 warm 信号（8311f1df 回归）', async () => {
        // configuration 初始化（corsOrigins 等）——对齐 setupTestApp 的隔离形态
        await setupTestApp(null)
        resetConfiguration()
        process.env.MOBI_PUBLIC_URL = 'http://localhost:2222'
        await createConfiguration()

        const viewed: Array<{ sessionId: string; visible: boolean }> = []
        const manager = {
            getSubscription: (id: string) => (id === 'sub-1' ? { id: 'sub-1', namespace: 'default' } : null),
            resyncSnapshots: () => 0,
        }
        const engine = {
            resolveSessionAccess: (sessionId: string, ns: string) =>
                ns === 'default'
                    ? { ok: true as const, sessionId, session: { id: sessionId } }
                    : { ok: false as const, reason: 'access-denied' as const },
        }
        const app = createWebApp({
            getSseManager: () => manager as never,
            getSyncEngine: () => engine as unknown as SyncEngine,
            getVisibilityTracker: () => null,
            getWarmOnOpen: () => ({ onSessionViewed: (sessionId, visible) => { viewed.push({ sessionId, visible }) } }),
            jwtSecret: new Uint8Array(32),
            store: { push: {} } as never,
            vapidPublicKey: 'test-vapid',
            embeddedAssetMap: null,
        })
        const token = await getAuthToken(app)

        const res = await app.request('/api/snapshot-resync', {
            method: 'POST',
            headers: {
                'content-type': 'application/json',
                authorization: `Bearer ${token}`,
            },
            body: JSON.stringify({ subscriptionId: 'sub-1', sessionId: 's1' }),
        })
        expect(res.status).toBe(200)
        expect(viewed).toEqual([{ sessionId: 's1', visible: true }])
    })
})
