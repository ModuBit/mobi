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
 * is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { describe, expect, it, beforeEach, afterEach } from 'bun:test'
import { Hono } from 'hono'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { WebAppEnv } from '../../../src/web/middleware/auth'
import { createTelemetryRoutes, mergeTelemetrySubmission } from '../../../src/web/routes/telemetry'

/**
 * telemetry 路由（OpenTelemetry 设置票）：真相源本进程 settings.daemon.json，
 * deps 注入 settingsFile（临时目录隔离），不碰真实 MOBI_HOME。
 * 锁定：headers 脱敏红线（只回 headersSet）、在场性合并协议、编码单源。
 */

let dataDir: string
let settingsFile: string

beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), 'mobi-telemetry-routes-'))
    settingsFile = join(dataDir, 'settings.daemon.json')
})

afterEach(() => {
    rmSync(dataDir, { recursive: true, force: true })
})

function makeApp() {
    const app = new Hono<WebAppEnv>()
    app.route('/api', createTelemetryRoutes({ getSettingsFile: () => settingsFile }))
    return app
}

describe('GET /api/telemetry（脱敏回显）', () => {
    it('headers 只回 headersSet 标记，不回传值', async () => {
        await Bun.write(settingsFile, JSON.stringify({
            telemetry: {
                enabled: true,
                endpoint: 'https://otlp.example.com',
                headers: { 'DD-API-KEY': 'secret' },
            },
        }))
        const res = await makeApp().request('/api/telemetry')
        expect(res.status).toBe(200)
        const body = (await res.json()) as { settings?: Record<string, unknown> }
        expect(body.settings).toEqual({ enabled: true, endpoint: 'https://otlp.example.com', headersSet: true })
    })

    it('未配置（文件不存在）→ 全默认脱敏形状', async () => {
        const res = await makeApp().request('/api/telemetry')
        expect(res.status).toBe(200)
        const body = (await res.json()) as { settings?: Record<string, unknown> }
        expect(body.settings).toEqual({ headersSet: false })
    })
})

describe('POST /api/telemetry（锁内合并写）', () => {
    it('写入 enabled/endpoint/headers；回读脱敏', async () => {
        const res = await makeApp().request('/api/telemetry', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ enabled: true, endpoint: 'http://127.0.0.1:4318', headers: { 'x-honeycomb-team': 'hk' } }),
        })
        expect(res.status).toBe(200)
        const reread = await makeApp().request('/api/telemetry')
        const body = (await reread.json()) as { settings?: Record<string, unknown> }
        expect(body.settings).toEqual({ enabled: true, endpoint: 'http://127.0.0.1:4318', headersSet: true })
    })

    it('headers 不在场 = 保持旧值；空对象 = 显式清除', async () => {
        await Bun.write(settingsFile, JSON.stringify({
            telemetry: { enabled: true, endpoint: 'http://e', headers: { 'DD-API-KEY': 'old' } },
        }))
        // 不带 headers：旧值保持（headersSet 仍 true）
        await makeApp().request('/api/telemetry', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ endpoint: 'http://e2' }),
        })
        let body = (await (await makeApp().request('/api/telemetry')).json()) as { settings?: Record<string, unknown> }
        expect(body.settings?.headersSet).toBe(true)

        // 空对象：显式清除
        await makeApp().request('/api/telemetry', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ headers: {} }),
        })
        body = (await (await makeApp().request('/api/telemetry')).json()) as { settings?: Record<string, unknown> }
        expect(body.settings?.headersSet).toBe(false)
    })

    it('非法 body → 400 带字段路径', async () => {
        const res = await makeApp().request('/api/telemetry', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ enabled: 'yes' }),
        })
        expect(res.status).toBe(400)
        const body = (await res.json()) as { error?: string }
        expect(body.error).toContain('enabled')
    })
})

describe('mergeTelemetrySubmission（纯函数）与 encodeOtelHeaders', () => {
    it('endpoint trim 空串清除；headers 值 trim、全空值键剔除', () => {
        expect(mergeTelemetrySubmission({ enabled: true }, { endpoint: '  ' })).toEqual({ enabled: true })
        expect(mergeTelemetrySubmission(undefined, { headers: { ' K ': ' v ', bad: '  ' } })).toEqual({ headers: { K: 'v' } })
    })
})
