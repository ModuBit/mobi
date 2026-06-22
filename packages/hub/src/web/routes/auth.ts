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

import { Hono } from 'hono'
import type { Context } from 'hono'
import { setCookie, getCookie } from 'hono/cookie'
import { SignJWT, jwtVerify } from 'jose'
import { z } from 'zod'
import { configuration } from '../../configuration'
import { constantTimeEquals } from '../../utils/crypto'
import { parseAccessToken } from '../../utils/accessToken'
import { getOrCreateOwnerId } from '../../config/ownerId'
import { AUTH_COOKIE_NAME, type WebAppEnv } from '../middleware/auth'
// cookie 生命周期，与 JWT 过期（1d）对齐
const AUTH_COOKIE_MAX_AGE = 86400
/**
 * cookie 安全属性工厂：secure 动态求值（避免模块加载时读 configuration.publicUrl）。
 * Lax 防 CSRF POST，Path=/ 覆盖所有 media/SSE 端点。
 * secure 仅 https 部署时启用（http localhost 部署下 false，否则浏览器丢弃 cookie）。
 */
export function getAuthCookieOptions(maxAge: number = AUTH_COOKIE_MAX_AGE) {
    const isHttps = configuration.publicUrl.startsWith('https')
    return {
        httpOnly: true,
        sameSite: 'Lax' as const,
        path: '/',
        maxAge,
        secure: isHttps,
    }
}

// 从请求中提取 JWT：优先 cookie（新链路），回退 Authorization header（过渡兼容 cli + 旧 web）
function extractToken(c: Context<WebAppEnv>): string | undefined {
    const tokenFromCookie = getCookie(c, AUTH_COOKIE_NAME)
    if (tokenFromCookie) {
        return tokenFromCookie
    }
    const authorization = c.req.header('authorization')
    return authorization?.startsWith('Bearer ') ? authorization.slice('Bearer '.length) : undefined
}

const accessTokenAuthSchema = z.object({
    accessToken: z.string()
})

const jwtPayloadSchema = z.object({
    uid: z.number(),
    ns: z.string()
})

export function createAuthRoutes(jwtSecret: Uint8Array): Hono<WebAppEnv> {
    const app = new Hono<WebAppEnv>()

    // 查询当前认证状态（不需要认证；双源读 cookie + header 过渡兼容）
    app.get('/auth/status', async (c) => {
        const token = extractToken(c)

        if (!token) {
            return c.json({ authenticated: false })
        }

        try {
            const verified = await jwtVerify(token, jwtSecret, { algorithms: ['HS256'] })
            const parsed = jwtPayloadSchema.safeParse(verified.payload)
            if (!parsed.success) {
                return c.json({ authenticated: false })
            }
            return c.json({ authenticated: true })
        } catch {
            return c.json({ authenticated: false })
        }
    })

    app.post('/auth', async (c) => {
        const json = await c.req.json().catch(() => null)
        const parsed = accessTokenAuthSchema.safeParse(json)
        if (!parsed.success) {
            return c.json({ error: 'Invalid body' }, 400)
        }

        // Access Token 认证（CLI_API_TOKEN）
        const parsedToken = parseAccessToken(parsed.data.accessToken)
        if (!parsedToken || !constantTimeEquals(parsedToken.baseToken, configuration.cliApiToken)) {
            return c.json({ error: 'Invalid access token' }, 401)
        }

        const userId = await getOrCreateOwnerId()
        const namespace = parsedToken.namespace

        const token = await new SignJWT({ uid: userId, ns: namespace })
            .setProtectedHeader({ alg: 'HS256' })
            .setIssuedAt()
            .setExpirationTime('1d')
            .sign(jwtSecret)

        // Set-Cookie：httpOnly cookie 让浏览器自动随同源请求携带（media/SSE 直连）
        setCookie(c, AUTH_COOKIE_NAME, token, getAuthCookieOptions())

        return c.json({
            token,
            user: {
                id: userId,
                firstName: 'Web User'
            }
        })
    })

    // 登出：清除认证 cookie（maxAge=0 立即过期）
    // 该路由在 auth middleware 之前注册（createAuthRoutes 整体先于 middleware 挂载），
    // 故此处自行做轻量认证校验：无 cookie/header token 则 401，避免未认证调用清 cookie
    app.post('/auth/logout', (c) => {
        const token = extractToken(c)
        if (!token) {
            return c.json({ error: 'Missing authorization token' }, 401)
        }

        setCookie(c, AUTH_COOKIE_NAME, '', getAuthCookieOptions(0))
        return c.json({ success: true })
    })

    return app
}
