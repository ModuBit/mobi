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

import type { Context } from 'hono'
import type { Machine, Session, SyncEngine } from '../../sync/syncEngine'
import type { WebAppEnv } from '../middleware/auth'

/**
 * 会话行入队守卫（消息发送路由预检）：常规 inactive 会话不可入队（409）；
 * 待激活 fork 行放行——激活窗口期的首条消息排队，CLI 激活后消费
 * （fork-session spec §4.3/§5.3——web 发送侧同步触发 resume spawn，600ms+ 的
 * spawn 窗口内 409 会产生幽灵乐观气泡，E2E 实证）。与删除守卫
 * （sync/sessionDeleteGuard.isSessionRowDeletable）同属 fork 生命周期门控。
 */
export function isSessionEnqueueable(session: Pick<Session, 'active' | 'metadata'>): boolean {
    return session.active || Boolean(session.metadata?.forkFrom)
}

export function requireSyncEngine(
    c: Context<WebAppEnv>,
    getSyncEngine: () => SyncEngine | null
): SyncEngine | Response {
    const engine = getSyncEngine()
    if (!engine) {
        return c.json({ error: 'Not connected' }, 503)
    }
    return engine
}

export function requireSession(
    c: Context<WebAppEnv>,
    engine: SyncEngine,
    sessionId: string,
    options?: { requireActive?: boolean }
): { sessionId: string; session: Session } | Response {
    const namespace = c.get('namespace')
    const access = engine.resolveSessionAccess(sessionId, namespace)
    if (!access.ok) {
        const status = access.reason === 'access-denied' ? 403 : 404
        const error = access.reason === 'access-denied' ? 'Session access denied' : 'Session not found'
        return c.json({ error }, status)
    }
    if (options?.requireActive && !access.session.active) {
        return c.json({ error: 'Session is inactive' }, 409)
    }
    return { sessionId: access.sessionId, session: access.session }
}

export function requireSessionFromParam(
    c: Context<WebAppEnv>,
    engine: SyncEngine,
    options?: { paramName?: string; requireActive?: boolean }
): { sessionId: string; session: Session } | Response {
    const paramName = options?.paramName ?? 'id'
    const sessionId = c.req.param(paramName)
    if (!sessionId) {
        return c.json({ error: 'Missing session ID' }, 400)
    }
    const result = requireSession(c, engine, sessionId, { requireActive: options?.requireActive })
    if (result instanceof Response) {
        return result
    }
    return result
}

export function requireMachine(
    c: Context<WebAppEnv>,
    engine: SyncEngine,
    machineId: string
): Machine | Response {
    const namespace = c.get('namespace')
    const machine = engine.getMachine(machineId)
    if (!machine) {
        return c.json({ error: 'Machine not found' }, 404)
    }
    if (machine.namespace !== namespace) {
        return c.json({ error: 'Machine access denied' }, 403)
    }
    return machine
}
