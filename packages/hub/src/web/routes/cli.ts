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
import { checkProjectAssignable, type Machine, type Session, type SyncEngine } from '../../sync/syncEngine'

const bearerSchema = z.string().regex(/^Bearer\s+(.+)$/i)

const createOrLoadSessionSchema = z.object({
    tag: z.string().min(1),
    metadata: z.unknown(),
    agentState: z.unknown().nullable().optional(),
    mode: z.enum(['local', 'remote']).optional(),
    runtimeState: z.unknown().optional(),
    /** 归属项目（Web spawn 透传；缺省 = 游离） */
    projectId: z.string().optional()
})

const createOrLoadMachineSchema = z.object({
    id: z.string().min(1),
    metadata: z.unknown(),
    runnerState: z.unknown().nullable().optional()
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

function resolveMachineForNamespace(
    engine: SyncEngine,
    machineId: string,
    namespace: string
): { ok: true; machine: Machine } | { ok: false; status: 403 | 404; error: string } {
    const machine = engine.getMachineByNamespace(machineId, namespace)
    if (machine) {
        return { ok: true, machine }
    }
    if (engine.getMachine(machineId)) {
        return { ok: false, status: 403, error: 'Machine access denied' }
    }
    return { ok: false, status: 404, error: 'Machine not found' }
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

    // webApiToken 远程读取/轮换：webApiToken 归 hub 所有（settings.hub.json），
    // cli 与 hub 可不同机器部署，cli 经此 API 代行原「直接写文件」的 rotate 语义
    app.get('/web-token', (c) => {
        return c.json({
            webToken: configuration.webApiToken,
            // hub 侧 WEB_API_TOKEN env 优先级高于文件：cli 据此提示轮换在 hub 重启后会被覆盖
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
        // 归属校验前置：projectId 必须指向同 namespace 的现存项目（404 约定与 PATCH /sessions/:id 一致），
        // 避免 store 层抛错被宽 catch 吞成 400、掩盖真实故障（DB 错误等应照常 500）
        if (parsed.data.projectId) {
            // 机器一致性前置：项目 folders 是机器本地路径，归属其它机器时必须当场拒绝，
            // 否则 CLI 侧后置校验失败退出后会留下绑定该项目的幽灵空会话（D13/spec §4.1）。
            // metadata 是 z.unknown()，machineId 只能在此处内联提取（缺失 = 老数据/异常，checkProjectAssignable 放行）
            const requestMachineId = (parsed.data.metadata as { machineId?: unknown } | null)?.machineId
            const assignable = checkProjectAssignable(engine, parsed.data.projectId, namespace, requestMachineId)
            if (assignable === 'not_found') {
                return c.json({ error: 'Project not found' }, 404)
            }
            if (assignable === 'machine_mismatch') {
                return c.json({ error: 'Project belongs to a different machine' }, 403)
            }
        }
        const session = engine.getOrCreateSession(
            parsed.data.tag, parsed.data.metadata, parsed.data.agentState ?? null,
            namespace, parsed.data.mode, parsed.data.runtimeState, parsed.data.projectId
        )
        // 响应带 project：CLI 创建会话时校验归属并冻结 folders（不存在 → null = 游离）
        const project = session.projectId
            ? engine.getProject(session.projectId) ?? null
            : null
        return c.json({ session, project })
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

    app.post('/machines', async (c) => {
        const engine = getSyncEngine()
        if (!engine) {
            return c.json({ error: 'Not ready' }, 503)
        }
        const json = await c.req.json().catch(() => null)
        const parsed = createOrLoadMachineSchema.safeParse(json)
        if (!parsed.success) {
            return c.json({ error: 'Invalid body' }, 400)
        }

        const namespace = c.get('namespace')
        const existing = engine.getMachine(parsed.data.id)
        if (existing && existing.namespace !== namespace) {
            return c.json({ error: 'Machine access denied' }, 403)
        }
        const machine = engine.getOrCreateMachine(parsed.data.id, parsed.data.metadata, parsed.data.runnerState ?? null, namespace)
        return c.json({ machine })
    })

    app.get('/machines/:id', (c) => {
        const engine = getSyncEngine()
        if (!engine) {
            return c.json({ error: 'Not ready' }, 503)
        }
        const machineId = c.req.param('id')
        const namespace = c.get('namespace')
        const resolved = resolveMachineForNamespace(engine, machineId, namespace)
        if (!resolved.ok) {
            return c.json({ error: resolved.error }, resolved.status)
        }
        return c.json({ machine: resolved.machine })
    })

    return app
}
