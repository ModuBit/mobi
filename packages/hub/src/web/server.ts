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

import { hubLogger } from '../logger'
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { logger } from 'hono/logger'
import { join } from 'node:path'
import { existsSync } from 'node:fs'
import { serveStatic } from 'hono/bun'
import { configuration } from '../configuration'
import { PROTOCOL_VERSION, MAX_UPLOAD_BYTES } from '@mobi/shared'
import type { SyncEngine } from '../sync/syncEngine'
import { createAuthMiddleware, type WebAppEnv } from './middleware/auth'
import { createAuthRoutes } from './routes/auth'
import { createEventsRoutes } from './routes/events'
import { createSessionsRoutes } from './routes/sessions'
import { createProjectsRoutes } from './routes/projects'
import { createMessagesRoutes } from './routes/messages'
import { createPermissionsRoutes } from './routes/permissions'
import { createMachinesRoutes } from './routes/machines'
import { createGitRoutes } from './routes/git'
import { createCliRoutes } from './routes/cli'
import { createPushRoutes } from './routes/push'
import { createManifestRoutes } from './routes/manifest'
import type { SSEManager } from '../sse/sseManager'
import type { VisibilityTracker } from '../visibility/visibilityTracker'
import type { Server as BunServer } from 'bun'
import type { Server as SocketEngine } from '@socket.io/bun-engine'
import type { WebSocketData } from '@socket.io/bun-engine'
import { loadEmbeddedAssetMap, type EmbeddedWebAsset } from './embeddedAssets'
import { isBunCompiled } from '../utils/bunCompiled'
import { assertCorsOriginsForCredentials } from '../utils/cors'
import { staticCacheControl } from './utils/staticCacheControl'
import type { Store } from '../store'

function findWebappDistDir(override?: string): { distDir: string; indexHtmlPath: string } {
    // 测试可注入临时 dist 目录，避免依赖真实 web/dist 构建产物
    if (override) {
        return { distDir: override, indexHtmlPath: join(override, 'index.html') }
    }

    const candidates = [
        join(process.cwd(), '..', 'web', 'dist'),
        join(import.meta.dir, '..', '..', '..', 'web', 'dist'),
        join(process.cwd(), 'web', 'dist')
    ]

    for (const distDir of candidates) {
        const indexHtmlPath = join(distDir, 'index.html')
        if (existsSync(indexHtmlPath)) {
            return { distDir, indexHtmlPath }
        }
    }

    const distDir = candidates[0]
    return { distDir, indexHtmlPath: join(distDir, 'index.html') }
}

function serveEmbeddedAsset(asset: EmbeddedWebAsset): Response {
    return new Response(Bun.file(asset.sourcePath), {
        headers: {
            'Content-Type': asset.mimeType
        }
    })
}

