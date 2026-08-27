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
import { UserMessageContentSchema, normalizeUserContent } from '@mobi/shared'
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

/** 新版发送格式：content 三形态（string / 单 block / block 数组） */
const newFormatBodySchema = z.object({
    content: UserMessageContentSchema,
    localId: z.string().min(1).optional(),
})

/** 旧版 web/PWA 平铺发送格式（窗口期兼容） */
const legacyFlatBodySchema = z.object({
    text: z.string(),
    localId: z.string().min(1).optional(),
    attachments: z.array(AttachmentMetadataSchema).optional(),
})

const sendMessageBodySchema = z.union([newFormatBodySchema, legacyFlatBodySchema])

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
        // 默认页大小 100：tool-heavy 会话 bubble:消息比低，50 条/页首屏内容偏少
        const limit = parsed.success ? (parsed.data.limit ?? 100) : 100
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

        // 双格式收敛到同一归一函数：新格式直传，旧平铺组装为 {type:'text',text,attachments} 对象。
        // 归一在此预检——空文本/空附件是客户端错误须回 400（service 层 throw 仅作非 HTTP 入口防线，
        // 若落到那里会被 Hono 兜底成 500）
        const rawContent = 'content' in parsed.data
            ? parsed.data.content
            : { type: 'text', text: parsed.data.text, attachments: parsed.data.attachments }
        if (normalizeUserContent(rawContent) === null) {
            return c.json({ error: 'Message requires text or attachments' }, 400)
        }

        await engine.sendMessage(sessionId, { content: rawContent, localId: parsed.data.localId, sentFrom: 'webapp' })
        return c.json({ ok: true })
    })

    // 取消排队消息。CLI 是「是否仍可安全取消」的权威（in-flight 防幽灵消息）：
    // CLI 已 collectBatch 的消息（status='submitted'）绝不可删 DB，否则 agent 会回复一条
    // 用户以为已取消的消息。故 DB 仍 queued 时先问 CLI，再决定是否物理删除。
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

        const state = engine.getMessageSubmitState(sessionId, localId)
        if (!state.exists) {
            // DB 无此消息：兼容性问一次 CLI（理论上 web 发送必先落库）。
            // 只放行 'cancelled'；'not-in-queue'/'submitted' 一律归 submitted，
            // 对齐 Web 契约 {status:'cancelled'|'submitted'}，不泄漏内部状态。
            try {
                const cliRes = await engine.cancelCliQueuedMessage(sessionId, localId)
                return c.json({ status: cliRes.status === 'cancelled' ? 'cancelled' : 'submitted' })
            } catch {
                return c.json({ status: 'submitted' })
            }
        }
        if (state.submitted) return c.json({ status: 'submitted' })

        // DB 仍 queued：问 CLI 是否已 in-flight（已 collect，不可取消）
        let cliStatus: 'cancelled' | 'submitted' | 'not-in-queue'
        try {
            const cliRes = await engine.cancelCliQueuedMessage(sessionId, localId)
            cliStatus = (cliRes.status ?? 'submitted') as 'cancelled' | 'submitted' | 'not-in-queue'
        } catch {
            cliStatus = 'submitted' // CLI 不在线：保守不删，避免幽灵
        }
        if (cliStatus === 'submitted') return c.json({ status: 'submitted' })

        // 'cancelled'（CLI 队列已移除）或 'not-in-queue'（尚未送达 CLI）→ DB 物理删除
        const dbRes = engine.cancelQueuedMessage(sessionId, localId)
        return c.json({ status: dbRes.cancelled ? 'cancelled' : 'submitted' })
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
