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

import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { CHROME_BG } from '@mobi/shared'
import { setupTestApp } from '../helpers/setupTestApp'

describe('Manifest API', () => {
    let app: ReturnType<typeof import('../../../src/web/server').createWebApp>
    let cleanup: () => void

    beforeEach(async () => {
        const setup = await setupTestApp()
        app = setup.app
        cleanup = setup.cleanup
    })

    afterEach(() => {
        cleanup()
    })

    test('GET /manifest.webmanifest 返回有效的 Web App Manifest', async () => {
        const res = await app.request('/manifest.webmanifest')
        expect(res.status).toBe(200)

        const body = await res.json() as Record<string, unknown>
        expect(body.name).toMatch(/^Mobi/)
        expect(body.id).toBeTruthy()
        expect(body.start_url).toBe('/?from=pwa')
        expect(body.display).toBe('standalone')
        expect(body.icons).toBeInstanceOf(Array)
        expect((body.icons as unknown[]).length).toBeGreaterThan(0)
    })

    test('GET /manifest.webmanifest Content-Type 为 application/manifest+json', async () => {
        const res = await app.request('/manifest.webmanifest')
        expect(res.headers.get('content-type')).toContain('application/manifest+json')
    })

    test('GET /manifest.webmanifest name 包含 daemonName', async () => {
        const res = await app.request('/manifest.webmanifest')
        const body = await res.json() as Record<string, unknown>
        expect(body.name).toMatch(/^Mobi - /)
    })

    test('GET /manifest.webmanifest 声明 display_override 含 window-controls-overlay', async () => {
        const res = await app.request('/manifest.webmanifest')
        const body = await res.json() as Record<string, unknown>
        const override = body.display_override
        expect(Array.isArray(override)).toBe(true)
        expect((override as unknown[]).includes('window-controls-overlay')).toBe(true)
        // 回退项 standalone 必须存在，保证 WCO 不可用时降级
        expect((override as unknown[]).includes('standalone')).toBe(true)
    })

    test('GET /manifest.webmanifest 的 theme_color / background_color 取 shared 的 chrome 底色', async () => {
        const res = await app.request('/manifest.webmanifest')
        const body = await res.json() as Record<string, unknown>
        // chrome 色必须与页面最外层表面同源（web 调色板的 light 容器档），共引 @mobi/shared
        // 的 CHROME_BG——daemon 够不着 web，此处再写回字面量就会漂（2026-10-13 曾漂成 #fafafc）
        expect(body.theme_color).toBe(CHROME_BG.light)
        expect(body.background_color).toBe(CHROME_BG.light)
    })
})
