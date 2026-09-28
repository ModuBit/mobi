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

import { WorkspaceFolderSchema, validateWorkspaceFolders, WORKSPACE_FOLDERS_ERROR_MESSAGES } from '@mobi/shared'
import { validateHomeDirPath } from '@mobi/shared/pathSecurity'
import { Hono } from 'hono'
import { z } from 'zod'
import { checkWorkspaceAssignable, type SyncEngine } from '../../sync/syncEngine'
import type { WebAppEnv } from '../middleware/auth'
import { toSummaryWithLiveState } from '../utils/sessionSummary'
import { requireSyncEngine } from './guards'

const listWorkspacesQuerySchema = z.object({
    machineId: z.string().min(1).optional()
})

const createWorkspaceSchema = z.object({
    name: z.string().min(1),
    machineId: z.string().min(1),
    folders: z.array(WorkspaceFolderSchema)
})

const updateWorkspaceSchema = z.object({
    name: z.string().min(1).optional(),
    folders: z.array(WorkspaceFolderSchema).optional()
})

// 会话分页 query（limit + updated_at 游标）
const workspaceSessionsQuerySchema = z.object({
    limit: z.coerce.number().min(1).max(100).optional().default(20),
    cursor: z.coerce.number().optional()
})

export function createWorkspacesRoutes(getSyncEngine: () => SyncEngine | null): Hono<WebAppEnv> {
    const app = new Hono<WebAppEnv>()

    /**
     * folders 路径须位于目标机器 homeDir 内——与 spawn 路由同一守卫语义（机器未知/无
     * homeDir 时放行），但前置到建工作区/改 folders 时刻拦截，避免「建得起来、spawn 才
     * 403」的可用性陷阱。返回错误文案或 null
     */
    const validateFoldersWithinHomeDir = (
        engine: SyncEngine, machineId: string | undefined, folders: Array<{ path: string }>
    ): string | null => {
        // 机器未知（查不到归属机器）时放行，与守卫语义一致
        if (!machineId) return null
        const homeDir = engine.getMachine(machineId)?.metadata?.homeDir
        if (!homeDir) return null
        for (const folder of folders) {
            const validation = validateHomeDirPath(folder.path, homeDir)
            if (!validation.valid) {
                return `Folder "${folder.path}": ${validation.error} (must be within the machine home directory)`
            }
        }
        return null
    }

    // GET /api/workspaces - 工作区列表（支持 ?machineId= 过滤）
    app.get('/workspaces', (c) => {
        const engine = requireSyncEngine(c, getSyncEngine)
        if (engine instanceof Response) return engine

        const parsed = listWorkspacesQuerySchema.safeParse(c.req.query())
        if (!parsed.success) {
            return c.json({ error: 'Invalid query parameters' }, 400)
        }

        const namespace = c.get('namespace')
        let workspaces = engine.getWorkspaces(namespace)
        if (parsed.data.machineId) {
            workspaces = workspaces.filter(p => p.machineId === parsed.data.machineId)
        }
        return c.json({ workspaces })
    })

    // POST /api/workspaces - 创建工作区（folders 合法性由 validateWorkspaceFolders 把关）
    app.post('/workspaces', async (c) => {
        const engine = requireSyncEngine(c, getSyncEngine)
        if (engine instanceof Response) return engine

        const body = await c.req.json().catch(() => null)
        const parsed = createWorkspaceSchema.safeParse(body)
        if (!parsed.success) {
            return c.json({ error: 'Invalid body' }, 400)
        }

        const foldersError = validateWorkspaceFolders(parsed.data.folders)
        if (foldersError) {
            return c.json({ error: WORKSPACE_FOLDERS_ERROR_MESSAGES[foldersError] }, 400)
        }

        // folders 路径范围前置校验（homeDir 外 → 400），避免建得起来、spawn 时才被拒
        const homeDirError = validateFoldersWithinHomeDir(engine, parsed.data.machineId, parsed.data.folders)
        if (homeDirError) {
            return c.json({ error: homeDirError }, 400)
        }

        const namespace = c.get('namespace')
        const workspace = engine.createWorkspace(namespace, parsed.data)
        return c.json({ workspace })
    })

    // 注意：此路由必须注册在 /workspaces/:id 与 /workspaces/:id/sessions 之前，
    // 否则两段路径 sessions/unbound 会被参数路由按 :id=sessions 拦截（同类坑见 cli.ts）
    app.get('/workspaces/sessions/unbound', (c) => {
        const engine = requireSyncEngine(c, getSyncEngine)
        if (engine instanceof Response) return engine

        const parsed = workspaceSessionsQuerySchema.safeParse(c.req.query())
        if (!parsed.success) {
            return c.json({ error: 'Invalid query parameters' }, 400)
        }

        const namespace = c.get('namespace')
        const result = engine.getUnboundSessions(namespace, parsed.data.cursor ?? null, parsed.data.limit)

        const sessions = result.sessions.map(s => toSummaryWithLiveState(engine, s))

        return c.json({
            sessions,
            nextCursor: result.nextCursor,
            hasMore: result.hasMore,
            total: result.total
        })
    })

    // GET /api/workspaces/:id
    app.get('/workspaces/:id', (c) => {
        const engine = requireSyncEngine(c, getSyncEngine)
        if (engine instanceof Response) return engine

        const namespace = c.get('namespace')
        // 存在性 + namespace 归属统一走 engine 判定
        if (checkWorkspaceAssignable(engine, c.req.param('id'), namespace) !== 'ok') {
            return c.json({ error: 'Workspace not found' }, 404)
        }
        return c.json({ workspace: engine.getWorkspace(c.req.param('id')) })
    })

    // PATCH /api/workspaces/:id - 改名 / 改 folders（machineId 不可改）
    app.patch('/workspaces/:id', async (c) => {
        const engine = requireSyncEngine(c, getSyncEngine)
        if (engine instanceof Response) return engine

        const id = c.req.param('id')
        const namespace = c.get('namespace')

        // 存在性 + namespace 归属统一走 engine 判定
        if (checkWorkspaceAssignable(engine, id, namespace) !== 'ok') {
            return c.json({ error: 'Workspace not found' }, 404)
        }

        const body = await c.req.json().catch(() => null)
        const parsed = updateWorkspaceSchema.safeParse(body)
        if (!parsed.success) {
            return c.json({ error: 'Invalid body' }, 400)
        }

        if (parsed.data.folders) {
            const foldersError = validateWorkspaceFolders(parsed.data.folders)
            if (foldersError) {
                return c.json({ error: WORKSPACE_FOLDERS_ERROR_MESSAGES[foldersError] }, 400)
            }
            // 换 folders 时同样做 homeDir 范围校验（machineId 不可改，按既有归属校验）
            const machineId = engine.getWorkspace(id)?.machineId
            const homeDirError = validateFoldersWithinHomeDir(engine, machineId, parsed.data.folders)
            if (homeDirError) {
                return c.json({ error: homeDirError }, 400)
            }
        }

        const workspace = engine.updateWorkspace(id, namespace, parsed.data)
        if (!workspace) {
            return c.json({ error: 'Workspace not found' }, 404)
        }
        return c.json({ workspace })
    })

    // DELETE /api/workspaces/:id - 名下会话解绑进「最近」（workspaceCache 负责 SSE 联动）
    app.delete('/workspaces/:id', (c) => {
        const engine = requireSyncEngine(c, getSyncEngine)
        if (engine instanceof Response) return engine

        const id = c.req.param('id')
        const namespace = c.get('namespace')

        // 存在性 + namespace 归属统一走 engine 判定
        if (checkWorkspaceAssignable(engine, id, namespace) !== 'ok') {
            return c.json({ error: 'Workspace not found' }, 404)
        }

        const ok = engine.deleteWorkspace(id, namespace)
        if (!ok) {
            return c.json({ error: 'Workspace not found' }, 404)
        }
        return c.json({ success: true })
    })

    // GET /api/workspaces/:id/sessions - 工作区内会话分页
    app.get('/workspaces/:id/sessions', (c) => {
        const engine = requireSyncEngine(c, getSyncEngine)
        if (engine instanceof Response) return engine

        const parsed = workspaceSessionsQuerySchema.safeParse(c.req.query())
        if (!parsed.success) {
            return c.json({ error: 'Invalid query parameters' }, 400)
        }

        const id = c.req.param('id')
        const namespace = c.get('namespace')

        // 存在性 + namespace 归属统一走 engine 判定
        if (checkWorkspaceAssignable(engine, id, namespace) !== 'ok') {
            return c.json({ error: 'Workspace not found' }, 404)
        }

        const result = engine.getSessionsByWorkspace(namespace, id, parsed.data.cursor ?? null, parsed.data.limit)

        const sessions = result.sessions.map(s => toSummaryWithLiveState(engine, s))

        return c.json({
            sessions,
            nextCursor: result.nextCursor,
            hasMore: result.hasMore,
            total: result.total
        })
    })

    return app
}
