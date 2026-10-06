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
 * 文件域路由（单机）：/api/files/*（ticket 202/203，原 /api/machines/:id/* 去机器维度）。
 *
 * 参数来源：原 URL path 段 :id 删除，cwd/path 仍为显式 query 参数（客户端自报信任模型，
 * 与 upload/list-directory 一致）；cwd 先过 homeDir 黑白名单校验，路径边界与类型白名单
 * 由 cli 策略层最终裁决（读边界 cwd ∪ home−黑名单 + 图片/html/js/css 白名单，见 cli
 * machineFiles handler 与 ADR 0004）。上传 header 协议（X-Mobi-Cwd 等）原样保留。
 */

import { Hono } from 'hono'
import { z } from 'zod'
import { validateHomeDirPath } from '@mobi/shared/pathSecurity'
import { MAX_UPLOAD_BYTES } from '@mobi/shared/upload'
import { streamUpload, concatBytes } from '../utils/uploadStream'
import { safeDecodeHeader } from '../utils/headers'
import type { SyncEngine } from '../../sync/syncEngine'
import type { WebAppEnv } from '../middleware/auth'
import { requireHostHomeDir, validateCwd } from './guards'
import { serveFileContent } from './serveFileContent'

/**
 * HTML 预览 CSP：host 通道与 session 通道同源——serveFileContent 按 mime 恒注
 * PREVIEW_CSP（capability 面与威胁模型注释在其定义处）。files read-file 白名单放行了
 * .html/.js——若裸渲染，宿主侧植入的 HTML 将在 daemon origin 执行且自带登录 cookie，
 * 可自由调 API；恒注 CSP 后 script 仍可跑（内嵌页面预览语义），但任何网络外呼被切断，
 * 攻击面收敛为纯展示。
 */

const pathsExistsSchema = z.object({
    paths: z.array(z.string().min(1)).max(1000)
})

