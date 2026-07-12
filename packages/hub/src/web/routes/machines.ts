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
import { PermissionModeSchema, EFFORT_LEVELS } from '@mobi/shared'
import { validateHomeDirPath, isWithinBlacklistedDir } from '@mobi/shared/pathSecurity'
import { MAX_UPLOAD_BYTES } from '@mobi/shared/upload'
import { streamUpload } from '../utils/uploadStream'
import { safeDecodeHeader } from '../utils/headers'
import type { SyncEngine } from '../../sync/syncEngine'
import type { WebAppEnv } from '../middleware/auth'
import { requireMachine } from './guards'

const spawnBodySchema = z.object({
    directory: z.string().min(1),
    agent: z.enum(['claude']).optional(),  // Mobi 当前仅支持 Claude
    model: z.string().optional(),
    effort: z.enum(EFFORT_LEVELS).optional(),
    permissionMode: PermissionModeSchema.optional(),
    sessionType: z.enum(['simple', 'worktree']).optional(),
    worktreeName: z.string().optional()
})

const pathsExistsSchema = z.object({
    paths: z.array(z.string().min(1)).max(1000)
})

/**
 * 校验 cwd 必须在 machine 的 homeDir 范围内
 * homeDir 缺失时拒绝请求（与 list-directory 路由保持一致）
 */
function validateCwd(cwd: string, homeDir: string | undefined): Response | null {
    if (!homeDir) {
        return new Response(JSON.stringify({ error: 'Machine homeDir not available' }), { status: 400 })
    }
    const validation = validateHomeDirPath(cwd, homeDir)
    if (!validation.valid) {
        return new Response(JSON.stringify({ error: validation.error }), { status: 403 })
    }
    // 拒绝风险目录（密钥/凭证/工具配置），防止 ripgrep/list 读取敏感文件
    if (isWithinBlacklistedDir(cwd, homeDir)) {
        return new Response(JSON.stringify({ error: 'Access denied: path is in a restricted directory' }), { status: 403 })
    }
    return null
}

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

        // 安全校验：directory 必须在 homeDir 内
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
            parsed.data.permissionMode,
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

        const cwdError = validateCwd(cwd, machine.metadata?.homeDir)
        if (cwdError) return cwdError

        try {
            const result = await engine.machineRefreshMetadata(machineId, cwd)
            return c.json({ success: true, metadata: result.metadata ?? {} })
        } catch (error) {
            return c.json({ error: error instanceof Error ? error.message : 'Failed to refresh metadata' }, 500)
        }
    })

    // 文件流式上传到 machine 指定目录（二进制 body + header 元信息，对称 session 通道）
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

        // cwd 走 header（X-Mobi-Cwd），因 body 是二进制流（非 multipart）
        const cwd = safeDecodeHeader(c.req.header('X-Mobi-Cwd'))
        if (!cwd) {
            return c.json({ success: false, error: 'cwd required (X-Mobi-Cwd header)' }, 400)
        }
        const cwdError = validateCwd(cwd, machine.metadata?.homeDir)
        if (cwdError) return cwdError

        const filename = safeDecodeHeader(c.req.header('X-Mobi-Filename'))
        const totalSize = Number(c.req.header('Content-Length') ?? 0)
        if (!filename) {
            return c.json({ success: false, error: 'Filename required (X-Mobi-Filename header)' }, 400)
        }
        if (!Number.isFinite(totalSize) || totalSize <= 0) {
            return c.json({ success: false, error: 'Invalid Content-Length' }, 400)
        }
        if (totalSize > MAX_UPLOAD_BYTES) {
            return c.json({ success: false, error: 'File too large (max 50MB)' }, 413)
        }

        const reader = c.req.raw.body?.getReader()
        if (!reader) {
            return c.json({ success: false, error: 'No request body' }, 400)
        }

        try {
            const path = await streamUpload(
                reader,
                filename,
                totalSize,
                (fn, p, off, chunk) => engine.machineUploadFileRange(machineId, cwd, fn, p, off, chunk, totalSize),
                (p) => engine.machineDeleteUpload(machineId, cwd, p),
            )
            return c.json({ success: true, path })
        } catch (error) {
            return c.json({
                success: false,
                error: error instanceof Error ? error.message : 'Failed to upload file'
            }, 500)
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

        const cwdError = validateCwd(body.cwd, machine.metadata?.homeDir)
        if (cwdError) return cwdError

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

        const cwdError = validateCwd(cwd, machine.metadata?.homeDir)
        if (cwdError) return cwdError

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

        const cwdError = validateCwd(cwd, machine.metadata?.homeDir)
        if (cwdError) return cwdError

        try {
            const result = await engine.machineListSessionDirectory(machineId, cwd, path)
            return c.json(result)
        } catch (error) {
            return c.json({ success: false, error: error instanceof Error ? error.message : 'Failed to list session directory' }, 500)
        }
    })

    return app
}
