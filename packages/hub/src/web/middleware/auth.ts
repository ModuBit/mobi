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

import type { MiddlewareHandler } from 'hono'
import { z } from 'zod'
import { jwtVerify } from 'jose'
import { getCookie, setCookie } from 'hono/cookie'
import { AUTH_COOKIE_NAME, signSessionJwt, getAuthCookieOptions, SESSION_TTL_SECONDS } from '../auth/session'

export type WebAppEnv = {
    Variables: {
        userId: number
        namespace: string
    }
}

const jwtPayloadSchema = z.object({
    uid: z.number(),
    ns: z.string()
})

// 滑动续期阈值：剩余寿命 < 半寿命才重签发（1d 寿命 → 剩余 <12h 触发）。
// 活跃用户每天最多续 1~2 次，cookie 永不过期；频繁请求不会每次都 setCookie。
const RENEW_THRESHOLD_MS = (SESSION_TTL_SECONDS / 2) * 1000

export function createAuthMiddleware(jwtSecret: Uint8Array): MiddlewareHandler<WebAppEnv> {
    return async (c, next) => {
        const path = c.req.path
        if (path === '/api/auth' || path === '/api/bind') {
            await next()
            return
        }

        // 双源取 token：优先 cookie（新链路，media/SSE 自动携带），回退 Authorization header（过渡兼容 cli + 旧 web）
        // /api/events query token 特例已去除 —— SSE 改 withCredentials 后走 cookie 链路
        const tokenFromCookie = getCookie(c, AUTH_COOKIE_NAME)
        const authorization = c.req.header('authorization')
        const tokenFromHeader = authorization?.startsWith('Bearer ') ? authorization.slice('Bearer '.length) : undefined
        const token = tokenFromCookie ?? tokenFromHeader

        if (!token) {
            return c.json({ error: 'Missing authorization token' }, 401)
        }

        try {
            const verified = await jwtVerify(token, jwtSecret, { algorithms: ['HS256'] })
            const parsed = jwtPayloadSchema.safeParse(verified.payload)
            if (!parsed.success) {
                return c.json({ error: 'Invalid token payload' }, 401)
            }

            c.set('userId', parsed.data.uid)
            c.set('namespace', parsed.data.ns)

            // 滑动续期：剩余寿命 < 阈值则重签发 JWT + Set-Cookie。
            // 所有 /api/* 请求（含 SSE 重连）都经此中间件，活跃用户自然续期；
            // 闲置达 SESSION_TTL_SECONDS 不发请求 → 不续 → 自然过期（符合"闲置登出"语义）。
            // Set-Cookie 随响应头下发（SSE 流式响应的初始 200 头也带），浏览器自动更新。
            const exp = verified.payload.exp // 秒（unix）
            if (exp && exp * 1000 - Date.now() < RENEW_THRESHOLD_MS) {
                const freshToken = await signSessionJwt(jwtSecret, parsed.data.uid, parsed.data.ns)
                setCookie(c, AUTH_COOKIE_NAME, freshToken, getAuthCookieOptions())
            }

            await next()
            return
        } catch {
            return c.json({ error: 'Invalid token' }, 401)
        }
    }
}
