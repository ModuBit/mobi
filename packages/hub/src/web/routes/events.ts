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

import { Hono } from 'hono'
import { streamSSE } from 'hono/streaming'
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import type { SSEManager } from '../../sse/sseManager'
import type { SyncEngine } from '../../sync/syncEngine'
import type { VisibilityState } from '../../visibility/visibilityTracker'
import type { VisibilityTracker } from '../../visibility/visibilityTracker'
import type { WebAppEnv } from '../middleware/auth'
import { requireSession } from './guards'

function parseOptionalId(value: string | undefined): string | null {
    if (!value) {
        return null
    }
    return value.trim() ? value : null
}

function parseBoolean(value: string | undefined): boolean {
    if (!value) {
        return false
    }
    return value === 'true' || value === '1'
}

function parseVisibility(value: string | undefined): VisibilityState {
    return value === 'visible' ? 'visible' : 'hidden'
}

const visibilitySchema = z.object({
    subscriptionId: z.string().min(1),
    visibility: z.enum(['visible', 'hidden'])
})

/** snapshot resync（delta 协议票 02）：web 打开会话时主动补发流式中的全量基线 */
const snapshotResyncSchema = z.object({
    subscriptionId: z.string().min(1),
    sessionId: z.string().min(1)
})

export function createEventsRoutes(
    getSseManager: () => SSEManager | null,
    getSyncEngine: () => SyncEngine | null,
    getVisibilityTracker: () => VisibilityTracker | null,
): Hono<WebAppEnv> {
    const app = new Hono<WebAppEnv>()

    // 建立SSE连接
    app.get('/events', (c) => {
        const manager = getSseManager()
        if (!manager) {
            return c.json({ error: 'Not connected' }, 503)
        }

        const query = c.req.query()
        const all = parseBoolean(query.all)
        const sessionId = parseOptionalId(query.sessionId)
        const machineId = parseOptionalId(query.machineId)
        const subscriptionId = randomUUID()
        const visibility = parseVisibility(query.visibility)
        // snapshot delta 能力协商（票 02）：老 web 不带参数 → 恒收全量（零破坏升级）
        const snapshotDelta = parseBoolean(query.snapshotDelta)
        const namespace = c.get('namespace')
        let resolvedSessionId = sessionId

        if (sessionId || machineId) {
            const engine = getSyncEngine()
            if (!engine) {
                return c.json({ error: 'Not connected' }, 503)
            }
            if (sessionId) {
                const sessionResult = requireSession(c, engine, sessionId)
                if (sessionResult instanceof Response) {
                    return sessionResult
                }
                resolvedSessionId = sessionResult.sessionId
            }
            if (machineId) {
                const machine = engine.getMachine(machineId)
                if (!machine) {
                    return c.json({ error: 'Machine not found' }, 404)
                }
                if (machine.namespace !== namespace) {
                    return c.json({ error: 'Machine access denied' }, 403)
                }
            }
        }

        return streamSSE(c, async (stream) => {
            manager.subscribe({
                id: subscriptionId,
                namespace,
                all,
                sessionId: resolvedSessionId,
                machineId,
                visibility,
                snapshotDelta,
                send: (event) => stream.writeSSE({ data: JSON.stringify(event) }),
                sendHeartbeat: async () => {
                    await stream.writeSSE({
                        data: JSON.stringify({
                            type: 'heartbeat',
                            namespace,
                            data: {
                                timestamp: Date.now()
                            }
                        })
                    })
                }
            })

            await stream.writeSSE({
                data: JSON.stringify({
                    type: 'connection-changed',
                    data: {
                        status: 'connected',
                        subscriptionId
                    }
                })
            })

            await new Promise<void>((resolve) => {
                const done = () => resolve()
                c.req.raw.signal.addEventListener('abort', done, { once: true })
                stream.onAbort(done)
            })

            manager.unsubscribe(subscriptionId)
        })
    })

    // 维护SSE连接所在页面可见性
    app.post('/visibility', async (c) => {
        const tracker = getVisibilityTracker()
        if (!tracker) {
            return c.json({ error: 'Not connected' }, 503)
        }

        const json = await c.req.json().catch(() => null)
        const parsed = visibilitySchema.safeParse(json)
        if (!parsed.success) {
            return c.json({ error: 'Invalid body' }, 400)
        }

        const namespace = c.get('namespace')
        const updated = tracker.setVisibility(parsed.data.subscriptionId, namespace, parsed.data.visibility)
        if (!updated) {
            return c.json({ error: 'Subscription not found' }, 404)
        }

        return c.json({ ok: true })
    })

    /**
     * snapshot resync（delta 协议票 02）：web 打开会话（或重连）后主动调用。
     * 对该会话所有流式中的消息（拼接器活跃缓存）定向补发全量基线 + 重建订阅游标，
     * 此后 delta 帧继续衔接——解决「窗口无记录却收到 delta」的缺口（首拉竞态模式的 SSE 侧补拉）。
     */
    app.post('/snapshot-resync', async (c) => {
        const manager = getSseManager()
        if (!manager) {
            return c.json({ error: 'Not connected' }, 503)
        }

        const json = await c.req.json().catch(() => null)
        const parsed = snapshotResyncSchema.safeParse(json)
        if (!parsed.success) {
            return c.json({ error: 'Invalid body' }, 400)
        }

        const engine = getSyncEngine()
        if (!engine) {
            return c.json({ error: 'Not connected' }, 503)
        }
        // 会话访问校验（同 events 建连的 requireSession 语义）
        const sessionResult = requireSession(c, engine, parsed.data.sessionId)
        if (sessionResult instanceof Response) {
            return sessionResult
        }

        // 订阅属主校验（对齐 /visibility 模式）：定向 resync 不走 broadcast namespace 过滤，
        // 目标订阅不属调用者 namespace 时必须拒绝。
        const subscription = manager.getSubscription(parsed.data.subscriptionId)
        if (!subscription || subscription.namespace !== c.get('namespace')) {
            return c.json({ error: 'Subscription not found' }, 404)
        }

        const synced = manager.resyncSnapshots(
            parsed.data.subscriptionId,
            sessionResult.sessionId,
            c.get('namespace'),
        )

        return c.json({ ok: true, synced })
    })

    return app
}
