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

import { describe, test, expect, beforeAll, afterAll } from 'bun:test'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { staticCacheControl } from '../../src/web/utils/staticCacheControl'
import { setupTestApp } from '../helpers/setupTestApp'

/**
 * 静态资源 Cache-Control 策略测试。
 *
 * 锁定两件事：
 * 1. 纯函数 staticCacheControl 对各类路径/Content-Type 的分流正确；
 * 2. 集成层：真实 HTTP 响应里确实带上了分层 Cache-Control（中间件在 next() 后注入）。
 *
 * 集成测试用一个临时 fixture dist 目录（index.html + assets + fonts + brand），
 * 经 setupTestApp 的 distDirOverride 注入，避免依赖真实 web/dist 构建产物。
 */
describe('staticCacheControl（纯函数策略）', () => {
    test('/assets/ 哈希产物 → 永久缓存 + immutable', () => {
        expect(staticCacheControl('/assets/index-a1b2c3.js')).toBe(
            'public, max-age=31536000, immutable',
        )
        expect(staticCacheControl('/assets/index-DIHOJHo6.css')).toBe(
            'public, max-age=31536000, immutable',
        )
    })

    test('/fonts/ 字体 → 30 天', () => {
        expect(staticCacheControl('/fonts/alibaba-puhuiti/AlibabaPuHuiTi-3-55-Regular.woff2')).toBe(
            'public, max-age=2592000',
        )
    })

    test('/brand/ 品牌图标 → 1 天', () => {
        expect(staticCacheControl('/brand/icon.png')).toBe('public, max-age=86400')
    })

    test('HTML 响应（入口 / SPA 深链回退）→ no-cache', () => {
        // 显式入口
        expect(staticCacheControl('/index.html', 'text/html; charset=utf-8')).toBe('no-cache')
        expect(staticCacheControl('/', 'text/html')).toBe('no-cache')
        // SPA 深链回退到 index.html，路径非静态前缀但 Content-Type 是 HTML
        expect(staticCacheControl('/sessions/abc-123', 'text/html; charset=utf-8')).toBe('no-cache')
    })

    test('/sw.js 与 /manifest.webmanifest → no-cache（保证可更新）', () => {
        expect(staticCacheControl('/sw.js', 'application/javascript')).toBe('no-cache')
        expect(staticCacheControl('/manifest.webmanifest', 'application/manifest+json')).toBe(
            'no-cache',
        )
    })

    test('/api/* 与未知 JSON 响应 → null（不动 API 缓存）', () => {
        expect(staticCacheControl('/api/auth/status', 'application/json')).toBeNull()
        expect(staticCacheControl('/health', 'application/json')).toBeNull()
    })

    test('/api/ 下返回 HTML 的端点（如 serve-file 预览）→ 仍为 null（API 整体不动）', () => {
        expect(
            staticCacheControl('/api/sessions/abc/serve-file/x.html', 'text/html; charset=utf-8'),
        ).toBeNull()
        expect(staticCacheControl('/cli/sessions', 'application/json')).toBeNull()
    })
})

describe('Hub 静态资源 Cache-Control（集成）', () => {
    let app: ReturnType<typeof import('../../src/web/server').createWebApp>
    let cleanup: () => void
    let tmpDist: string

    beforeAll(async () => {
        // 构造临时 fixture dist：index.html + 一个 asset + 一个字体 + 一个 brand 图标
        tmpDist = await mkdtemp(join(tmpdir(), 'mobi-cache-test-'))
        await mkdir(join(tmpDist, 'assets'), { recursive: true })
        await mkdir(join(tmpDist, 'fonts'), { recursive: true })
        await mkdir(join(tmpDist, 'brand'), { recursive: true })
        await writeFile(join(tmpDist, 'index.html'), '<!DOCTYPE html><html><body><div id="root"></div></body></html>')
        await writeFile(join(tmpDist, 'assets', 'index-test.js'), 'console.log("a");')
        await writeFile(join(tmpDist, 'fonts', 'f.woff2'), 'font-bytes')
        await writeFile(join(tmpDist, 'brand', 'icon.png'), 'png-bytes')

        const setup = await setupTestApp(null, { distDirOverride: tmpDist })
        app = setup.app
        cleanup = setup.cleanup
    })

    afterAll(async () => {
        cleanup()
        await rm(tmpDist, { recursive: true, force: true })
    })

    test('GET /assets/* → public, max-age=31536000, immutable', async () => {
        const res = await app.request('/assets/index-test.js')
        expect(res.status).toBe(200)
        expect(res.headers.get('cache-control')).toBe(
            'public, max-age=31536000, immutable',
        )
    })

    test('GET /fonts/* → public, max-age=2592000', async () => {
        const res = await app.request('/fonts/f.woff2')
        expect(res.status).toBe(200)
        expect(res.headers.get('cache-control')).toBe('public, max-age=2592000')
    })

    test('GET /brand/* → public, max-age=86400', async () => {
        const res = await app.request('/brand/icon.png')
        expect(res.status).toBe(200)
        expect(res.headers.get('cache-control')).toBe('public, max-age=86400')
    })

    test('GET / → no-cache（HTML 入口必须每次校验）', async () => {
        const res = await app.request('/')
        expect(res.status).toBe(200)
        expect(res.headers.get('cache-control')).toBe('no-cache')
    })

    test('GET /index.html → no-cache', async () => {
        const res = await app.request('/index.html')
        expect(res.status).toBe(200)
        expect(res.headers.get('cache-control')).toBe('no-cache')
    })

    test('GET /api/health → 不注入 cache-control（保持 API 原状）', async () => {
        const res = await app.request('/health')
        expect(res.status).toBe(200)
        // API 响应策略为 null，不应被中间件注入 cache-control
        expect(res.headers.get('cache-control')).toBeNull()
    })
})
