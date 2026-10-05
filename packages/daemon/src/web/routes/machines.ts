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

/**
 * machine 通道过渡路由（ticket 202 后仅剩 metadata + upload×3；文件读五条已迁
 * routes/files.ts，spawn 已迁 routes/sessions.ts，webTools 在 routes/webTools.ts）。
 * 203/204 迁走后本文件整体删除。
 */

import { Hono } from 'hono'
import { MAX_UPLOAD_BYTES } from '@mobi/shared/upload'
import { streamUpload, concatBytes } from '../utils/uploadStream'
import { safeDecodeHeader } from '../utils/headers'
import { type SyncEngine } from '../../sync/syncEngine'
import type { WebAppEnv } from '../middleware/auth'
import { requireMachine, validateCwd } from './guards'

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

    // upload/replace：同 path 原子替换已上传文件（对称 session 通道；octet-stream 全量
    // 内容，cwd/path 走 header），闸门组对齐 session upload/replace
    app.post('/machines/:id/upload/replace', async (c) => {
        const engine = getSyncEngine()
        if (!engine) {
            return c.json({ error: 'Not connected' }, 503)
        }

        const machineId = c.req.param('id')
        const machine = requireMachine(c, engine, machineId)
        if (machine instanceof Response) {
            return machine
        }

        const cwd = safeDecodeHeader(c.req.header('X-Mobi-Cwd'))
        if (!cwd) {
            return c.json({ success: false, error: 'cwd required (X-Mobi-Cwd header)' }, 400)
        }
        const cwdError = validateCwd(cwd, machine.metadata?.homeDir)
        if (cwdError) return cwdError

        const path = safeDecodeHeader(c.req.header('X-Mobi-Path'))
        if (!path) {
            return c.json({ success: false, error: 'Path required (X-Mobi-Path header)' }, 400)
        }

        const totalSize = Number(c.req.header('Content-Length') ?? 0)
        if (!Number.isFinite(totalSize) || totalSize < 0) {
            return c.json({ success: false, error: 'Invalid Content-Length' }, 400)
        }
        if (totalSize > MAX_UPLOAD_BYTES) {
            return c.json({ success: false, error: 'File too large (max 50MB)' }, 413)
        }

        const reader = c.req.raw.body?.getReader()
        if (!reader) {
            return c.json({ success: false, error: 'No request body' }, 400)
        }

        const parts: Uint8Array[] = []
        let received = 0
        for (;;) {
            const { done, value } = await reader.read()
            if (done) break
            if (value) {
                received += value.byteLength
                if (received > MAX_UPLOAD_BYTES) {
                    return c.json({ success: false, error: 'File too large (max 50MB)' }, 413)
                }
                parts.push(value)
            }
        }

        try {
            const result = await engine.machineReplaceUpload(machineId, cwd, path, concatBytes(parts))
            return c.json(result)
        } catch (error) {
            return c.json({ error: error instanceof Error ? error.message : 'Failed to replace upload' }, 500)
        }
    })

    return app
}
