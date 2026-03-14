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
import { SignJWT, jwtVerify } from 'jose'
import { z } from 'zod'
import { configuration } from '../../configuration'
import { constantTimeEquals } from '../../utils/crypto'
import { parseAccessToken } from '../../utils/accessToken'
import { getOrCreateOwnerId } from '../../config/ownerId'
import type { WebAppEnv } from '../middleware/auth'

const accessTokenAuthSchema = z.object({
    accessToken: z.string()
})

const jwtPayloadSchema = z.object({
    uid: z.number(),
    ns: z.string()
})

export function createAuthRoutes(jwtSecret: Uint8Array): Hono<WebAppEnv> {
    const app = new Hono<WebAppEnv>()

    // 查询当前认证状态（不需要认证）
    app.get('/auth/status', async (c) => {
        const authorization = c.req.header('authorization')
        const token = authorization?.startsWith('Bearer ') ? authorization.slice('Bearer '.length) : undefined

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
            .setExpirationTime('15m')
            .sign(jwtSecret)

        return c.json({
            token,
            user: {
                id: userId,
                firstName: 'Web User'
            }
        })
    })

    return app
}
