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
import { Store } from '../../store'
import { createWebApp } from '../server'
import { createConfiguration, resetConfiguration } from '../../configuration'
import type { SSEManager } from '../../sse/sseManager'
import type { VisibilityTracker } from '../../visibility/visibilityTracker'
import type { SyncEngine } from '../../sync/syncEngine'

// 测试用的 JWT secret
const testJwtSecret = new Uint8Array(32)
crypto.getRandomValues(testJwtSecret)

// 测试用的 CLI API Token
const testCliApiToken = 'test-cli-api-token-12345-for-testing-only'

describe('Auth API', () => {
    let store: Store
    let app: ReturnType<typeof createWebApp>

    beforeEach(async () => {
        store = new Store(':memory:')

        // 设置测试用的 CLI_API_TOKEN 环境变量
        process.env.CLI_API_TOKEN = testCliApiToken

        // 重置并初始化配置
        resetConfiguration()
        await createConfiguration()

        // 创建 web app
        app = createWebApp({
            getSyncEngine: () => null as unknown as SyncEngine,
            getSseManager: () => null as unknown as SSEManager,
            getVisibilityTracker: () => null as unknown as VisibilityTracker,
            jwtSecret: testJwtSecret,
            store,
            vapidPublicKey: 'test-vapid-public-key',
            corsOrigins: ['*'],
            embeddedAssetMap: null
        })
    })

    afterEach(() => {
        store.close()
        delete process.env.CLI_API_TOKEN
        resetConfiguration()
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
            body: JSON.stringify({ accessToken: testCliApiToken })
        })

        expect(res.status).toBe(200)
        const body = await res.json() as { token: string; user: { id: number } }
        expect(body).toHaveProperty('token')
        expect(body).toHaveProperty('user')
        expect(body.user).toHaveProperty('id')

        // 验证 JWT 是有效的
        const { payload } = await jwtVerify(body.token, testJwtSecret)
        expect(payload).toHaveProperty('uid')
        expect(payload).toHaveProperty('ns')
    })

    test('POST /api/auth 带命名空间的 access token', async () => {
        const res = await app.request('/api/auth', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ accessToken: `${testCliApiToken}:my-namespace` })
        })

        expect(res.status).toBe(200)
        const body = await res.json() as { token: string }
        expect(body).toHaveProperty('token')

        // 验证 JWT 中的命名空间
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
        // 首先登录获取有效的 JWT
        const loginRes = await app.request('/api/auth', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ accessToken: testCliApiToken })
        })
        const { token } = await loginRes.json() as { token: string }

        // 使用 JWT 查询状态
        const statusRes = await app.request('/api/auth/status', {
            headers: { Authorization: `Bearer ${token}` }
        })

        expect(statusRes.status).toBe(200)
        const body = await statusRes.json()
        expect(body).toEqual({ authenticated: true })
    })
})
