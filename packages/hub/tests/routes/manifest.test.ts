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
import { setupTestApp } from '../helpers/setupTestApp'

describe('Manifest API', () => {
    let app: ReturnType<typeof import('../../src/web/server').createWebApp>
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

        const body = await res.json()
        expect(body.name).toMatch(/^Mobi/)
        expect(body.id).toBeTruthy()
        expect(body.start_url).toBe('/?from=pwa')
        expect(body.display).toBe('standalone')
        expect(body.icons).toBeInstanceOf(Array)
        expect(body.icons.length).toBeGreaterThan(0)
    })

    test('GET /manifest.webmanifest Content-Type 为 application/manifest+json', async () => {
        const res = await app.request('/manifest.webmanifest')
        expect(res.headers.get('content-type')).toContain('application/manifest+json')
    })

    test('GET /manifest.webmanifest name 包含 hubName', async () => {
        const res = await app.request('/manifest.webmanifest')
        const body = await res.json()
        expect(body.name).toMatch(/^Mobi - /)
    })
})
