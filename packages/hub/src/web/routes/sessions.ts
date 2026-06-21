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

import { getPermissionModesForFlavor, isPermissionModeAllowedForFlavor, toSessionSummary } from '@mobi/shared'
import { EFFORT_LEVELS } from '@mobi/shared/modes'
import { PermissionModeSchema } from '@mobi/shared/schemas'
import { MAX_UPLOAD_BYTES } from '@mobi/shared/upload'
import { Hono } from 'hono'
import { stream } from 'hono/streaming'
import { basename } from 'node:path'
import { z } from 'zod'
import type { SyncEngine, Session } from '../../sync/syncEngine'
import type { WebAppEnv } from '../middleware/auth'
import { requireSessionFromParam, requireSyncEngine } from './guards'

const permissionModeSchema = z.object({
    mode: PermissionModeSchema
})

const modelSchema = z.object({
    model: z.string().nullable()
})

const renameSessionSchema = z.object({
    name: z.string().min(1).max(255)
})

const uploadDeleteSchema = z.object({
    path: z.string().min(1)
})

export function createSessionsRoutes(getSyncEngine: () => SyncEngine | null): Hono<WebAppEnv> {
    const app = new Hono<WebAppEnv>()

    app.get('/sessions', (c) => {
        const engine = requireSyncEngine(c, getSyncEngine)
        if (engine instanceof Response) {
            return engine
        }

        const getPendingCount = (s: Session) => s.agentState?.requests ? Object.keys(s.agentState.requests).length : 0

        const namespace = c.get('namespace')
        const sessions = engine.getSessionsByNamespace(namespace)
            .sort((a, b) => {
                // Active sessions first
                if (a.active !== b.active) {
                    return a.active ? -1 : 1
                }
                // Within active sessions, sort by pending requests count
                const aPending = getPendingCount(a)
                const bPending = getPendingCount(b)
                if (a.active && aPending !== bPending) {
                    return bPending - aPending
                }
                // Then by updatedAt
                return b.updatedAt - a.updatedAt
            })
            .map(toSessionSummary)

        return c.json({ sessions })
    })

    app.get('/sessions/:id', (c) => {
        const engine = requireSyncEngine(c, getSyncEngine)
        if (engine instanceof Response) {
            return engine
        }

        const sessionResult = requireSessionFromParam(c, engine)
        if (sessionResult instanceof Response) {
            return sessionResult
        }

        return c.json({ session: sessionResult.session })
    })

    app.post('/sessions/:id/resume', async (c) => {
        const engine = requireSyncEngine(c, getSyncEngine)
        if (engine instanceof Response) {
            return engine
        }

        const sessionResult = requireSessionFromParam(c, engine)
        if (sessionResult instanceof Response) {
            return sessionResult
        }

        const namespace = c.get('namespace')
        const result = await engine.resumeSession(sessionResult.sessionId, namespace)
        if (result.type === 'error') {
            const status: 200 | 401 | 403 | 404 | 500 | 503 =
                result.code === 'no_machine_online' ? 503
                    : result.code === 'access_denied' ? 403
                        : result.code === 'session_not_found' ? 404
                            : 500
            return c.json({ error: result.message, code: result.code }, status)
        }

        return c.json({ type: 'success', sessionId: result.sessionId })
    })

    app.post('/sessions/:id/upload', async (c) => {
        const engine = requireSyncEngine(c, getSyncEngine)
        if (engine instanceof Response) {
            return engine
        }

        const sessionResult = requireSessionFromParam(c, engine, { requireActive: true })
        if (sessionResult instanceof Response) {
            return sessionResult
        }

        try {
            // 解析 multipart/form-data
            const body = await c.req.parseBody()
            const file = body['file']

            if (!file || !(file instanceof File)) {
                return c.json({ success: false, error: 'File is required' }, 400)
            }

            // 文件大小校验
            if (file.size > MAX_UPLOAD_BYTES) {
                return c.json({ success: false, error: 'File too large (max 50MB)' }, 413)
            }

            // 读取文件内容为 ArrayBuffer 再转为 base64
            const arrayBuffer = await file.arrayBuffer()
            const base64Content = Buffer.from(arrayBuffer).toString('base64')

            const result = await engine.uploadFile(
                sessionResult.sessionId,
                file.name,
                base64Content,
                file.type,
            )
            if (!result.success) {
                return c.json(result, 400)
            }
            return c.json(result)
        } catch (error) {
            return c.json({
                success: false,
                error: error instanceof Error ? error.message : 'Failed to upload file'
            }, 500)
        }
    })

    app.post('/sessions/:id/upload/delete', async (c) => {
        const engine = requireSyncEngine(c, getSyncEngine)
        if (engine instanceof Response) {
            return engine
        }

        const sessionResult = requireSessionFromParam(c, engine, { requireActive: true })
        if (sessionResult instanceof Response) {
            return sessionResult
        }

        const body = await c.req.json().catch(() => null)
        const parsed = uploadDeleteSchema.safeParse(body)
        if (!parsed.success) {
            return c.json({ error: 'Invalid body' }, 400)
        }

        try {
            const result = await engine.deleteUploadFile(sessionResult.sessionId, parsed.data.path)
            if (!result.success) {
                return c.json(result, 400)
            }
            return c.json(result)
        } catch (error) {
            return c.json({
                success: false,
                error: error instanceof Error ? error.message : 'Failed to delete upload'
            }, 500)
        }
    })

    app.post('/sessions/:id/abort', async (c) => {
        const engine = requireSyncEngine(c, getSyncEngine)
        if (engine instanceof Response) {
            return engine
        }

        const sessionResult = requireSessionFromParam(c, engine, { requireActive: true })
        if (sessionResult instanceof Response) {
            return sessionResult
        }

        await engine.abortSession(sessionResult.sessionId)
        return c.json({ ok: true })
    })

    // 停止后台任务
    app.post('/sessions/:id/stop-task', async (c) => {
        const engine = requireSyncEngine(c, getSyncEngine)
        if (engine instanceof Response) return engine

        const sessionResult = requireSessionFromParam(c, engine, { requireActive: true })
        if (sessionResult instanceof Response) return sessionResult

        const body = await c.req.json().catch(() => ({}))
        const taskId = z.string().parse(body?.taskId)

        await engine.stopTask(sessionResult.sessionId, taskId)
        return c.json({ ok: true })
    })

    app.post('/sessions/:id/archive', async (c) => {
        const engine = requireSyncEngine(c, getSyncEngine)
        if (engine instanceof Response) {
            return engine
        }

        const sessionResult = requireSessionFromParam(c, engine, { requireActive: true })
        if (sessionResult instanceof Response) {
            return sessionResult
        }

        await engine.archiveSession(sessionResult.sessionId)
        return c.json({ ok: true })
    })

    app.post('/sessions/:id/switch', async (c) => {
        const engine = requireSyncEngine(c, getSyncEngine)
        if (engine instanceof Response) {
            return engine
        }

        const sessionResult = requireSessionFromParam(c, engine, { requireActive: true })
        if (sessionResult instanceof Response) {
            return sessionResult
        }

        await engine.switchSession(sessionResult.sessionId, 'remote')
        return c.json({ ok: true })
    })

    app.post('/sessions/:id/permission-mode', async (c) => {
        const engine = requireSyncEngine(c, getSyncEngine)
        if (engine instanceof Response) {
            return engine
        }

        const sessionResult = requireSessionFromParam(c, engine, { requireActive: true })
        if (sessionResult instanceof Response) {
            return sessionResult
        }

        const body = await c.req.json().catch(() => null)
        const parsed = permissionModeSchema.safeParse(body)
        if (!parsed.success) {
            return c.json({ error: 'Invalid body' }, 400)
        }

        const flavor = sessionResult.session.metadata?.flavor ?? 'claude'
        const mode = parsed.data.mode

        const allowedModes = getPermissionModesForFlavor(flavor)
        if (allowedModes.length === 0) {
            return c.json({ error: 'Permission mode not supported for session flavor' }, 400)
        }

        if (!isPermissionModeAllowedForFlavor(mode, flavor)) {
            return c.json({ error: 'Invalid permission mode for session flavor' }, 400)
        }

        try {
            await engine.applySessionConfig(sessionResult.sessionId, { permissionMode: mode })
            return c.json({ ok: true })
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Failed to apply permission mode'
            return c.json({ error: message }, 409)
        }
    })

    app.post('/sessions/:id/model', async (c) => {
        const engine = requireSyncEngine(c, getSyncEngine)
        if (engine instanceof Response) {
            return engine
        }

        const sessionResult = requireSessionFromParam(c, engine, { requireActive: true })
        if (sessionResult instanceof Response) {
            return sessionResult
        }

        const body = await c.req.json().catch(() => null)
        const parsed = modelSchema.safeParse(body)
        if (!parsed.success) {
            return c.json({ error: 'Invalid body' }, 400)
        }

        try {
            await engine.applySessionConfig(sessionResult.sessionId, { model: parsed.data.model })
            return c.json({ ok: true })
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Failed to apply model'
            return c.json({ error: message }, 409)
        }
    })

    const effortSchema = z.object({
        effort: z.enum(EFFORT_LEVELS)
    })

    app.post('/sessions/:id/effort', async (c) => {
        const engine = requireSyncEngine(c, getSyncEngine)
        if (engine instanceof Response) {
            return engine
        }

        const sessionResult = requireSessionFromParam(c, engine, { requireActive: true })
        if (sessionResult instanceof Response) {
            return sessionResult
        }

        const body = await c.req.json().catch(() => null)
        const parsed = effortSchema.safeParse(body)
        if (!parsed.success) {
            return c.json({ error: 'Invalid body' }, 400)
        }

        try {
            await engine.applySessionConfig(sessionResult.sessionId, { effort: parsed.data.effort })
            return c.json({ ok: true })
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Failed to apply effort'
            return c.json({ error: message }, 409)
        }
    })

    // 清除 session runtimeState 中的指定字段
    app.patch('/sessions/:id/runtime-state', async (c) => {
        const engine = requireSyncEngine(c, getSyncEngine)
        if (engine instanceof Response) {
            return engine
        }

        const sessionResult = requireSessionFromParam(c, engine)
        if (sessionResult instanceof Response) {
            return sessionResult
        }

        const body = await c.req.json().catch(() => null)
        const validFields = ['todos', 'tasks', 'backgroundTasks', 'teamState']
        const schema = z.object({
            clearFields: z.array(z.enum(validFields as [string, ...string[]])).min(1),
        })
        const parsed = schema.safeParse(body)
        if (!parsed.success) {
            return c.json({ error: 'Invalid body: clearFields must be a non-empty array of valid field names (todos, tasks, backgroundTasks, teamState)' }, 400)
        }

        const namespace = c.get('namespace')
        const cleared = engine.clearRuntimeStateFields(
            sessionResult.sessionId,
            parsed.data.clearFields,
            namespace
        )

        return c.json({ ok: cleared })
    })

    app.patch('/sessions/:id', async (c) => {
        const engine = requireSyncEngine(c, getSyncEngine)
        if (engine instanceof Response) {
            return engine
        }

        const sessionResult = requireSessionFromParam(c, engine)
        if (sessionResult instanceof Response) {
            return sessionResult
        }

        const body = await c.req.json().catch(() => null)
        const parsed = renameSessionSchema.safeParse(body)
        if (!parsed.success) {
            return c.json({ error: 'Invalid body: name is required' }, 400)
        }

        try {
            await engine.renameSession(sessionResult.sessionId, parsed.data.name)
            return c.json({ ok: true })
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Failed to rename session'
            // Map concurrency/version errors to 409 conflict
            if (message.includes('concurrently') || message.includes('version')) {
                return c.json({ error: message }, 409)
            }
            return c.json({ error: message }, 500)
        }
    })

    app.delete('/sessions/:id', async (c) => {
        const engine = requireSyncEngine(c, getSyncEngine)
        if (engine instanceof Response) {
            return engine
        }

        const sessionResult = requireSessionFromParam(c, engine)
        if (sessionResult instanceof Response) {
            return sessionResult
        }

        if (sessionResult.session.active) {
            return c.json({ error: 'Cannot delete active session. Archive it first.' }, 409)
        }

        try {
            await engine.deleteSession(sessionResult.sessionId)
            return c.json({ ok: true })
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Failed to delete session'
            // Map "active session" error to 409 conflict (race condition: session became active)
            if (message.includes('active')) {
                return c.json({ error: message }, 409)
            }
            return c.json({ error: message }, 500)
        }
    })

    app.get('/sessions/:id/search-files', async (c) => {
        const engine = requireSyncEngine(c, getSyncEngine)
        if (engine instanceof Response) {
            return engine
        }

        const sessionResult = requireSessionFromParam(c, engine)
        if (sessionResult instanceof Response) {
            return sessionResult
        }

        const query = c.req.query('query') ?? ''
        if (!query) {
            return c.json({ success: false, error: 'Query parameter is required' }, 400)
        }

        try {
            const result = await engine.searchSessionFiles(sessionResult.sessionId, query)
            return c.json(result)
        } catch (error) {
            return c.json({
                success: false,
                error: error instanceof Error ? error.message : 'Failed to search files'
            }, 500)
        }
    })

    app.get('/sessions/:id/list-directory', async (c) => {
        const engine = requireSyncEngine(c, getSyncEngine)
        if (engine instanceof Response) {
            return engine
        }

        const sessionResult = requireSessionFromParam(c, engine)
        if (sessionResult instanceof Response) {
            return sessionResult
        }

        const path = c.req.query('path') ?? ''
        if (!path) {
            return c.json({ success: false, error: 'Path parameter is required' }, 400)
        }

        try {
            const result = await engine.listSessionDirectory(sessionResult.sessionId, path)
            return c.json(result)
        } catch (error) {
            return c.json({
                success: false,
                error: error instanceof Error ? error.message : 'Failed to list directory'
            }, 500)
        }
    })

    app.get('/sessions/:id/read-file', async (c) => {
        const engine = requireSyncEngine(c, getSyncEngine)
        if (engine instanceof Response) {
            return engine
        }

        const sessionResult = requireSessionFromParam(c, engine)
        if (sessionResult instanceof Response) {
            return sessionResult
        }

        const path = c.req.query('path') ?? ''
        if (!path) {
            return c.json({ success: false, error: 'Path parameter is required' }, 400)
        }
        const download = c.req.query('download') === '1'

        // 元信息（mime/size/etag），由 cli 经 RPC 返回
        const meta = await engine.readFileMeta(sessionResult.sessionId, path)
        if (!meta.success || !meta.meta) {
            return c.json({ success: false, error: meta.error ?? 'Failed to read file meta' }, 500)
        }
        const { mime, size, etag } = meta.meta

        // 协商缓存：etag 命中直接返回空体
        if (c.req.header('if-none-match') === etag) {
            return new Response(null, { status: 304, headers: { etag } })
        }

        // Range 解析（仅支持 bytes=start-end / bytes=start-）
        let start = 0
        let end = size - 1
        let isRange = false
        const rangeHeader = c.req.header('range')
        if (rangeHeader) {
            const m = /^bytes=(\d+)-(\d*)$/.exec(rangeHeader)
            if (m) {
                start = Number(m[1])
                if (m[2]) {
                    end = Number(m[2])
                }
                isRange = true
            }
            // 越界或非法区间：416
            if (!isRange || start > end || start >= size) {
                return new Response(null, {
                    status: 416,
                    headers: { 'content-range': `bytes */${size}` },
                })
            }
            // end 不超过文件末尾
            if (end >= size) {
                end = size - 1
            }
        }

        // 响应头：stream() 内部最终以 c.newResponse(readable) 收尾，
        // 此前用 c.header()/c.status() 设置的头与状态会被透传
        c.header('content-type', mime)
        c.header('content-length', String(end - start + 1))
        c.header('etag', etag)
        c.header('accept-ranges', 'bytes')
        c.header('cache-control', 'private, no-cache')
        if (isRange) {
            c.header('content-range', `bytes ${start}-${end}/${size}`)
        }
        if (download) {
            const safeName = encodeURIComponent(basename(path))
            // RFC 5987：filename* 优先供现代浏览器解码中文文件名，filename 为 ASCII 兼容兜底
            c.header('content-disposition', `attachment; filename="${safeName}"; filename*=UTF-8''${safeName}`)
        }
        c.status(isRange ? 206 : 200)

        // 流式翻译：循环 readFileRange 分片读取
        // 背压：正常消费时 TransformStream writer.write 提供天然背压（web 消费慢 → readable 不读
        // → writable queue 满 → write 的 Promise 不 resolve → 循环暂停）。
        // 但 hono StreamingApi.write 内部吞掉所有异常，客户端断开后 write 仍立即 resolve，
        // 背压失效——靠循环内 s.aborted/s.closed 检查兜底，避免空转把剩余文件全量拉进内存丢弃。
        const CHUNK = 2 * 1024 * 1024
        return stream(c, async (s) => {
            let offset = start
            while (offset <= end) {
                // 客户端断开（abort/close）及时停止
                if (s.aborted || s.closed) {
                    break
                }
                const len = Math.min(CHUNK, end - offset + 1)
                const r = await engine.readFileRange(sessionResult.sessionId, path, offset, len)
                if (!r.success || !r.chunk) {
                    break
                }
                await s.write(r.chunk)
                offset += r.chunk.byteLength
            }
        })
    })

    // 文件元信息（mime/size/etag），轻量 stat 不下载内容——供 web 大小判断/协商缓存先行
    app.get('/sessions/:id/file-meta', async (c) => {
        const engine = requireSyncEngine(c, getSyncEngine)
        if (engine instanceof Response) {
            return engine
        }

        const sessionResult = requireSessionFromParam(c, engine)
        if (sessionResult instanceof Response) {
            return sessionResult
        }

        const path = c.req.query('path') ?? ''
        if (!path) {
            return c.json({ success: false, error: 'Path parameter is required' }, 400)
        }

        try {
            const meta = await engine.readFileMeta(sessionResult.sessionId, path)
            if (!meta.success) {
                return c.json({ success: false, error: meta.error ?? 'Failed to read file meta' }, 500)
            }
            return c.json({ success: true, meta: meta.meta })
        } catch (error) {
            return c.json({
                success: false,
                error: error instanceof Error ? error.message : 'Failed to read file meta',
            }, 500)
        }
    })

    app.get('/sessions/:id/metadata', async (c) => {
        const engine = requireSyncEngine(c, getSyncEngine)
        if (engine instanceof Response) {
            return engine
        }

        // Session must exist but doesn't need to be active
        const sessionResult = requireSessionFromParam(c, engine)
        if (sessionResult instanceof Response) {
            return sessionResult
        }

        // 优先从 DB 中获取完整 sdkMetadata
        const sdkMetadata = sessionResult.session.metadata?.sdkMetadata
        if (sdkMetadata && Object.keys(sdkMetadata).length > 0) {
            return c.json({ success: true, metadata: sdkMetadata })
        }

        // Fallback: RPC 让 CLI 通过 SDK 提取完整 metadata
        try {
            const result = await engine.refreshMetadata(sessionResult.sessionId)

            // 存入完整 metadata，后续所有字段都可直接从 DB 读取
            if (result.success && result.metadata) {
                engine.updateSDKMetadata(sessionResult.sessionId, result.metadata)
            }

            return c.json({ success: true, metadata: result.metadata ?? {} })
        } catch (error) {
            return c.json({
                success: false,
                error: error instanceof Error ? error.message : 'Failed to get metadata'
            })
        }
    })

    return app
}