export function createWebApp(options: {
    getSyncEngine: () => SyncEngine | null
    getSseManager: () => SSEManager | null
    getVisibilityTracker: () => VisibilityTracker | null
    jwtSecret: Uint8Array
    store: Store
    vapidPublicKey: string
    corsOrigins?: string[]
    embeddedAssetMap: Map<string, EmbeddedWebAsset> | null
    distDirOverride?: string
}): Hono<WebAppEnv> {
    const app = new Hono<WebAppEnv>()

    app.use('*', logger())

    /**
     * 静态资源 Cache-Control 注入（Hub 远端 PWA 冷启动慢的根因修复）。
     *
     * 在下游路由处理完成后，按 staticCacheControl 策略给成功的 GET/HEAD 响应注入分层
     * Cache-Control（仅 200-299 与 304，不含 3xx 重定向）。见 utils/staticCacheControl.ts
     * 的背景说明：SW 接管竞态时浏览器 HTTP 缓存必须能兜底，否则每次冷启都重走远端慢隧道。
     *
     * 用 new Response 重建而非 c.header()：next() 后 c.res 已物化，显式重建最稳；
     * body 原样透传不缓冲，对大文件流式响应无性能影响。API/CLI 响应策略为 null 不动。
     */
    app.use('*', async (c, next) => {
        await next()
        const method = c.req.method
        if (method !== 'GET' && method !== 'HEAD') return
        const status = c.res.status
        // 仅给成功的实体响应打缓存头：200-299 与 304（协商缓存命中）。
        // 排除 3xx 重定向——给重定向打 max-age/immutable 会被永久缓存，跳转一旦有误无法修复。
        if (!((status >= 200 && status < 300) || status === 304)) return
        const policy = staticCacheControl(
            c.req.path,
            c.res.headers.get('content-type') ?? undefined,
        )
        if (!policy) return
        // 用 new Headers 复制再 set，保证原有 Content-Type 等全部保留
        // （spread Headers 进对象字面量在 Bun 下会丢 header，不可靠）
        const headers = new Headers(c.res.headers)
        headers.set('cache-control', policy)
        c.res = new Response(c.res.body, {
            status: c.res.status,
            statusText: c.res.statusText,
            headers,
        })
    })

    // 健康检查端点（不需要认证）
    app.get('/health', (c) => c.json({ status: 'ok', protocolVersion: PROTOCOL_VERSION }))

    const corsOrigins = options.corsOrigins ?? configuration.corsOrigins
    // 守卫：credentials:true + origin:'*' 互斥，浏览器会拒绝跨域 cookie → 全链路静默 401。
    // 启动期 throw，迫使运维配置具体域名（credentials:false 的 socket 层不受此约束）。
    assertCorsOriginsForCredentials(corsOrigins, true)
    const corsOriginOption = corsOrigins.includes('*') ? '*' : corsOrigins
    const corsMiddleware = cors({
        origin: corsOriginOption,
        // 允许跨域带 cookie（web withCredentials 依赖；credentials:true 时浏览器拒 origin: '*'，故 corsOriginOption 为具体域名）
        credentials: true,
        allowMethods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
        allowHeaders: ['authorization', 'content-type']
    })
    app.use('/api/*', corsMiddleware)
    app.use('/cli/*', corsMiddleware)

    app.route('/cli', createCliRoutes(options.getSyncEngine))

    app.route('/api', createAuthRoutes(options.jwtSecret))
    app.use('/api/*', createAuthMiddleware(options.jwtSecret))
    app.route('/api', createEventsRoutes(options.getSseManager, options.getSyncEngine, options.getVisibilityTracker))
    app.route('/api', createSessionsRoutes(options.getSyncEngine))
    app.route('/api', createProjectsRoutes(options.getSyncEngine))
    app.route('/api', createMessagesRoutes(options.getSyncEngine))
    app.route('/api', createPermissionsRoutes(options.getSyncEngine))
    app.route('/api', createMachinesRoutes(options.getSyncEngine))
    app.route('/api', createGitRoutes(options.getSyncEngine))
    app.route('/api', createPushRoutes(options.store, options.vapidPublicKey))

    // PWA Manifest（不需要认证）
    app.route('/', createManifestRoutes())

    if (options.embeddedAssetMap) {
        const embeddedAssetMap = options.embeddedAssetMap
        const indexHtmlAsset = embeddedAssetMap.get('/index.html')

        if (!indexHtmlAsset) {
            app.get('*', (c) => {
                return c.text(
                    'Embedded Mini App is missing index.html. Rebuild the executable after running bun run build:web.',
                    503
                )
            })
            return app
        }

        app.use('*', async (c, next) => {
            if (c.req.path.startsWith('/api')) {
                return await next()
            }

            if (c.req.method !== 'GET' && c.req.method !== 'HEAD') {
                return await next()
            }

            const asset = embeddedAssetMap.get(c.req.path)
            if (asset) {
                return serveEmbeddedAsset(asset)
            }

            return await next()
        })

        app.get('*', async (c, next) => {
            if (c.req.path.startsWith('/api')) {
                await next()
                return
            }

            return serveEmbeddedAsset(indexHtmlAsset)
        })

        return app
    }

    const { distDir, indexHtmlPath } = findWebappDistDir(options.distDirOverride)

    if (!existsSync(indexHtmlPath)) {
        app.get('/', (c) => {
            return c.text(
                'Mini App is not built.\n\nRun:\n  cd web\n  bun install\n  bun run build\n',
                503
            )
        })
        return app
    }

    app.use('/assets/*', serveStatic({ root: distDir }))

    app.use('*', async (c, next) => {
        if (c.req.path.startsWith('/api')) {
            await next()
            return
        }

        return await serveStatic({ root: distDir })(c, next)
    })

    app.get('*', async (c, next) => {
        if (c.req.path.startsWith('/api')) {
            await next()
            return
        }

        return await serveStatic({ root: distDir, path: 'index.html' })(c, next)
    })

    return app
}

export async function startWebServer(options: {
    getSyncEngine: () => SyncEngine | null
    getSseManager: () => SSEManager | null
    getVisibilityTracker: () => VisibilityTracker | null
    jwtSecret: Uint8Array
    store: Store
    vapidPublicKey: string
    socketEngine: SocketEngine
    corsOrigins?: string[]
}): Promise<BunServer<WebSocketData>> {
    const isCompiled = isBunCompiled()
    const embeddedAssetMap = isCompiled ? await loadEmbeddedAssetMap() : null
    const app = createWebApp({
        getSyncEngine: options.getSyncEngine,
        getSseManager: options.getSseManager,
        getVisibilityTracker: options.getVisibilityTracker,
        jwtSecret: options.jwtSecret,
        store: options.store,
        vapidPublicKey: options.vapidPublicKey,
        corsOrigins: options.corsOrigins,
        embeddedAssetMap
    })

    const socketHandler = options.socketEngine.handler()

    const server = Bun.serve({
        hostname: configuration.listenHost,
        port: configuration.listenPort,
        idleTimeout: Math.max(30, socketHandler.idleTimeout),
        // 使用应用层上传限制（50MB），而非 Socket.IO 引擎的默认值
        maxRequestBodySize: Math.max(MAX_UPLOAD_BYTES, socketHandler.maxRequestBodySize ?? 0),
        websocket: socketHandler.websocket,
        fetch: (req, server) => {
            const url = new URL(req.url)
            if (url.pathname.startsWith('/socket.io/')) {
                return socketHandler.fetch(req, server)
            }
            return app.fetch(req)
        }
    })

    hubLogger.info(`[Web] Mobi Hub listening on ${configuration.listenHost}:${configuration.listenPort}`)
    hubLogger.info(`[Web] public URL: ${configuration.publicUrl}`)

    return server
}
