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
import { z } from 'zod'
import { PROTOCOL_VERSION } from '@mobi/shared'
import { configuration, getConfiguration } from '../../configuration'
import { constantTimeEquals } from '../../utils/crypto'
import { parseAccessToken } from '../../utils/accessToken'
import { rotateWebApiToken } from '../../config/webApiToken'
import { checkWorkspaceAssignable, type Session, type SyncEngine } from '../../sync/syncEngine'

const bearerSchema = z.string().regex(/^Bearer\s+(.+)$/i)

const createOrLoadSessionSchema = z.object({
    tag: z.string().min(1),
    metadata: z.unknown(),
    agentState: z.unknown().nullable().optional(),
    mode: z.enum(['local', 'remote']).optional(),
    runtimeState: z.unknown().optional(),
    /** 归属工作区（Web spawn 透传；缺省 = 游离） */
    workspaceId: z.string().optional()
})

const getMessagesQuerySchema = z.object({
    afterSeq: z.coerce.number().int().min(0),
    limit: z.coerce.number().int().min(1).max(200).optional()
})

type CliEnv = {
    Variables: {
        namespace: string
    }
}

function resolveSessionForNamespace(
    engine: SyncEngine,
    sessionId: string,
    namespace: string
): { ok: true; session: Session; sessionId: string } | { ok: false; status: 403 | 404; error: string } {
    const access = engine.resolveSessionAccess(sessionId, namespace)
    if (access.ok) {
        return { ok: true, session: access.session, sessionId: access.sessionId }
    }
    return {
        ok: false,
        status: access.reason === 'access-denied' ? 403 : 404,
        error: access.reason === 'access-denied' ? 'Session access denied' : 'Session not found'
    }
}

export function createCliRoutes(getSyncEngine: () => SyncEngine | null): Hono<CliEnv> {
    const app = new Hono<CliEnv>()

    app.use('*', async (c, next) => {
        c.header('X-Mobi-Protocol-Version', String(PROTOCOL_VERSION))

        const raw = c.req.header('authorization')
        if (!raw) {
            return c.json({ error: 'Missing Authorization header' }, 401)
        }

        const parsed = bearerSchema.safeParse(raw)
        if (!parsed.success) {
            return c.json({ error: 'Invalid Authorization header' }, 401)
        }

        const token = parsed.data.replace(/^Bearer\s+/i, '')
        const parsedToken = parseAccessToken(token)
        if (!parsedToken || !constantTimeEquals(parsedToken.baseToken, configuration.cliApiToken)) {
            return c.json({ error: 'Invalid token' }, 401)
        }

        c.set('namespace', parsedToken.namespace)
        return await next()
    })

    // webApiToken 远程读取/轮换：webApiToken 归 daemon 所有（settings.daemon.json），
    // cli 与 daemon 可不同机器部署，cli 经此 API 代行原「直接写文件」的 rotate 语义
    app.get('/web-token', (c) => {
        return c.json({
            webToken: configuration.webApiToken,
            // daemon 侧 WEB_API_TOKEN env 优先级高于文件：cli 据此提示轮换在 daemon 重启后会被覆盖
            envOverride: configuration.webApiTokenSource === 'env'
        })
    })

    app.post('/web-token', async (c) => {
        // envOverride 先于轮换取值：_setWebApiToken 会把 source 改写为 'file'
        const envOverride = configuration.webApiTokenSource === 'env'
        const rotated = await rotateWebApiToken(getConfiguration().dataDir)
        // 立即热更新 configuration 单例（不等 settingsWatcher 的文件事件，也覆盖 watcher 失效的场景）
        getConfiguration()._setWebApiToken(rotated.token, 'file', true)
        return c.json({
            webToken: rotated.token,
            envOverride
        })
    })

    app.post('/sessions', async (c) => {
        const engine = getSyncEngine()
        if (!engine) {
            return c.json({ error: 'Not ready' }, 503)
        }
        const json = await c.req.json().catch(() => null)
        const parsed = createOrLoadSessionSchema.safeParse(json)
        if (!parsed.success) {
            return c.json({ error: 'Invalid body' }, 400)
        }

        const namespace = c.get('namespace')
        // 归属校验前置：workspaceId 必须指向同 namespace 的现存工作区（404 约定与 PATCH /sessions/:id 一致），
        // 避免 store 层抛错被宽 catch 吞成 400、掩盖真实故障（DB 错误等应照常 500）。
        // 单机语义（ticket-25）下工作区与会话恒同机，机器一致性判据已随多机分支收敛删除
        if (parsed.data.workspaceId) {
            const assignable = checkWorkspaceAssignable(engine, parsed.data.workspaceId, namespace)
            if (assignable === 'not_found') {
                return c.json({ error: 'Workspace not found' }, 404)
            }
        }
        const session = engine.getOrCreateSession(
            parsed.data.tag, parsed.data.metadata, parsed.data.agentState ?? null,
            namespace, parsed.data.mode, parsed.data.runtimeState, parsed.data.workspaceId
        )
        // 响应带 workspace：CLI 创建会话时校验归属并冻结 folders（不存在 → null = 游离）
        const workspace = session.workspaceId
            ? engine.getWorkspace(session.workspaceId) ?? null
            : null
        return c.json({ session, workspace })
    })

    // 注意：此路由必须注册在 /sessions/:id 之前，否则会被参数路由拦截
    app.get('/sessions/by-claude-session/:nativeSessionId', (c) => {
        const engine = getSyncEngine()
        if (!engine) {
            return c.json({ error: 'Not ready' }, 503)
        }
        const nativeSessionId = c.req.param('nativeSessionId')
        const namespace = c.get('namespace')
        const session = engine.getSessionByClaudeSessionId(nativeSessionId, namespace)
        if (!session) {
            return c.json({ error: 'Session not found' }, 404)
        }
        return c.json({ session })
    })

    app.get('/sessions/:id', (c) => {
        const engine = getSyncEngine()
        if (!engine) {
            return c.json({ error: 'Not ready' }, 503)
        }
        const sessionId = c.req.param('id')
        const namespace = c.get('namespace')
        const resolved = resolveSessionForNamespace(engine, sessionId, namespace)
        if (!resolved.ok) {
            return c.json({ error: resolved.error }, resolved.status)
        }
        return c.json({ session: resolved.session })
    })

    app.get('/sessions/:id/messages', (c) => {
        const engine = getSyncEngine()
        if (!engine) {
            return c.json({ error: 'Not ready' }, 503)
        }
        const sessionId = c.req.param('id')
        const namespace = c.get('namespace')
        const resolved = resolveSessionForNamespace(engine, sessionId, namespace)
        if (!resolved.ok) {
            return c.json({ error: resolved.error }, resolved.status)
        }

        const parsed = getMessagesQuerySchema.safeParse(c.req.query())
        if (!parsed.success) {
            return c.json({ error: 'Invalid query' }, 400)
        }

        const limit = parsed.data.limit ?? 200
        const messages = engine.getMessagesAfter(resolved.sessionId, { afterSeq: parsed.data.afterSeq, limit })
        return c.json({ messages })
    })

    return app
}
