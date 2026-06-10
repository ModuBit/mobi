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
import { validateHomeDirPath } from '@mobi/shared/pathSecurity'
import { EFFORT_LEVELS } from '@mobi/shared/modes'
import { MAX_UPLOAD_BYTES } from '@mobi/shared/upload'
import type { SyncEngine } from '../../sync/syncEngine'
import type { WebAppEnv } from '../middleware/auth'
import { requireMachine } from './guards'

const spawnBodySchema = z.object({
    directory: z.string().min(1),
    agent: z.enum(['claude']).optional(),  // Mobi 当前仅支持 Claude
    model: z.string().optional(),
    effort: z.enum(EFFORT_LEVELS).optional(),
    yolo: z.boolean().optional(),
    sessionType: z.enum(['simple', 'worktree']).optional(),
    worktreeName: z.string().optional()
})

const pathsExistsSchema = z.object({
    paths: z.array(z.string().min(1)).max(1000)
})

export function createMachinesRoutes(getSyncEngine: () => SyncEngine | null): Hono<WebAppEnv> {
    const app = new Hono<WebAppEnv>()

    app.get('/machines', (c) => {
        const engine = getSyncEngine()
        if (!engine) {
            return c.json({ error: 'Not connected' }, 503)
        }

        const namespace = c.get('namespace')
        const machines = engine.getOnlineMachinesByNamespace(namespace)
        return c.json({ machines })
    })

    app.post('/machines/:id/spawn', async (c) => {
        const engine = getSyncEngine()
        if (!engine) {
            return c.json({ error: 'Not connected' }, 503)
        }

        const machineId = c.req.param('id')
        const machine = requireMachine(c, engine, machineId)
        if (machine instanceof Response) {
            return machine
        }

        const body = await c.req.json().catch(() => null)
        const parsed = spawnBodySchema.safeParse(body)
        if (!parsed.success) {
            return c.json({ error: 'Invalid body' }, 400)
        }

        const homeDir = machine.metadata?.homeDir
        if (homeDir) {
            const validation = validateHomeDirPath(parsed.data.directory, homeDir)
            if (!validation.valid) {
                return c.json({ error: validation.error }, 403)
            }
        }

        const result = await engine.spawnSession(
            machineId,
            parsed.data.directory,
            parsed.data.agent,
            parsed.data.model,
            parsed.data.yolo,
            parsed.data.sessionType,
            parsed.data.worktreeName,
            undefined, // resumeSessionId
            parsed.data.effort
        )
        return c.json(result)
    })

    app.post('/machines/:id/paths/exists', async (c) => {
        const engine = getSyncEngine()
        if (!engine) {
            return c.json({ error: 'Not connected' }, 503)
        }

        const machineId = c.req.param('id')
        const machine = requireMachine(c, engine, machineId)
        if (machine instanceof Response) {
            return machine
        }

        const body = await c.req.json().catch(() => null)
        const parsed = pathsExistsSchema.safeParse(body)
        if (!parsed.success) {
            return c.json({ error: 'Invalid body' }, 400)
        }

        const uniquePaths = Array.from(new Set(parsed.data.paths.map((path) => path.trim()).filter(Boolean)))
        if (uniquePaths.length === 0) {
            return c.json({ exists: {} })
        }

        try {
            const exists = await engine.checkPathsExist(machineId, uniquePaths)
            return c.json({ exists })
        } catch (error) {
            return c.json({ error: error instanceof Error ? error.message : 'Failed to check paths' }, 500)
        }
    })

    app.get('/machines/:id/list-directory', async (c) => {
        const engine = getSyncEngine()
        if (!engine) {
            return c.json({ error: 'Not connected' }, 503)
        }

        const machineId = c.req.param('id')
        const machine = requireMachine(c, engine, machineId)
        if (machine instanceof Response) {
            return machine
        }

        // 获取 homeDir
        const homeDir = machine.metadata?.homeDir
        if (!homeDir) {
            return c.json({ success: false, error: 'Machine homeDir not available' }, 400)
        }

        const path = c.req.query('path') ?? ''
        if (!path) {
            return c.json({ success: false, error: 'Path parameter is required' }, 400)
        }

        // 安全校验：path 必须在 homeDir 内
        const validation = validateHomeDirPath(path, homeDir)
        if (!validation.valid) {
            return c.json({ success: false, error: validation.error }, 403)
        }

        try {
            const result = await engine.listMachineDirectory(machineId, path, homeDir)
            return c.json(result)
        } catch (error) {
            return c.json({ success: false, error: error instanceof Error ? error.message : 'Failed to list directory' }, 500)
        }
    })

    // 刷新 machine 上的会话元数据
    app.get('/machines/:id/metadata', async (c) => {
        const engine = getSyncEngine()
        if (!engine) {
            return c.json({ error: 'Not connected' }, 503)
        }

        const machineId = c.req.param('id')
        const machine = requireMachine(c, engine, machineId)
        if (machine instanceof Response) {
            return machine
        }

        const cwd = c.req.query('cwd')
        if (!cwd) {
            return c.json({ error: 'cwd parameter is required' }, 400)
        }

        // 安全校验：cwd 必须在 homeDir 内
        const homeDir = machine.metadata?.homeDir
        if (homeDir) {
            const validation = validateHomeDirPath(cwd, homeDir)
            if (!validation.valid) {
                return c.json({ error: validation.error }, 403)
            }
        }

        try {
            const result = await engine.machineRefreshMetadata(machineId, cwd)
            return c.json({ success: true, metadata: result.metadata ?? {} })
        } catch (error) {
            return c.json({ error: error instanceof Error ? error.message : 'Failed to refresh metadata' }, 500)
        }
    })

    // 文件上传到 machine 指定目录
    app.post('/machines/:id/upload', async (c) => {
        const engine = getSyncEngine()
        if (!engine) {
            return c.json({ error: 'Not connected' }, 503)
        }

        const machineId = c.req.param('id')
        const machine = requireMachine(c, engine, machineId)
        if (machine instanceof Response) {
            return machine
        }

        const body = await c.req.parseBody()
        const cwd = typeof body.cwd === 'string' ? body.cwd : ''
        if (!cwd) {
            return c.json({ error: 'cwd field is required' }, 400)
        }

        // 安全校验：cwd 必须在 homeDir 内
        const homeDir = machine.metadata?.homeDir
        if (homeDir) {
            const validation = validateHomeDirPath(cwd, homeDir)
            if (!validation.valid) {
                return c.json({ error: validation.error }, 403)
            }
        }

        const file = body.file
        if (!file || !(file instanceof File)) {
            return c.json({ error: 'file field is required' }, 400)
        }

        if (file.size > MAX_UPLOAD_BYTES) {
            return c.json({ error: 'File too large' }, 413)
        }

        const filename = file.name
        const mimeType = file.type || 'application/octet-stream'
        const arrayBuffer = await file.arrayBuffer()
        const base64Content = Buffer.from(arrayBuffer).toString('base64')

        try {
            const result = await engine.machineUploadFile(machineId, cwd, filename, base64Content, mimeType)
            return c.json(result)
        } catch (error) {
            return c.json({ error: error instanceof Error ? error.message : 'Failed to upload file' }, 500)
        }
    })

    // 删除 machine 上的已上传文件
    app.post('/machines/:id/upload/delete', async (c) => {
        const engine = getSyncEngine()
        if (!engine) {
            return c.json({ error: 'Not connected' }, 503)
        }

        const machineId = c.req.param('id')
        const machine = requireMachine(c, engine, machineId)
        if (machine instanceof Response) {
            return machine
        }

        const body = await c.req.json().catch(() => null) as { path?: string; cwd?: string } | null
        if (!body?.path || !body?.cwd) {
            return c.json({ error: 'path and cwd fields are required' }, 400)
        }

        // 安全校验：cwd 必须在 homeDir 内
        const homeDir = machine.metadata?.homeDir
        if (homeDir) {
            const validation = validateHomeDirPath(body.cwd, homeDir)
            if (!validation.valid) {
                return c.json({ error: validation.error }, 403)
            }
        }

        try {
            const result = await engine.machineDeleteUpload(machineId, body.cwd, body.path)
            return c.json(result)
        } catch (error) {
            return c.json({ error: error instanceof Error ? error.message : 'Failed to delete upload' }, 500)
        }
    })

    // 在 machine 上搜索文件
    app.get('/machines/:id/search-files', async (c) => {
        const engine = getSyncEngine()
        if (!engine) {
            return c.json({ error: 'Not connected' }, 503)
        }

        const machineId = c.req.param('id')
        const machine = requireMachine(c, engine, machineId)
        if (machine instanceof Response) {
            return machine
        }

        const cwd = c.req.query('cwd')
        const query = c.req.query('query')
        if (!cwd) {
            return c.json({ error: 'cwd parameter is required' }, 400)
        }
        if (!query) {
            return c.json({ error: 'query parameter is required' }, 400)
        }

        // 安全校验：cwd 必须在 homeDir 内
        const homeDir = machine.metadata?.homeDir
        if (homeDir) {
            const validation = validateHomeDirPath(cwd, homeDir)
            if (!validation.valid) {
                return c.json({ error: validation.error }, 403)
            }
        }

        try {
            const result = await engine.machineSearchFiles(machineId, cwd, query)
            return c.json(result)
        } catch (error) {
            return c.json({ success: false, error: error instanceof Error ? error.message : 'Failed to search files' }, 500)
        }
    })

    // 列出 machine 会话目录
    app.get('/machines/:id/list-session-directory', async (c) => {
        const engine = getSyncEngine()
        if (!engine) {
            return c.json({ error: 'Not connected' }, 503)
        }

        const machineId = c.req.param('id')
        const machine = requireMachine(c, engine, machineId)
        if (machine instanceof Response) {
            return machine
        }

        const cwd = c.req.query('cwd')
        const path = c.req.query('path') ?? ''
        if (!cwd) {
            return c.json({ error: 'cwd parameter is required' }, 400)
        }

        // 安全校验：cwd 必须在 homeDir 内
        const homeDir = machine.metadata?.homeDir
        if (homeDir) {
            const validation = validateHomeDirPath(cwd, homeDir)
            if (!validation.valid) {
                return c.json({ error: validation.error }, 403)
            }
        }

        try {
            const result = await engine.machineListSessionDirectory(machineId, cwd, path)
            return c.json(result)
        } catch (error) {
            return c.json({ success: false, error: error instanceof Error ? error.message : 'Failed to list session directory' }, 500)
        }
    })

    return app
}
