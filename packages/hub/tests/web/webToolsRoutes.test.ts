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

import { describe, expect, it, vi } from 'bun:test'
import { Hono } from 'hono'
import type { WebAppEnv } from '../../src/web/middleware/auth'
import type { SyncEngine } from '../../src/sync/syncEngine'
import { createWebToolsRoutes } from '../../src/web/routes/webTools'

const NAMESPACE = 'ns-test'

/** 测试用 engine mock：getMachine 供 requireMachine 做 namespace 归属校验 */
function createTestEngine(overrides?: {
    getWebToolsConfig?: (id: string) => Promise<unknown>
    setWebToolsConfig?: (id: string, config: unknown) => Promise<unknown>
    verifyWebToolsProvider?: (id: string, providerId: string, credentials?: Record<string, string>) => Promise<unknown>
    /** machine 归属的 namespace；null 表示 machine 不存在 */
    machineNamespace?: string | null
}): SyncEngine {
    // 注意不能用 ??：machineNamespace 显式传 null 表示「machine 不存在」，需与未传区分
    const namespace =
        overrides && 'machineNamespace' in overrides ? overrides.machineNamespace : NAMESPACE
    return {
        getMachine: () =>
            namespace === null ? undefined : { id: 'm1', namespace },
        getWebToolsConfig: overrides?.getWebToolsConfig ?? vi.fn(),
        setWebToolsConfig: overrides?.setWebToolsConfig ?? vi.fn(),
        verifyWebToolsProvider: overrides?.verifyWebToolsProvider ?? vi.fn(),
    } as unknown as SyncEngine
}

function createTestApp(engine: SyncEngine | null) {
    const app = new Hono<WebAppEnv>()
    // 模拟 auth 中间件注入的 namespace 变量
    app.use('*', async (c, next) => {
        c.set('namespace', NAMESPACE)
        await next()
    })
    app.route('/api', createWebToolsRoutes(() => engine))
    return app
}

