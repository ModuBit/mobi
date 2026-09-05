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
import { readFileSync } from 'node:fs'
import { setupTestApp, testCliApiToken, testWebApiToken } from '../helpers/setupTestApp'
import { createWebApp } from '../../src/web/server'
import { getConfiguration } from '../../src/configuration'

describe('CLI web-token API（远程部署语义：cli 经 HTTP 读取/轮换 hub 的 webApiToken）', () => {
    let app: ReturnType<typeof createWebApp>
    let cleanup: () => void

    beforeEach(async () => {
        const ctx = await setupTestApp()
        app = ctx.app
        cleanup = ctx.cleanup
    })

    afterEach(() => cleanup())

    const authHeader = { authorization: `Bearer ${testCliApiToken}` }

    test('GET /cli/web-token 返回当前 webApiToken（cliApiToken 鉴权）', async () => {
        const res = await app.request('/cli/web-token', { headers: authHeader })
        expect(res.status).toBe(200)
        const body = await res.json() as { webToken: string; envOverride: boolean }
        expect(body.webToken).toBe(testWebApiToken)
        // setupTestApp 走 env 注入 → envOverride = true
        expect(body.envOverride).toBe(true)
    })

    test('GET 无凭证/错误凭证 401', async () => {
        const missing = await app.request('/cli/web-token')
        expect(missing.status).toBe(401)
        const wrong = await app.request('/cli/web-token', {
            headers: { authorization: `Bearer wrong-token` }
        })
        expect(wrong.status).toBe(401)
    })

    test('POST /cli/web-token 生成新值：落盘 + configuration 热更新 + 旧 token 失效', async () => {
        const res = await app.request('/cli/web-token', { method: 'POST', headers: authHeader })
        expect(res.status).toBe(200)
        const body = await res.json() as { webToken: string }
        expect(body.webToken).not.toBe(testWebApiToken)

        // configuration 单例热更新（立即生效，不等 watcher）
        expect(getConfiguration().webApiToken).toBe(body.webToken)

        // 持久化到 settings.hub.json（重启后仍有效）
        const settings = JSON.parse(readFileSync(getConfiguration().settingsFile, 'utf8')) as { webApiToken?: string }
        expect(settings.webApiToken).toBe(body.webToken)

        // 旧 token 不再通过 Web 鉴权
        const oldAuth = await app.request('/api/auth', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ accessToken: testWebApiToken })
        })
        expect(oldAuth.status).toBe(401)
    })
})
