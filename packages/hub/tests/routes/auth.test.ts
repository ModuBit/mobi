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
import { setupTestApp, getAuthToken, testJwtSecret, testWebApiToken } from '../helpers/setupTestApp'

// 从 Set-Cookie header 中解析指定 cookie 的值
function parseCookieValue(setCookie: string | null, name: string): string | undefined {
    if (!setCookie) return undefined
    const prefix = `${name}=`
    const part = setCookie.split(';').map((s) => s.trim()).find((s) => s.startsWith(prefix))
    return part ? decodeURIComponent(part.slice(prefix.length)) : undefined
}

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

    test('POST /api/auth 用 cliApiToken 必须返回 401（双密钥隔离）', async () => {
        // cliApiToken 不再能登录 Web —— 校验源已切到 webApiToken
        const res = await app.request('/api/auth', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ accessToken: 'test-cli-api-token' })
        })

        expect(res.status).toBe(401)
    })

    test('POST /api/auth 有效的 access token 返回 200 和 JWT', async () => {
        const res = await app.request('/api/auth', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ accessToken: testWebApiToken })
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
            body: JSON.stringify({ accessToken: `${testWebApiToken}:my-namespace` })
        })

        expect(res.status).toBe(200)
        const body = await res.json() as { token: string }
        expect(body).toHaveProperty('token')

        const { payload } = await jwtVerify(body.token, testJwtSecret)
        expect(payload).toHaveProperty('ns', 'my-namespace')
    })

    test('POST /api/auth 成功后 Set-Cookie 下发 httpOnly mobi_token', async () => {
        const res = await app.request('/api/auth', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ accessToken: testWebApiToken })
        })

        expect(res.status).toBe(200)
        const setCookie = res.headers.get('set-cookie')
        expect(setCookie).toBeTruthy()

        // 安全属性：HttpOnly + SameSite=Lax + Path=/ + Max-Age=86400
        expect(setCookie).toContain('HttpOnly')
        expect(setCookie).toContain('SameSite=Lax')
        expect(setCookie).toContain('Path=/')
        expect(setCookie).toContain('Max-Age=86400')
        // secure 动态：测试环境 publicUrl 为 http，不应带 Secure（https 部署才启用）
        expect(setCookie).not.toContain('Secure')

        // cookie 值为可验证的 JWT，且与 body.token 一致
        const cookieToken = parseCookieValue(setCookie, 'mobi_token')
        expect(cookieToken).toBeTruthy()
        const body = await res.clone().json() as { token: string }
        expect(cookieToken).toBe(body.token)

        const { payload } = await jwtVerify(cookieToken as string, testJwtSecret)
        expect(payload).toHaveProperty('uid')
        expect(payload).toHaveProperty('ns')
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

    test('GET /api/auth/status 有效 JWT（header）返回 authenticated: true', async () => {
        const token = await getAuthToken(app)

        const statusRes = await app.request('/api/auth/status', {
            headers: { Authorization: `Bearer ${token}` }
        })

        expect(statusRes.status).toBe(200)
        const body = await statusRes.json()
        expect(body).toEqual({ authenticated: true })
    })

    test('GET /api/auth/status 有效 JWT（cookie）返回 authenticated: true', async () => {
        const token = await getAuthToken(app)

        const statusRes = await app.request('/api/auth/status', {
            headers: { Cookie: `mobi_token=${token}` }
        })

        expect(statusRes.status).toBe(200)
        const body = await statusRes.json()
        expect(body).toEqual({ authenticated: true })
    })

    test('GET /api/auth/status cookie 优先于 header', async () => {
        const token = await getAuthToken(app)

        // 同时带 cookie（有效）和 header（无效），应取 cookie → authenticated: true
        const statusRes = await app.request('/api/auth/status', {
            headers: {
                Cookie: `mobi_token=${token}`,
                Authorization: 'Bearer invalid-jwt'
            }
        })

        expect(statusRes.status).toBe(200)
        const body = await statusRes.json()
        expect(body).toEqual({ authenticated: true })
    })

    test('POST /api/auth/logout 带 cookie 清除认证 cookie', async () => {
        const token = await getAuthToken(app)

        const res = await app.request('/api/auth/logout', {
            method: 'POST',
            headers: { Cookie: `mobi_token=${token}` }
        })

        expect(res.status).toBe(200)
        const body = await res.json()
        expect(body).toEqual({ success: true })

        const setCookie = res.headers.get('set-cookie')
        expect(setCookie).toBeTruthy()
        // maxAge=0 立即过期，清空 cookie
        expect(setCookie).toContain('Max-Age=0')
        expect(parseCookieValue(setCookie, 'mobi_token')).toBe('')
    })

    test('POST /api/auth/logout 未认证返回 401', async () => {
        const res = await app.request('/api/auth/logout', { method: 'POST' })

        expect(res.status).toBe(401)
    })

    test('middleware 带 cookie mobi_token 通过认证', async () => {
        const token = await getAuthToken(app)

        // /api/sessions 需认证；带 cookie 应通过（非 401）
        const res = await app.request('/api/sessions', {
            headers: { Cookie: `mobi_token=${token}` }
        })

        expect(res.status).not.toBe(401)
    })

    test('middleware 带 Authorization Bearer 通过认证（过渡兼容）', async () => {
        const token = await getAuthToken(app)

        const res = await app.request('/api/sessions', {
            headers: { Authorization: `Bearer ${token}` }
        })

        expect(res.status).not.toBe(401)
    })

    test('middleware 无认证返回 401', async () => {
        const res = await app.request('/api/sessions')

        expect(res.status).toBe(401)
    })

    test('/api/events query token 特例已去除：仅 query token 返回 401', async () => {
        const token = await getAuthToken(app)

        // 仅靠 ?token=jwt（无 cookie/header）—— 特例去掉后应被拒
        const res = await app.request(`/api/events?token=${token}`)

        expect(res.status).toBe(401)
    })
})
