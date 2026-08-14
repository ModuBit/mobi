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

import { ProjectFolderSchema, validateProjectFolders, PROJECT_FOLDERS_ERROR_MESSAGES } from '@mobi/shared'
import { validateHomeDirPath } from '@mobi/shared/pathSecurity'
import { Hono } from 'hono'
import { z } from 'zod'
import { checkProjectAssignable, type SyncEngine } from '../../sync/syncEngine'
import type { WebAppEnv } from '../middleware/auth'
import { toSummaryWithLiveState } from '../utils/sessionSummary'
import { requireSyncEngine } from './guards'

const listProjectsQuerySchema = z.object({
    machineId: z.string().min(1).optional()
})

const createProjectSchema = z.object({
    name: z.string().min(1),
    machineId: z.string().min(1),
    folders: z.array(ProjectFolderSchema)
})

const updateProjectSchema = z.object({
    name: z.string().min(1).optional(),
    folders: z.array(ProjectFolderSchema).optional()
})

// 会话分页 query（limit + updated_at 游标）
const projectSessionsQuerySchema = z.object({
    limit: z.coerce.number().min(1).max(100).optional().default(20),
    cursor: z.coerce.number().optional()
})

export function createProjectsRoutes(getSyncEngine: () => SyncEngine | null): Hono<WebAppEnv> {
    const app = new Hono<WebAppEnv>()

    /**
     * folders 路径须位于目标机器 homeDir 内——与 spawn 路由同一守卫语义（机器未知/无
     * homeDir 时放行），但前置到建项目/改 folders 时刻拦截，避免「建得起来、spawn 才
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

    // GET /api/projects - 项目列表（支持 ?machineId= 过滤）
    app.get('/projects', (c) => {
        const engine = requireSyncEngine(c, getSyncEngine)
        if (engine instanceof Response) return engine

        const parsed = listProjectsQuerySchema.safeParse(c.req.query())
        if (!parsed.success) {
            return c.json({ error: 'Invalid query parameters' }, 400)
        }

        const namespace = c.get('namespace')
        let projects = engine.getProjects(namespace)
        if (parsed.data.machineId) {
            projects = projects.filter(p => p.machineId === parsed.data.machineId)
        }
        return c.json({ projects })
    })

    // POST /api/projects - 创建项目（folders 合法性由 validateProjectFolders 把关）
    app.post('/projects', async (c) => {
        const engine = requireSyncEngine(c, getSyncEngine)
        if (engine instanceof Response) return engine

        const body = await c.req.json().catch(() => null)
        const parsed = createProjectSchema.safeParse(body)
        if (!parsed.success) {
            return c.json({ error: 'Invalid body' }, 400)
        }

        const foldersError = validateProjectFolders(parsed.data.folders)
        if (foldersError) {
            return c.json({ error: PROJECT_FOLDERS_ERROR_MESSAGES[foldersError] }, 400)
        }

        // folders 路径范围前置校验（homeDir 外 → 400），避免建得起来、spawn 时才被拒
        const homeDirError = validateFoldersWithinHomeDir(engine, parsed.data.machineId, parsed.data.folders)
        if (homeDirError) {
            return c.json({ error: homeDirError }, 400)
        }

        const namespace = c.get('namespace')
        const project = engine.createProject(namespace, parsed.data)
        return c.json({ project })
    })

    // 注意：此路由必须注册在 /projects/:id 与 /projects/:id/sessions 之前，
    // 否则两段路径 sessions/unbound 会被参数路由按 :id=sessions 拦截（同类坑见 cli.ts）
    app.get('/projects/sessions/unbound', (c) => {
        const engine = requireSyncEngine(c, getSyncEngine)
        if (engine instanceof Response) return engine

        const parsed = projectSessionsQuerySchema.safeParse(c.req.query())
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

    // GET /api/projects/:id
    app.get('/projects/:id', (c) => {
        const engine = requireSyncEngine(c, getSyncEngine)
        if (engine instanceof Response) return engine

        const namespace = c.get('namespace')
        // 存在性 + namespace 归属统一走 engine 判定
        if (checkProjectAssignable(engine, c.req.param('id'), namespace) !== 'ok') {
            return c.json({ error: 'Project not found' }, 404)
        }
        return c.json({ project: engine.getProject(c.req.param('id')) })
    })

    // PATCH /api/projects/:id - 改名 / 改 folders（machineId 不可改）
    app.patch('/projects/:id', async (c) => {
        const engine = requireSyncEngine(c, getSyncEngine)
        if (engine instanceof Response) return engine

        const id = c.req.param('id')
        const namespace = c.get('namespace')

        // 存在性 + namespace 归属统一走 engine 判定
        if (checkProjectAssignable(engine, id, namespace) !== 'ok') {
            return c.json({ error: 'Project not found' }, 404)
        }

        const body = await c.req.json().catch(() => null)
        const parsed = updateProjectSchema.safeParse(body)
        if (!parsed.success) {
            return c.json({ error: 'Invalid body' }, 400)
        }

        if (parsed.data.folders) {
            const foldersError = validateProjectFolders(parsed.data.folders)
            if (foldersError) {
                return c.json({ error: PROJECT_FOLDERS_ERROR_MESSAGES[foldersError] }, 400)
            }
            // 换 folders 时同样做 homeDir 范围校验（machineId 不可改，按既有归属校验）
            const machineId = engine.getProject(id)?.machineId
            const homeDirError = validateFoldersWithinHomeDir(engine, machineId, parsed.data.folders)
            if (homeDirError) {
                return c.json({ error: homeDirError }, 400)
            }
        }

        const project = engine.updateProject(id, namespace, parsed.data)
        if (!project) {
            return c.json({ error: 'Project not found' }, 404)
        }
        return c.json({ project })
    })

    // DELETE /api/projects/:id - 名下会话解绑进「最近」（projectCache 负责 SSE 联动）
    app.delete('/projects/:id', (c) => {
        const engine = requireSyncEngine(c, getSyncEngine)
        if (engine instanceof Response) return engine

        const id = c.req.param('id')
        const namespace = c.get('namespace')

        // 存在性 + namespace 归属统一走 engine 判定
        if (checkProjectAssignable(engine, id, namespace) !== 'ok') {
            return c.json({ error: 'Project not found' }, 404)
        }

        const ok = engine.deleteProject(id, namespace)
        if (!ok) {
            return c.json({ error: 'Project not found' }, 404)
        }
        return c.json({ success: true })
    })

    // GET /api/projects/:id/sessions - 项目内会话分页
    app.get('/projects/:id/sessions', (c) => {
        const engine = requireSyncEngine(c, getSyncEngine)
        if (engine instanceof Response) return engine

        const parsed = projectSessionsQuerySchema.safeParse(c.req.query())
        if (!parsed.success) {
            return c.json({ error: 'Invalid query parameters' }, 400)
        }

        const id = c.req.param('id')
        const namespace = c.get('namespace')

        // 存在性 + namespace 归属统一走 engine 判定
        if (checkProjectAssignable(engine, id, namespace) !== 'ok') {
            return c.json({ error: 'Project not found' }, 404)
        }

        const result = engine.getSessionsByProject(namespace, id, parsed.data.cursor ?? null, parsed.data.limit)

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
