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

import { describe, test, expect, spyOn } from 'bun:test'
import { createSocketServer, extractTerminalToken } from '../../src/socket/server'
import { testJwtSecret } from '../helpers/setupTestApp'
import { AUTH_COOKIE_NAME } from '../../src/web/middleware/auth'
import { hubLogger } from '../../src/logger'

describe('extractTerminalToken 双源提取', () => {
    test('cookie 优先：带 mobi_token cookie 返回 cookie token', () => {
        const cookieToken = 'from-cookie'
        const authToken = 'from-auth'
        const token = extractTerminalToken({
            headers: { cookie: `${AUTH_COOKIE_NAME}=${cookieToken}` },
            auth: { token: authToken }
        })
        expect(token).toBe(cookieToken)
    })

    test('fallback auth.token：无 cookie 时取 auth.token', () => {
        const authToken = 'from-auth'
        const token = extractTerminalToken({
            headers: {},
            auth: { token: authToken }
        })
        expect(token).toBe(authToken)
    })

    test('双源皆无返回 undefined（驱动 Missing token）', () => {
        const token = extractTerminalToken({ headers: {}, auth: {} })
        expect(token).toBeUndefined()
    })

    test('cookie 非目标 name 不误取', () => {
        const token = extractTerminalToken({
            headers: { cookie: 'other=xyz' },
            auth: {}
        })
        expect(token).toBeUndefined()
    })

    test('auth.token 非 string 不取', () => {
        const token = extractTerminalToken({
            headers: {},
            auth: { token: 123 }
        })
        expect(token).toBeUndefined()
    })
})

describe('CORS 守卫', () => {
    test('corsOrigins 含 * 触发 warn', () => {
        const warnSpy = spyOn(hubLogger, 'warn').mockImplementation(() => undefined)
        createSocketServer({ store: null as never, jwtSecret: testJwtSecret, corsOrigins: ['*'] })
        expect(warnSpy).toHaveBeenCalled()
        expect(String(warnSpy.mock.calls[0][0])).toContain('CORS')
        warnSpy.mockRestore()
    })

    test('corsOrigins 具体域名不 warn', () => {
        const warnSpy = spyOn(hubLogger, 'warn').mockImplementation(() => undefined)
        createSocketServer({ store: null as never, jwtSecret: testJwtSecret, corsOrigins: ['http://localhost:3000'] })
        expect(warnSpy).not.toHaveBeenCalled()
        warnSpy.mockRestore()
    })
})

describe('bun-engine maxHttpBufferSize', () => {
    // 回归：hub 用 @socket.io/bun-engine 作底层 engine，io.bind(外部 engine) 不会把
    // socket.io Server 的 maxHttpBufferSize 透传给 bun-engine；bun-engine 默认仅 1MB。
    // readFileRange 单段 chunk 为 2MB，超过 1MB 会被 bun-engine 判定 "payload too large"
    // 并断开 cli 连接（transport close），导致大文件（图片/视频）预览 body 为空。
    test('engine 的 maxHttpBufferSize 必须大于 readFileRange 的 2MB 单段 chunk', () => {
        const { engine } = createSocketServer({
            store: null as never,
            jwtSecret: testJwtSecret,
            corsOrigins: ['http://localhost:3000']
        })
        const FILE_RANGE_CHUNK = 2 * 1024 * 1024
        // 大于 2MB chunk 才能容纳 cli 回传的整段二进制响应
        expect(engine.opts.maxHttpBufferSize).toBeGreaterThan(FILE_RANGE_CHUNK)
    })
})
