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

import { describe, expect, it, beforeEach, afterEach } from 'bun:test'
import { Hono } from 'hono'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { WebAppEnv } from '../../../src/web/middleware/auth'
import { createMemoryRoutes } from '../../../src/web/routes/memory'

/**
 * memory 路由（agent-memory 票 03）：真相源本进程 settings.daemon.json，
 * deps 注入 settingsFile（临时目录隔离）与 fetch 探针，不碰真实 MOBI_HOME。
 */

let dataDir: string
let settingsFile: string

beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), 'mobi-memory-routes-'))
    settingsFile = join(dataDir, 'settings.daemon.json')
})

afterEach(() => {
    rmSync(dataDir, { recursive: true, force: true })
})

/** 组装 app：注入临时 settingsFile；fetch 探针可逐用例覆盖 */
function makeApp(fetchImpl?: typeof fetch) {
    const app = new Hono<WebAppEnv>()
    app.route('/api', createMemoryRoutes({ getSettingsFile: () => settingsFile, fetch: fetchImpl }))
    return app
}

describe('GET /api/memory（脱敏回显）', () => {
    it('apiToken 只回 apiTokenSet 标记，不回传值；bankNamespace 不暴露', async () => {
        await Bun.write(settingsFile, JSON.stringify({
            memory: { engine: 'hindsight', endpoint: 'https://api.example.com', apiToken: 'secret-token', bankNamespace: 'ns1' },
        }))
        const res = await makeApp().request('/api/memory')
        expect(res.status).toBe(200)
        const body = (await res.json()) as Record<string, unknown> & { settings?: Record<string, unknown>; reason?: string; status?: string }
        expect(body.settings).toEqual({
            engine: 'hindsight',
            endpoint: 'https://api.example.com',
            apiTokenSet: true,
        })
    })

    it('未配置（文件不存在）→ 全默认脱敏形状', async () => {
        const res = await makeApp().request('/api/memory')
        expect(res.status).toBe(200)
        const body = (await res.json()) as Record<string, unknown> & { settings?: Record<string, unknown>; reason?: string; status?: string }
        expect(body.settings).toEqual({ apiTokenSet: false })
    })
})

describe('POST /api/memory（锁内合并写）', () => {
    it('apiToken 在场性：不在场保持旧值、空串清除、非空覆盖', async () => {
        await Bun.write(settingsFile, JSON.stringify({
            memory: { engine: 'hindsight', endpoint: 'https://api.example.com', apiToken: 'old-token' },
        }))
        const app = makeApp()

        // 不在场 = 保持旧值（apiTokenSet 仍 true）
        let res = await app.request('/api/memory', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ endpoint: 'https://api2.example.com' }),
        })
        expect(res.status).toBe(200)
        expect(((await res.json()) as { settings: Record<string, unknown> }).settings).toEqual({
            engine: 'hindsight',
            endpoint: 'https://api2.example.com',
            apiTokenSet: true,
        })

        // 空串 = 清除
        res = await app.request('/api/memory', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ apiToken: '' }),
        })
        expect(((await res.json()) as { settings: Record<string, unknown> }).settings.apiTokenSet).toBe(false)

        // 非空 = 覆盖
        res = await app.request('/api/memory', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ apiToken: 'new-token' }),
        })
        expect(((await res.json()) as { settings: Record<string, unknown> }).settings.apiTokenSet).toBe(true)
    })

    it('非法字段 400 拒绝（未知引擎值），不落盘', async () => {
        await Bun.write(settingsFile, JSON.stringify({ memory: { engine: 'off' } }))
        const res = await makeApp().request('/api/memory', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ engine: 'mem0' }),
        })
        expect(res.status).toBe(400)
        // 原值未动
        const disk = JSON.parse(await Bun.file(settingsFile).text())
        expect(disk.memory.engine).toBe('off')
    })

    it('合并写保留同文件其他字段（不整文件覆盖）', async () => {
        await Bun.write(settingsFile, JSON.stringify({ webApiToken: 'web-secret', memory: { engine: 'off' } }))
        const res = await makeApp().request('/api/memory', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ engine: 'hindsight', endpoint: 'https://api.example.com' }),
        })
        expect(res.status).toBe(200)
        const disk = JSON.parse(await Bun.file(settingsFile).text())
        expect(disk.webApiToken).toBe('web-secret')
        expect(disk.memory.engine).toBe('hindsight')
    })
})

describe('POST /api/memory/check（健康检查）', () => {
    it('401 → unauthorized；5xx → error；其他响应 → ok（可达即通过）', async () => {
        const fakeFetch = (async (_url: unknown, init?: RequestInit) =>
            new Response('x', { status: (init?.headers as Record<string, string>)?.authorization === 'Bearer bad' ? 401 : 404 })) as typeof fetch
        const app = makeApp(fakeFetch)

        // 草稿 token 触发 401
        let res = await app.request('/api/memory/check', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ endpoint: 'https://api.example.com', apiToken: 'bad' }),
        })
        expect(await res.json()).toEqual({ status: 'unauthorized' })

        // 无 token → 404（base URL 常态）判 ok
        res = await app.request('/api/memory/check', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ endpoint: 'https://api.example.com' }),
        })
        expect(((await res.json()) as { status: string }).status).toBe('ok')
    })

    it('草稿 token 不在场时用已存值兜底', async () => {
        await Bun.write(settingsFile, JSON.stringify({
            memory: { engine: 'hindsight', endpoint: 'https://api.example.com', apiToken: 'stored-token' },
        }))
        const fakeFetch = (async (_url: unknown, init?: RequestInit) =>
            new Response('x', { status: init?.headers ? 200 : 401 })) as typeof fetch

        // 已存 stored-token → header 携带 → 200 ok
        const res = await makeApp(fakeFetch).request('/api/memory/check', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ endpoint: 'https://api.example.com' }),
        })
        expect(((await res.json()) as { status: string }).status).toBe('ok')
    })

    it('网络异常 → unreachable', async () => {
        const fakeFetch = (async () => { throw new Error('ECONNREFUSED') }) as unknown as typeof fetch
        const res = await makeApp(fakeFetch).request('/api/memory/check', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ endpoint: 'https://api.example.com' }),
        })
        const body = (await res.json()) as { status: string; reason: string }
        expect(body.status).toBe('unreachable')
        expect(body.reason).toContain('ECONNREFUSED')
    })

    it('缺 endpoint 400', async () => {
        const res = await makeApp().request('/api/memory/check', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({}),
        })
        expect(res.status).toBe(400)
    })
})
