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

import { SignJWT } from 'jose'
import { configuration } from '../../configuration'

// 认证 cookie 名 —— httpOnly 防 XSS 窃取，由浏览器自动随同源请求（含 <img>/<video>/SSE）携带。
// 单一真源：middleware 与 routes 都从此 import，消除两处重复。
export const AUTH_COOKIE_NAME = 'mobi_token'

// 会话 JWT / cookie 寿命（秒）—— cookie maxAge 与 JWT exp 共用，单一真相。
export const SESSION_TTL_SECONDS = 86400 // 1d

/**
 * 签发会话 JWT：HS256 + iat + exp(SESSION_TTL_SECONDS)。
 * POST /api/auth 初始签发与 auth middleware 滑动续期共用，确保 TTL 单一来源。
 */
export async function signSessionJwt(
    jwtSecret: Uint8Array,
    uid: number,
    namespace: string,
): Promise<string> {
    return new SignJWT({ uid, ns: namespace })
        .setProtectedHeader({ alg: 'HS256' })
        .setIssuedAt()
        .setExpirationTime(`${SESSION_TTL_SECONDS}s`)
        .sign(jwtSecret)
}

/**
 * cookie 安全属性工厂：secure 动态求值（避免模块加载时读 configuration.publicUrl）。
 * Lax 防 CSRF POST，Path=/ 覆盖所有 media/SSE 端点。
 * secure 仅 https 部署时启用（http localhost 部署下 false，否则浏览器丢弃 cookie）。
 */
export function getAuthCookieOptions(maxAge: number = SESSION_TTL_SECONDS) {
    const isHttps = configuration.publicUrl.startsWith('https')
    return {
        httpOnly: true,
        sameSite: 'Lax' as const,
        path: '/',
        maxAge,
        secure: isHttps,
    }
}
