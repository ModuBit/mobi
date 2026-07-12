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
import { setupTestApp, testCliApiToken, testWebApiToken } from '../helpers/setupTestApp'

describe('/cli 鉴权反向隔离', () => {
    let app: ReturnType<typeof import('../../src/web/server').createWebApp>
    let cleanup: () => void

    beforeEach(async () => {
        const setup = await setupTestApp()
        app = setup.app
        cleanup = setup.cleanup
    })

    afterEach(() => cleanup())

    test('cliApiToken 可访问 /cli/sessions（基线）', async () => {
        const res = await app.request('/cli/sessions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${testCliApiToken}`
            },
            body: JSON.stringify({ tag: 't', metadata: {} })
        })
        // 503（Not ready，无 syncEngine）也算鉴权通过 —— 关键是不是 401
        expect(res.status).not.toBe(401)
    })

    test('webApiToken 不能访问 /cli（反向隔离）', async () => {
        const res = await app.request('/cli/sessions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${testWebApiToken}`
            },
            body: JSON.stringify({ tag: 't', metadata: {} })
        })
        expect(res.status).toBe(401)
    })

    test('无 Authorization 访问 /cli 返回 401', async () => {
        const res = await app.request('/cli/sessions', { method: 'POST' })
        expect(res.status).toBe(401)
    })
})
