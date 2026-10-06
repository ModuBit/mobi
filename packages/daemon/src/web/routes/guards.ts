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
import { validateHomeDirPath, isWithinBlacklistedDir } from '@mobi/shared/pathSecurity'
import { buildHostMetadata } from '@mobi/node-core/hostMetadata'
import type { Session, SyncEngine } from '../../sync/syncEngine'
import type { WebAppEnv } from '../middleware/auth'

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

/**
 * 宿主 homeDir 单源（ticket 202）：daemon 即宿主，homeDir 直源宿主静态身份，
 * 不再经 machines 行 metadata 中转（buildHostMetadata 为 602 改名目标）。
 */
export function requireHostHomeDir(): string {
    return buildHostMetadata().homeDir
}

/**
 * 校验 cwd 必须在 homeDir 范围内且不在黑名单目录（密钥/凭证/工具配置，
 * 防 ripgrep/list 读取敏感文件）。homeDir 缺失时拒绝请求。
 */
export function validateCwd(cwd: string, homeDir: string | undefined): Response | null {
    if (!homeDir) {
        return new Response(JSON.stringify({ error: 'Home directory not available' }), { status: 400 })
    }
    const validation = validateHomeDirPath(cwd, homeDir)
    if (!validation.valid) {
        return new Response(JSON.stringify({ error: validation.error }), { status: 403 })
    }
    if (isWithinBlacklistedDir(cwd, homeDir)) {
        return new Response(JSON.stringify({ error: 'Access denied: path is in a restricted directory' }), { status: 403 })
    }
    return null
}
