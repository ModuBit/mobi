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

import { Hono, type Context } from 'hono'
import {
    desktopWatchRequestSchema,
    desktopVncPasswordSubmissionSchema,
    DESKTOP_ATTACH_PATH,
    DESKTOP_CLOSE_CODE,
    DESKTOP_CLOSE_REASONS,
    type DesktopWatchResponse,
    type DesktopStreamsResponse,
    type DesktopControlResponse,
} from '@mobi/shared'
import type { SyncEngine } from '../sync/syncEngine'
import type { WebAppEnv } from '../web/middleware/auth'
import { requireMachine, requireSyncEngine } from '../web/routes/guards'
import type { DesktopBroker } from './broker'

export function createDesktopRoutes(deps: {
    getSyncEngine: () => SyncEngine | null
    getDesktopBroker: () => DesktopBroker | null
}): Hono<WebAppEnv> {
    const app = new Hono<WebAppEnv>()

    /** desktop 路由可用前提的统一短路：engine 缺失随 requireSyncEngine，broker 缺失 503 */
    function requireDesktopBroker(c: { json: (data: unknown, status?: number) => Response }): DesktopBroker | Response {
        const broker = deps.getDesktopBroker()
        if (!broker) {
            return c.json({ error: 'Desktop not available' }, 503)
        }
        return broker
    }

    app.post('/desktop/watch', async (c) => {
        const engine = requireSyncEngine(c, deps.getSyncEngine)
        if (engine instanceof Response) {
            return engine
        }
        const broker = requireDesktopBroker(c)
        if (broker instanceof Response) {
            return broker
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
            broker.teardownSession(session.sessionId, DESKTOP_CLOSE_CODE.CLOSED, 'cli unreachable')
            const message = error instanceof Error ? error.message : 'Failed to reach cli'
            return c.json({ error: `Desktop stream unavailable: ${message}` }, 502)
        }

        const response: DesktopWatchResponse = {
            observeToken: session.observeToken,
            expiresAtMs: session.expiresAtMs,
        }
        return c.json(response)
    })

    // 活跃流列表（侧边栏「远程桌面」分区数据源；跨设备一致）
    app.get('/desktop/streams', (c) => {
        const broker = requireDesktopBroker(c)
        if (broker instanceof Response) {
            return broker
        }
        const response: DesktopStreamsResponse = { streams: broker.listSessions() }
        return c.json(response)
    })

    // 主动关闭流（显式权限操作，与 web GC 正交）：拆上游 + 作废本会话全部票据。
    // 同 machineId 同一时刻只有一条会话（抢占语义），拆会话即该 machine 全部票据作废
    app.delete('/desktop/streams/:sessionId', (c) => {
        const broker = requireDesktopBroker(c)
        if (broker instanceof Response) {
            return broker
        }
        const tornDown = broker.teardownSession(c.req.param('sessionId'), DESKTOP_CLOSE_CODE.CLOSED, DESKTOP_CLOSE_REASONS.STREAM_CLOSED)
        if (!tornDown) {
            return c.json({ error: 'Stream not found' }, 404)
        }
        return c.json({ success: true })
    })

    // 控制权授予/退出（迭代 2）：按钮直授，幂等；按 machineId 定位（同 machine 只有一条流），
    // hub 翻转过滤器状态并广播。两端点仅变迁方向不同，守卫与响应形状共用
    const handleControlChange = (
        c: Context<WebAppEnv>,
        change: (broker: DesktopBroker, machineId: string) => DesktopControlResponse | null,
    ) => {
        const engine = requireSyncEngine(c, deps.getSyncEngine)
        if (engine instanceof Response) {
            return engine
        }
        const broker = requireDesktopBroker(c)
        if (broker instanceof Response) {
            return broker
        }
        const machineId = c.req.param('machineId') ?? ''
        const machine = requireMachine(c, engine, machineId)
        if (machine instanceof Response) {
            return machine
        }
        const result = change(broker, machineId)
        if (!result) {
            return c.json({ error: 'Stream not found' }, 404)
        }
        const response: DesktopControlResponse = result
        return c.json(response)
    }

    app.post('/desktop/machines/:machineId/control', (c) =>
        handleControlChange(c, (broker, machineId) => broker.grantControl(machineId)))
    app.delete('/desktop/machines/:machineId/control', (c) =>
        handleControlChange(c, (broker, machineId) => broker.releaseControl(machineId, 'released by user')))

    // VNC 密码写入：hub 纯中转（machine RPC），不落盘副本；校验在 cli 侧 schema 兜底
    app.post('/desktop/vnc-password', async (c) => {
        const engine = requireSyncEngine(c, deps.getSyncEngine)
        if (engine instanceof Response) {
            return engine
        }

        const body = await c.req.json().catch(() => null)
        const parsed = desktopVncPasswordSubmissionSchema.safeParse(body)
        if (!parsed.success) {
            return c.json({ error: 'VNC 密码须为 1-16 个字符' }, 400)
        }

        const machine = requireMachine(c, engine, parsed.data.machineId)
        if (machine instanceof Response) {
            return machine
        }

        try {
            await engine.machineDesktopSetVncPassword(machine.id, parsed.data.vncPassword)
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Failed to reach cli'
            return c.json({ error: `Failed to save VNC password: ${message}` }, 502)
        }
        return c.json({ success: true })
    })

    // VNC 密码配置状态（只回是否已配置，密码不回读）
    app.get('/desktop/vnc-status', async (c) => {
        const engine = requireSyncEngine(c, deps.getSyncEngine)
        if (engine instanceof Response) {
            return engine
        }

        const machineId = c.req.query('machineId') ?? ''
        const machine = requireMachine(c, engine, machineId)
        if (machine instanceof Response) {
            return machine
        }

        try {
            const status = await engine.machineDesktopVncStatus(machine.id)
            return c.json(status)
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Failed to reach cli'
            return c.json({ error: `Failed to read VNC status: ${message}` }, 502)
        }
    })

    return app
}
