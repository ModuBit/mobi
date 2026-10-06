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
 * web 工具配置路由（纯透传 → executor RPC；ticket 204 顶级化，原 /api/machines/:id/web-tools）：
 * daemon 不存任何 web 工具状态，配置真相源在宿主的 ~/.mobi/settings.cli.json。
 * executor 未就绪（bridge 未接线/RPC 不可达）→ 502，web 据此呈现 offline。
 */
import { Hono } from 'hono'
import { VerifyWebToolsProviderSchema } from '@mobi/shared'
import type { SyncEngine } from '../../sync/syncEngine'
import type { WebAppEnv } from '../middleware/auth'

export function createWebToolsRoutes(getSyncEngine: () => SyncEngine | null): Hono<WebAppEnv> {
    const app = new Hono<WebAppEnv>()

    app.get('/web-tools', async (c) => {
        const engine = getSyncEngine()
        if (!engine) {
            return c.json({ error: 'Not connected' }, 503)
        }

        try {
            const result = await engine.getWebToolsConfig()
            return c.json(result)
        } catch (error) {
            // 502 = executor RPC 传输层不可达/超时；业务失败走 envelope 200（与 CLI 侧 RpcHandlerManager ack 行为对齐）
            return c.json({ error: error instanceof Error ? error.message : String(error) }, 502)
        }
    })

    app.post('/web-tools', async (c) => {
        const engine = getSyncEngine()
        if (!engine) {
            return c.json({ error: 'Not connected' }, 503)
        }

        const body = await c.req.json().catch(() => null) as { config?: unknown } | null
        if (!body || typeof body !== 'object' || body.config === undefined) {
            return c.json({ error: 'Missing config' }, 400)
        }

        try {
            const result = await engine.setWebToolsConfig(body.config)
            return c.json(result)
        } catch (error) {
            // 502 = executor RPC 传输层不可达/超时；业务失败走 envelope 200（与 CLI 侧 RpcHandlerManager ack 行为对齐）
            return c.json({ error: error instanceof Error ? error.message : String(error) }, 502)
        }
    })

    // 验证连接：透传 executor RPC（一次轻量真实搜索；凭据草稿优先于已存值，不落盘）
    app.post('/web-tools/verify', async (c) => {
        const engine = getSyncEngine()
        if (!engine) {
            return c.json({ error: 'Not connected' }, 503)
        }

        // schema 校验（与 executor handler 共用 VerifyWebToolsProviderSchema）：
        // credentials 畸形值（null/数字）在边界拒绝，而非透传后被静默过滤造成验证假阳性
        const body = await c.req.json().catch(() => null)
        const parsed = VerifyWebToolsProviderSchema.safeParse(body)
        if (!parsed.success) {
            const issue = parsed.error.issues[0]
            return c.json({ error: `Invalid verify request (${issue?.path.join('.') ?? 'body'}): ${issue?.message ?? ''}` }, 400)
        }

        try {
            const result = await engine.verifyWebToolsProvider(parsed.data.providerId, parsed.data.credentials)
            return c.json(result)
        } catch (error) {
            // 502 = executor RPC 传输层不可达/超时；业务失败走 envelope 200（与 get/set 一致）
            return c.json({ error: error instanceof Error ? error.message : String(error) }, 502)
        }
    })

    return app
}
