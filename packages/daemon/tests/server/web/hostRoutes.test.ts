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

import { describe, expect, it, vi } from 'bun:test'
import { Hono } from 'hono'
import type { WebAppEnv } from '../../../src/web/middleware/auth'
import type { SyncEngine } from '../../../src/sync/syncEngine'
import { createHostRoutes } from '../../../src/web/routes/host'

/**
 * daemon 状态域路由：GET /api/daemon/status（205 补全 executor 段）。
 * 投影单一来源 = engine.getDaemonStatus()（daemon-status SSE 同形）；engine 未接入
 * （启动早期）返回 503 starting。
 */

function createTestApp(engine: SyncEngine | null) {
    const app = new Hono<WebAppEnv>()
    app.use('*', async (c, next) => {
        c.set('namespace', 'ns-test')
        await next()
    })
    app.route('/api', createHostRoutes(() => engine))
    return app
}

describe('GET /api/daemon/status', () => {
    it('engine 未接入（启动早期）→ 503 starting', async () => {
        const res = await createTestApp(null).request('/api/daemon/status')
        expect(res.status).toBe(503)
        expect(await res.json()).toEqual({ status: 'starting' })
    })

    it('就绪 → 透传 getDaemonStatus 投影（host 静态身份 + executor 运行时）', async () => {
        const projection = {
            status: 'ok' as const,
            host: { hostname: 'mbp', platform: 'darwin', displayName: 'MacBook Pro', homeDir: '/Users/me' },
            executor: { status: 'running', pid: 4321, startedAt: 42 },
        }
        const getSpy = vi.fn().mockReturnValue(projection)
        const app = createTestApp({ getDaemonStatus: getSpy } as unknown as SyncEngine)
        const res = await app.request('/api/daemon/status')
        expect(res.status).toBe(200)
        expect(await res.json()).toEqual(projection)
        // 路由不自制投影——与 SSE 事件同源同形
        expect(getSpy).toHaveBeenCalledTimes(1)
    })
})
