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
import { jwtVerify } from 'jose'
import { setupTestApp, getAuthToken, testJwtSecret } from '../helpers/setupTestApp'

describe('Auth API', () => {
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

    test('POST /api/auth 无效的 access token 返回 401', async () => {
        const res = await app.request('/api/auth', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ accessToken: 'invalid-token' })
        })

        expect(res.status).toBe(401)
        const body = await res.json()
        expect(body).toHaveProperty('error')
    })

    test('POST /api/auth 有效的 access token 返回 200 和 JWT', async () => {
        const res = await app.request('/api/auth', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ accessToken: 'test-cli-api-token' })
        })

        expect(res.status).toBe(200)
        const body = await res.json() as { token: string; user: { id: number } }
        expect(body).toHaveProperty('token')
        expect(body).toHaveProperty('user')
        expect(body.user).toHaveProperty('id')

        const { payload } = await jwtVerify(body.token, testJwtSecret)
        expect(payload).toHaveProperty('uid')
        expect(payload).toHaveProperty('ns')
    })

    test('POST /api/auth 带命名空间的 access token', async () => {
        const res = await app.request('/api/auth', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ accessToken: 'test-cli-api-token:my-namespace' })
        })

        expect(res.status).toBe(200)
        const body = await res.json() as { token: string }
        expect(body).toHaveProperty('token')

        const { payload } = await jwtVerify(body.token, testJwtSecret)
        expect(payload).toHaveProperty('ns', 'my-namespace')
    })

    test('GET /api/auth/status 无认证返回 authenticated: false', async () => {
        const res = await app.request('/api/auth/status')

        expect(res.status).toBe(200)
        const body = await res.json()
        expect(body).toEqual({ authenticated: false })
    })

    test('GET /api/auth/status 无效 JWT 返回 authenticated: false', async () => {
        const res = await app.request('/api/auth/status', {
            headers: { Authorization: 'Bearer invalid-jwt-token' }
        })

        expect(res.status).toBe(200)
        const body = await res.json()
        expect(body).toEqual({ authenticated: false })
    })

    test('GET /api/auth/status 有效 JWT 返回 authenticated: true', async () => {
        const token = await getAuthToken(app)

        const statusRes = await app.request('/api/auth/status', {
            headers: { Authorization: `Bearer ${token}` }
        })

        expect(statusRes.status).toBe(200)
        const body = await statusRes.json()
        expect(body).toEqual({ authenticated: true })
    })
})
