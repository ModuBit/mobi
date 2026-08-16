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

/**
 * web 工具配置路由（纯透传 → runner RPC）：
 * hub 不存任何 web 工具状态，配置真相源在目标机器的 ~/.mobi/settings.json
 */
import { Hono } from 'hono'
import type { SyncEngine } from '../../sync/syncEngine'
import type { WebAppEnv } from '../middleware/auth'
import { requireMachine } from './guards'

export function createWebToolsRoutes(getSyncEngine: () => SyncEngine | null): Hono<WebAppEnv> {
    const app = new Hono<WebAppEnv>()

    app.get('/machines/:id/web-tools', async (c) => {
        const engine = getSyncEngine()
        if (!engine) {
            return c.json({ error: 'Not connected' }, 503)
        }

        const machineId = c.req.param('id')
        const machine = requireMachine(c, engine, machineId)
        if (machine instanceof Response) {
            return machine
        }

        try {
            const result = await engine.getWebToolsConfig(machineId)
            return c.json(result)
        } catch (error) {
            // 502 = runner RPC 传输层不可达/超时；业务失败走 envelope 200（与 CLI 侧 RpcHandlerManager ack 行为对齐）
            return c.json({ error: error instanceof Error ? error.message : String(error) }, 502)
        }
    })

    app.post('/machines/:id/web-tools', async (c) => {
        const engine = getSyncEngine()
        if (!engine) {
            return c.json({ error: 'Not connected' }, 503)
        }

        const machineId = c.req.param('id')
        const machine = requireMachine(c, engine, machineId)
        if (machine instanceof Response) {
            return machine
        }

        const body = await c.req.json().catch(() => null) as { config?: unknown } | null
        if (!body || typeof body !== 'object' || body.config === undefined) {
            return c.json({ error: 'Missing config' }, 400)
        }

        try {
            const result = await engine.setWebToolsConfig(machineId, body.config)
            return c.json(result)
        } catch (error) {
            // 502 = runner RPC 传输层不可达/超时；业务失败走 envelope 200（与 CLI 侧 RpcHandlerManager ack 行为对齐）
            return c.json({ error: error instanceof Error ? error.message : String(error) }, 502)
        }
    })

    // 验证连接：透传 runner RPC（一次轻量真实搜索；凭据草稿优先于已存值，不落盘）
    app.post('/machines/:id/web-tools/verify', async (c) => {
        const engine = getSyncEngine()
        if (!engine) {
            return c.json({ error: 'Not connected' }, 503)
        }

        const machineId = c.req.param('id')
        const machine = requireMachine(c, engine, machineId)
        if (machine instanceof Response) {
            return machine
        }

        const body = await c.req.json().catch(() => null) as { providerId?: string; credentials?: Record<string, string> } | null
        if (!body?.providerId) {
            return c.json({ error: 'Missing providerId' }, 400)
        }

        try {
            const result = await engine.verifyWebToolsProvider(machineId, body.providerId, body.credentials)
            return c.json(result)
        } catch (error) {
            // 502 = runner RPC 传输层不可达/超时；业务失败走 envelope 200（与 get/set 一致）
            return c.json({ error: error instanceof Error ? error.message : String(error) }, 502)
        }
    })

    return app
}
