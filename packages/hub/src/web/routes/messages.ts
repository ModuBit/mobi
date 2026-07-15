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
import { AttachmentMetadataSchema } from '@mobi/shared/schemas'
import { z } from 'zod'
import type { SyncEngine } from '../../sync/syncEngine'
import type { WebAppEnv } from '../middleware/auth'
import { requireSessionFromParam, requireSyncEngine } from './guards'

const querySchema = z.object({
    limit: z.coerce.number().int().min(1).max(200).optional(),
    beforeSeq: z.coerce.number().int().min(1).optional()
})

const sidechainQuerySchema = z.object({
    parentToolUseId: z.string().min(1),
})

const sendMessageBodySchema = z.object({
    text: z.string(),
    localId: z.string().min(1).optional(),
    attachments: z.array(AttachmentMetadataSchema).optional()
})

export function createMessagesRoutes(getSyncEngine: () => SyncEngine | null): Hono<WebAppEnv> {
    const app = new Hono<WebAppEnv>()

    app.get('/sessions/:id/messages', async (c) => {
        const engine = requireSyncEngine(c, getSyncEngine)
        if (engine instanceof Response) {
            return engine
        }

        const sessionResult = requireSessionFromParam(c, engine)
        if (sessionResult instanceof Response) {
            return sessionResult
        }
        const sessionId = sessionResult.sessionId

        const parsed = querySchema.safeParse(c.req.query())
        const limit = parsed.success ? (parsed.data.limit ?? 50) : 50
        const beforeSeq = parsed.success ? (parsed.data.beforeSeq ?? null) : null
        return c.json(engine.getMessagesPage(sessionId, { limit, beforeSeq }))
    })

    app.get('/sessions/:id/sidechain-messages', async (c) => {
        const engine = requireSyncEngine(c, getSyncEngine)
        if (engine instanceof Response) {
            return engine
        }

        const sessionResult = requireSessionFromParam(c, engine)
        if (sessionResult instanceof Response) {
            return sessionResult
        }
        const sessionId = sessionResult.sessionId

        const parsed = sidechainQuerySchema.safeParse(c.req.query())
        if (!parsed.success) {
            return c.json({ error: 'parentToolUseId is required' }, 400)
        }

        const messages = engine.getSidechainMessages(sessionId, parsed.data.parentToolUseId)
        return c.json({ messages })
    })

    app.post('/sessions/:id/messages', async (c) => {
        const engine = requireSyncEngine(c, getSyncEngine)
        if (engine instanceof Response) {
            return engine
        }

        const sessionResult = requireSessionFromParam(c, engine, { requireActive: true })
        if (sessionResult instanceof Response) {
            return sessionResult
        }
        const sessionId = sessionResult.sessionId

        const body = await c.req.json().catch(() => null)
        const parsed = sendMessageBodySchema.safeParse(body)
        if (!parsed.success) {
            return c.json({ error: 'Invalid body' }, 400)
        }

        // Require text or attachments
        if (!parsed.data.text && (!parsed.data.attachments || parsed.data.attachments.length === 0)) {
            return c.json({ error: 'Message requires text or attachments' }, 400)
        }

        await engine.sendMessage(sessionId, {
            text: parsed.data.text,
            localId: parsed.data.localId,
            attachments: parsed.data.attachments,
            sentFrom: 'webapp'
        })
        return c.json({ ok: true })
    })

    // 取消排队消息（两阶段取消：DB 层 + CLI 内存层）
    app.delete('/sessions/:id/messages/:messageId', async (c) => {
        const engine = requireSyncEngine(c, getSyncEngine)
        if (engine instanceof Response) {
            return engine
        }

        const sessionResult = requireSessionFromParam(c, engine)
        if (sessionResult instanceof Response) {
            return sessionResult
        }

        const sessionId = sessionResult.sessionId
        const localId = c.req.param('messageId')

        // 1. DB 层：已 submit？已删？
        const dbRes = engine.cancelQueuedMessage(sessionId, localId)
        if (dbRes.submitted) return c.json({ status: 'submitted' })
        if (dbRes.cancelled) {
            // 2. DB 已删，但 CLI 内存里可能还缓冲着 → 通知 CLI 也删（竞态兜底）
            try {
                await engine.cancelCliQueuedMessage(sessionId, localId)
            } catch { /* CLI 不在线或超时：DB 已删即可 */ }
            return c.json({ status: 'cancelled' })
        }

        // 3. DB 里没这条（已被消费/不存在）→ 问 CLI
        try {
            const cliRes = await engine.cancelCliQueuedMessage(sessionId, localId)
            return c.json({ status: cliRes.status ?? 'submitted' })
        } catch {
            return c.json({ status: 'submitted' })
        }
    })

    // steer：把仍排队的消息提前提交给 Claude Code SDK input stream
    app.post('/sessions/:id/messages/:messageId/steer', async (c) => {
        const engine = requireSyncEngine(c, getSyncEngine)
        if (engine instanceof Response) {
            return engine
        }

        const sessionResult = requireSessionFromParam(c, engine)
        if (sessionResult instanceof Response) {
            return sessionResult
        }

        const sessionId = sessionResult.sessionId
        const localId = c.req.param('messageId')

        // DB 层前置校验（与 cancel 路由对称）：已 submit 或不存在 → 不再打扰 CLI
        const state = engine.getMessageSubmitState(sessionId, localId)
        if (!state.exists || state.submitted) return c.json({ status: 'submitted' })

        try {
            const res = await engine.steerCliQueuedMessage(sessionId, localId)
            return c.json({ status: res.status ?? 'submitted' })
        } catch {
            return c.json({ status: 'submitted' }, 503)
        }
    })

    return app
}
