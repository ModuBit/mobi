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
 * Desktop 观看 API（web → hub）。
 *
 * watch：为 machine 开一条观看会话（hub 内签发 attach ticket + observe token），
 * 并经 machine RPC 触发 CLI 反连 attach 路径。observe token 走响应体返回、
 * 组件内存持有——不进 URL（spec：token 不进地址栏/历史记录）。
 */

import { Hono } from 'hono'
import { desktopWatchRequestSchema, DESKTOP_ATTACH_PATH, type DesktopWatchResponse } from '@mobi/shared'
import type { SyncEngine } from '../sync/syncEngine'
import type { WebAppEnv } from '../web/middleware/auth'
import { requireMachine, requireSyncEngine } from '../web/routes/guards'
import type { DesktopBroker } from './broker'

export function createDesktopRoutes(deps: {
    getSyncEngine: () => SyncEngine | null
    getDesktopBroker: () => DesktopBroker | null
}): Hono<WebAppEnv> {
    const app = new Hono<WebAppEnv>()

    app.post('/desktop/watch', async (c) => {
        const engine = requireSyncEngine(c, deps.getSyncEngine)
        if (engine instanceof Response) {
            return engine
        }
        const broker = deps.getDesktopBroker()
        if (!broker) {
            return c.json({ error: 'Desktop not available' }, 503)
        }

        const body = await c.req.json().catch(() => null)
        const parsed = desktopWatchRequestSchema.safeParse(body)
        if (!parsed.success) {
            return c.json({ error: 'Invalid request' }, 400)
        }

        const machine = requireMachine(c, engine, parsed.data.machineId)
        if (machine instanceof Response) {
            return machine
        }

        // 会话先建（含票据），再触发 CLI 反连；RPC 失败则回滚会话
        const session = broker.watchSession(parsed.data.machineId)
        try {
            await engine.machineDesktopStream(session.machineId, session.attachTicket, DESKTOP_ATTACH_PATH)
        } catch (error) {
            broker.teardownSession(session.sessionId, 4002, 'cli unreachable')
            const message = error instanceof Error ? error.message : 'Failed to reach cli'
            return c.json({ error: `Desktop stream unavailable: ${message}` }, 502)
        }

        const response: DesktopWatchResponse = {
            observeToken: session.observeToken,
            expiresAtMs: session.expiresAtMs,
        }
        return c.json(response)
    })

    return app
}