describe('webTools 路由（纯透传）', () => {
    it('GET 转发 machineId 并返回 config', async () => {
        const getSpy = vi.fn().mockResolvedValue({ config: { searchProviderId: 'tavily' } })
        const app = createTestApp(createTestEngine({ getWebToolsConfig: getSpy }))
        const res = await app.request('/api/machines/m1/web-tools')
        expect(res.status).toBe(200)
        expect(await res.json()).toEqual({ config: { searchProviderId: 'tavily' } })
        expect(getSpy).toHaveBeenCalledWith('m1')
    })

    it('POST 校验 body 后转发 config', async () => {
        const setSpy = vi.fn().mockResolvedValue({ success: true })
        const app = createTestApp(createTestEngine({ setWebToolsConfig: setSpy }))
        const res = await app.request('/api/machines/m1/web-tools', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ config: { searchProviderId: 'bocha' } }),
        })
        expect(res.status).toBe(200)
        expect(await res.json()).toEqual({ success: true })
        expect(setSpy).toHaveBeenCalledWith('m1', { searchProviderId: 'bocha' })
    })

    it('POST 无 config → 400', async () => {
        const setSpy = vi.fn()
        const app = createTestApp(createTestEngine({ setWebToolsConfig: setSpy }))
        const res = await app.request('/api/machines/m1/web-tools', {
            method: 'POST',
            body: '{}',
            headers: { 'content-type': 'application/json' },
        })
        expect(res.status).toBe(400)
        expect(setSpy).not.toHaveBeenCalled()
    })

    it('POST body 非 JSON → 400', async () => {
        const app = createTestApp(createTestEngine())
        const res = await app.request('/api/machines/m1/web-tools', {
            method: 'POST',
            body: 'not-json',
            headers: { 'content-type': 'application/json' },
        })
        expect(res.status).toBe(400)
    })

    it('engine 未就绪 → 503', async () => {
        const app = createTestApp(null)
        const res = await app.request('/api/machines/m1/web-tools')
        expect(res.status).toBe(503)
    })

    it('machine 不存在 → 404', async () => {
        const app = createTestApp(createTestEngine({ machineNamespace: null }))
        const res = await app.request('/api/machines/m1/web-tools')
        expect(res.status).toBe(404)
    })

    it('machine 归属其他 namespace → 403', async () => {
        const app = createTestApp(createTestEngine({ machineNamespace: 'ns-other' }))
        const res = await app.request('/api/machines/m1/web-tools')
        expect(res.status).toBe(403)
    })

    it('GET 下游抛错 → 502 带 error', async () => {
        const app = createTestApp(
            createTestEngine({ getWebToolsConfig: vi.fn().mockRejectedValue(new Error('runner offline')) }),
        )
        const res = await app.request('/api/machines/m1/web-tools')
        expect(res.status).toBe(502)
        expect(((await res.json()) as { error: string }).error).toContain('runner offline')
    })

    it('POST 下游抛错 → 502 带 error', async () => {
        const app = createTestApp(
            createTestEngine({ setWebToolsConfig: vi.fn().mockRejectedValue(new Error('write failed')) }),
        )
        const res = await app.request('/api/machines/m1/web-tools', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ config: {} }),
        })
        expect(res.status).toBe(502)
        expect(((await res.json()) as { error: string }).error).toContain('write failed')
    })

    it('POST /verify 透传 runner 结果（success envelope）', async () => {
        const verifySpy = vi.fn().mockResolvedValue({ success: true, latencyMs: 42 })
        const app = createTestApp(createTestEngine({ verifyWebToolsProvider: verifySpy }))
        const res = await app.request('/api/machines/m1/web-tools/verify', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ providerId: 'tavily', credentials: { apiKey: 'k' } }),
        })
        expect(res.status).toBe(200)
        expect(await res.json()).toEqual({ success: true, latencyMs: 42 })
        // 凭据草稿透传给 runner（不落盘）
        expect(verifySpy).toHaveBeenCalledWith('m1', 'tavily', { apiKey: 'k' })
    })

    it('POST /verify 缺 providerId → 400', async () => {
        const verifySpy = vi.fn()
        const app = createTestApp(createTestEngine({ verifyWebToolsProvider: verifySpy }))
        const res = await app.request('/api/machines/m1/web-tools/verify', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({}),
        })
        expect(res.status).toBe(400)
        expect(verifySpy).not.toHaveBeenCalled()
    })

    it('POST /verify engine 未就绪 → 503', async () => {
        const app = createTestApp(null)
        const res = await app.request('/api/machines/m1/web-tools/verify', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ providerId: 'tavily' }),
        })
        expect(res.status).toBe(503)
    })

    it('POST /verify 下游抛错 → 502 带 error（不含凭据值）', async () => {
        const app = createTestApp(
            createTestEngine({ verifyWebToolsProvider: vi.fn().mockRejectedValue(new Error('runner offline')) }),
        )
        const res = await app.request('/api/machines/m1/web-tools/verify', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ providerId: 'tavily', credentials: { apiKey: 'secret-draft' } }),
        })
        expect(res.status).toBe(502)
        const payload = (await res.json()) as { error: string }
        expect(payload.error).toContain('runner offline')
        // 凭据红线：错误文案不得回显草稿凭据值
        expect(payload.error).not.toContain('secret-draft')
    })

    it('POST /verify 业务失败 → 200 envelope（success: false）', async () => {
        const app = createTestApp(
            createTestEngine({
                verifyWebToolsProvider: vi.fn().mockResolvedValue({ success: false, error: 'invalid api key' }),
            }),
        )
        const res = await app.request('/api/machines/m1/web-tools/verify', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ providerId: 'tavily' }),
        })
        expect(res.status).toBe(200)
        expect(await res.json()).toEqual({ success: false, error: 'invalid api key' })
    })
})
