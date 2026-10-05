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
 * 文件读域路由（单机）：/api/files/*（ticket 202，原 /api/machines/:id/* 五条去机器维度）。
 *
 * 参数来源：原 URL path 段 :id 删除，cwd/path 仍为显式 query 参数（客户端自报信任模型，
 * 与 upload/list-directory 一致）；cwd 先过 homeDir 黑白名单校验，路径边界与类型白名单
 * 由 cli 策略层最终裁决（读边界 cwd ∪ home−黑名单 + 图片/html/js/css 白名单，见 cli
 * machineFiles handler 与 ADR 0004）。
 */

import { Hono } from 'hono'
import { z } from 'zod'
import { validateHomeDirPath } from '@mobi/shared/pathSecurity'
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
            // machineId 实参为 D4=C 路由残留（本地实现忽略），602 形参收窄时删除
            const exists = await engine.checkPathsExist('', uniquePaths)
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
            const result = await engine.listMachineDirectory('', path, homeDir)
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
                readFileMeta: (p) => engine.machineReadFileMeta('', cwd, p),
                readFileRange: (p, o, l) => engine.machineReadFileRange('', cwd, p, o, l),
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
            const result = await engine.machineSearchFiles('', cwd, query, type)
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
            const result = await engine.machineListSessionDirectory('', cwd, path, prefix)
            return c.json(result)
        } catch (error) {
            return c.json({ success: false, error: error instanceof Error ? error.message : 'Failed to list session directory' }, 500)
        }
    })

    return app
}