export function createFilesRoutes(getSyncEngine: () => SyncEngine | null): Hono<WebAppEnv> {
    const app = new Hono<WebAppEnv>()

    app.post('/files/paths-exists', async (c) => {
        const engine = getSyncEngine()
        if (!engine) {
            return c.json({ error: 'Not connected' }, 503)
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
            const exists = await engine.checkPathsExist(uniquePaths)
            return c.json({ exists })
        } catch (error) {
            return c.json({ error: error instanceof Error ? error.message : 'Failed to check paths' }, 500)
        }
    })

    app.get('/files/list-directory', async (c) => {
        const engine = getSyncEngine()
        if (!engine) {
            return c.json({ error: 'Not connected' }, 503)
        }

        // 单机：homeDir 直源宿主静态身份（requireHostHomeDir），不再经 machines 行中转
        const homeDir = requireHostHomeDir()

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
            const result = await engine.listHostDirectory(path, homeDir)
            return c.json(result)
        } catch (error) {
            return c.json({ success: false, error: error instanceof Error ? error.message : 'Failed to list directory' }, 500)
        }
    })

    /**
     * host 通道读文件：跨会话存活的静态资源读取（消息附件预览等）。
     * 复用 serveFileContent 全套机制（meta→304→Range→stream），仅数据源换成 host reader。
     */
    app.get('/files/read-file', async (c) => {
        const engine = getSyncEngine()
        if (!engine) {
            return c.json({ error: 'Not connected' }, 503)
        }

        const cwd = c.req.query('cwd') ?? ''
        const path = c.req.query('path') ?? ''
        if (!cwd || !path) {
            return c.json({ error: 'cwd and path parameters are required' }, 400)
        }

        // 与 list-directory 同一判据：cwd 必须落在 homeDir 内且不在黑名单目录
        const invalidCwd = validateCwd(cwd, requireHostHomeDir())
        if (invalidCwd) {
            return invalidCwd
        }

        return serveFileContent(
            c,
            {
                readFileMeta: (p) => engine.hostReadFileMeta(cwd, p),
                readFileRange: (p, o, l) => engine.hostReadFileRange(cwd, p, o, l),
            },
            path,
            {
                download: c.req.query('download') === '1',
                // nosniff 防 MIME 嗅探；html 文档 CSP 由 serveFileContent 恒注（见上注）
                extraHeaders: { 'x-content-type-options': 'nosniff' },
            },
        )
    })

    app.get('/files/search-files', async (c) => {
        const engine = getSyncEngine()
        if (!engine) {
            return c.json({ error: 'Not connected' }, 503)
        }

        const cwd = c.req.query('cwd')
        const query = c.req.query('query')
        if (!cwd) {
            return c.json({ error: 'cwd parameter is required' }, 400)
        }
        if (!query) {
            return c.json({ error: 'query parameter is required' }, 400)
        }
        // 与 session 路由同参：缺省曾致该通道永远走「目录+文件合并」，type 过滤失效
        const type = c.req.query('type') as 'file' | 'directory' | undefined

        const cwdError = validateCwd(cwd, requireHostHomeDir())
        if (cwdError) return cwdError

        try {
            const result = await engine.hostSearchFiles(cwd, query, type)
            return c.json(result)
        } catch (error) {
            return c.json({ success: false, error: error instanceof Error ? error.message : 'Failed to search files' }, 500)
        }
    })

    app.get('/files/list-session-directory', async (c) => {
        const engine = getSyncEngine()
        if (!engine) {
            return c.json({ error: 'Not connected' }, 503)
        }

        const cwd = c.req.query('cwd')
        const path = c.req.query('path') ?? ''
        if (!cwd) {
            return c.json({ error: 'cwd parameter is required' }, 400)
        }

        const cwdError = validateCwd(cwd, requireHostHomeDir())
        if (cwdError) return cwdError

        // 可选 prefix：大目录下收窄候选集，避免匹配项被 MAX_RESULTS 截断
        const prefix = c.req.query('prefix') ?? undefined

        try {
            const result = await engine.hostListSessionDirectory(cwd, path, prefix)
            return c.json(result)
        } catch (error) {
            return c.json({ success: false, error: error instanceof Error ? error.message : 'Failed to list session directory' }, 500)
        }
    })

    // ── 上传域（ticket 203：原 /machines/:id/upload*，header 协议原样）──

    // 文件流式上传到宿主指定目录（二进制 body + header 元信息，对称 session 通道）
    app.post('/files/upload', async (c) => {
        const engine = getSyncEngine()
        if (!engine) {
            return c.json({ error: 'Not connected' }, 503)
        }

        // cwd 走 header（X-Mobi-Cwd），因 body 是二进制流（非 multipart）
        const cwd = safeDecodeHeader(c.req.header('X-Mobi-Cwd'))
        if (!cwd) {
            return c.json({ success: false, error: 'cwd required (X-Mobi-Cwd header)' }, 400)
        }
        const cwdError = validateCwd(cwd, requireHostHomeDir())
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
                (fn, p, off, chunk) => engine.hostUploadFileRange(cwd, fn, p, off, chunk, totalSize),
                (p) => engine.hostDeleteUpload(cwd, p),
            )
            return c.json({ success: true, path })
        } catch (error) {
            return c.json({
                success: false,
                error: error instanceof Error ? error.message : 'Failed to upload file'
            }, 500)
        }
    })

    // 删除已上传文件
    app.post('/files/upload/delete', async (c) => {
        const engine = getSyncEngine()
        if (!engine) {
            return c.json({ error: 'Not connected' }, 503)
        }

        const body = await c.req.json().catch(() => null) as { path?: string; cwd?: string } | null
        if (!body?.path || !body?.cwd) {
            return c.json({ error: 'path and cwd fields are required' }, 400)
        }

        const cwdError = validateCwd(body.cwd, requireHostHomeDir())
        if (cwdError) return cwdError

        try {
            const result = await engine.hostDeleteUpload(body.cwd, body.path)
            return c.json(result)
        } catch (error) {
            return c.json({ error: error instanceof Error ? error.message : 'Failed to delete upload' }, 500)
        }
    })

    // upload/replace：同 path 原子替换已上传文件（对称 session 通道；octet-stream 全量
    // 内容，cwd/path 走 header），闸门组对齐 session upload/replace
    app.post('/files/upload/replace', async (c) => {
        const engine = getSyncEngine()
        if (!engine) {
            return c.json({ error: 'Not connected' }, 503)
        }

        const cwd = safeDecodeHeader(c.req.header('X-Mobi-Cwd'))
        if (!cwd) {
            return c.json({ success: false, error: 'cwd required (X-Mobi-Cwd header)' }, 400)
        }
        const cwdError = validateCwd(cwd, requireHostHomeDir())
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
            const result = await engine.hostReplaceUpload(cwd, path, concatBytes(parts))
            return c.json(result)
        } catch (error) {
            return c.json({ error: error instanceof Error ? error.message : 'Failed to replace upload' }, 500)
        }
    })

    return app
}
