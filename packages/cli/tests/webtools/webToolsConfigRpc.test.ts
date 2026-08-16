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

import { describe, expect, it, vi, beforeEach } from 'vitest'

vi.mock('@/persistence', () => ({
    readSettings: vi.fn(),
    updateSettings: vi.fn(),
}))

// registry 整模块 mock：webToolsConfig.ts 仅 import createProviderFor，resolve 路由不进本测试图
vi.mock('@/webtools/registry', () => ({
    createProviderFor: vi.fn(),
}))

import type { WebToolsConfigSubmission } from '@mobi/shared'
import { readSettings, updateSettings, type Settings } from '@/persistence'
import { RpcHandlerManager } from '@/api/rpc/RpcHandlerManager'
import type { RpcRequest } from '@/api/rpc/types'
import {
    parseWebToolsConfig,
    validateSelection,
    mergeProviderCredentials,
    registerWebToolsConfigHandler,
} from '@/modules/common/handlers/webToolsConfig'
import { createProviderFor } from '@/webtools/registry'

describe('parseWebToolsConfig（schema 层校验）', () => {
    it('合法配置通过并补默认 timeoutMs', () => {
        const result = parseWebToolsConfig({ searchProviderId: 'tavily', providers: [{ id: 'tavily', enabled: true, credentials: { apiKey: 'k' } }] })
        expect(result.ok).toBe(true)
        if (result.ok) expect(result.config.providers?.[0]?.timeoutMs).toBe(15_000)
    })
    it('空配置合法（清空场景）', () => {
        expect(parseWebToolsConfig({}).ok).toBe(true)
    })
    it('null 凭据合法（提交方向：键被删除）', () => {
        const result = parseWebToolsConfig({ providers: [{ id: 'tavily', enabled: true, credentials: { apiKey: null } }] })
        expect(result.ok).toBe(true)
    })
    it('非法输入（字符串/null）→ ok:false', () => {
        expect(parseWebToolsConfig('nope').ok).toBe(false)
        expect(parseWebToolsConfig(null).ok).toBe(false)
    })
})

describe('validateSelection（选择层校验）', () => {
    it('选中的 provider 必须存在且启用', () => {
        expect(validateSelection({ searchProviderId: 'tavily' })).toContain('不存在或未启用')
        expect(validateSelection({ searchProviderId: 'tavily', providers: [{ id: 'tavily', enabled: false, credentials: { apiKey: 'k' }, timeoutMs: 1000 }] })).toContain('未启用')
    })
    it('选中的 provider 凭据必须齐全', () => {
        expect(validateSelection({ searchProviderId: 'tavily', providers: [{ id: 'tavily', enabled: true, credentials: {}, timeoutMs: 1000 }] })).toContain('缺少凭据')
    })
})

describe('mergeProviderCredentials（在场性三分支）', () => {
    const current = { providers: [{ id: 'tavily', enabled: true, credentials: { apiKey: 'old' }, timeoutMs: 15_000 }] }
    it('键不在场 → 保持旧值（即时保存场景：credentials 传空对象）', () => {
        const merged = mergeProviderCredentials(current, {
            searchProviderId: 'tavily',
            providers: [{ id: 'tavily', enabled: true, credentials: {}, timeoutMs: 15_000 }],
        } as WebToolsConfigSubmission)
        expect(merged.providers?.[0]?.credentials.apiKey).toBe('old')
    })
    it('空串 → 保持旧值（旧客户端全量提交兼容）', () => {
        const merged = mergeProviderCredentials(current, {
            providers: [{ id: 'tavily', enabled: true, credentials: { apiKey: '' }, timeoutMs: 15_000 }],
        } as WebToolsConfigSubmission)
        expect(merged.providers?.[0]?.credentials.apiKey).toBe('old')
    })
    it('非空 → 覆盖', () => {
        const merged = mergeProviderCredentials(current, {
            providers: [{ id: 'tavily', enabled: true, credentials: { apiKey: 'new' }, timeoutMs: 15_000 }],
        } as WebToolsConfigSubmission)
        expect(merged.providers?.[0]?.credentials.apiKey).toBe('new')
    })
    it('null → 清除（键被删除）', () => {
        const merged = mergeProviderCredentials(current, {
            providers: [{ id: 'tavily', enabled: true, credentials: { apiKey: null }, timeoutMs: 15_000 }],
        } as WebToolsConfigSubmission)
        expect(merged.providers?.[0]?.credentials.apiKey).toBeUndefined()
    })
    it('清除被路由引用的凭据 → validateSelection 拒绝（merge 后校验兜底）', () => {
        const merged = mergeProviderCredentials(current, {
            searchProviderId: 'tavily',
            providers: [{ id: 'tavily', enabled: true, credentials: { apiKey: null }, timeoutMs: 15_000 }],
        } as WebToolsConfigSubmission)
        expect(validateSelection(merged)).toContain('缺少凭据')
    })
})

describe('set handler 语义（parse → merge → validateSelection，merge 后校验）', () => {
    it('脱敏页留空保存：旧凭据 merge 后校验通过（沿用旧值）', () => {
        // set handler 的实际顺序：先 merge 旧凭据，再对 merge 结果做选择校验，
        // 避免脱敏回显"留空保持不变"被"缺少凭据"误拒
        const current = { providers: [{ id: 'tavily', enabled: true, credentials: { apiKey: 'old' } }] }
        const incoming = { searchProviderId: 'tavily', providers: [{ id: 'tavily', enabled: true, credentials: { apiKey: '' } }] }

        const parsed = parseWebToolsConfig(incoming)
        expect(parsed.ok).toBe(true)
        if (!parsed.ok) return

        const merged = mergeProviderCredentials(current, parsed.config)
        expect(merged.providers?.[0]?.credentials.apiKey).toBe('old')
        expect(validateSelection(merged)).toBeNull()
    })
    it('merge 后仍缺凭据（新旧都为空）→ 选择校验拒绝', () => {
        const parsed = parseWebToolsConfig({ searchProviderId: 'tavily', providers: [{ id: 'tavily', enabled: true, credentials: { apiKey: '' } }] })
        expect(parsed.ok).toBe(true)
        if (!parsed.ok) return

        const merged = mergeProviderCredentials({}, parsed.config)
        expect(validateSelection(merged)).toContain('缺少凭据')
    })
})

describe('RPC handler 穿透（registerWebToolsConfigHandler + RpcHandlerManager.handleRequest）', () => {
    const SCOPE = 'test'
    // updateSettings 的 mock：对内存快照应用 updater 并返回（模拟锁内读-改-写）
    let persisted: Settings

    beforeEach(() => {
        vi.mocked(readSettings).mockReset()
        vi.mocked(updateSettings).mockReset()
        persisted = {}
        vi.mocked(readSettings).mockImplementation(async () => persisted)
        vi.mocked(updateSettings).mockImplementation(async (updater: (s: Settings) => Settings | Promise<Settings>) => {
            persisted = await updater(persisted)
            return persisted
        })
    })

    function makeManager(): RpcHandlerManager {
        const manager = new RpcHandlerManager({ scopePrefix: SCOPE, logger: () => {} })
        registerWebToolsConfigHandler(manager)
        return manager
    }

    const call = (manager: RpcHandlerManager, method: string, params: unknown) =>
        manager.handleRequest({ method: `${SCOPE}:${method}`, params } satisfies RpcRequest)

    it('set：留空凭据保存成功，落盘沿用旧值且选择校验在 merge 之后（防顺序回归）', async () => {
        persisted = { webTools: { providers: [{ id: 'tavily', enabled: true, credentials: { apiKey: 'old' }, timeoutMs: 15_000 }] } }
        const manager = makeManager()

        const response = await call(manager, 'set-web-tools-config', {
            config: { searchProviderId: 'tavily', providers: [{ id: 'tavily', enabled: true, credentials: {} }] },
        })

        expect(response).toEqual({ success: true })
        // updater 产物：凭据沿用旧值（锁内 merge 语义）
        expect(persisted.webTools?.providers?.[0]?.credentials.apiKey).toBe('old')
        expect(persisted.webTools?.searchProviderId).toBe('tavily')
        expect(updateSettings).toHaveBeenCalledTimes(1)
    })

    it('set：merge 后仍缺凭据 → success:false 且不落盘（updater 抛出）', async () => {
        const manager = makeManager()

        const response = await call(manager, 'set-web-tools-config', {
            config: { searchProviderId: 'tavily', providers: [{ id: 'tavily', enabled: true, credentials: {} }] },
        })

        expect(response).toEqual({ success: false, error: expect.stringContaining('缺少凭据') as string })
        // updater 抛出 → persisted 未被改写
        expect(persisted).toEqual({})
    })

    it('get：凭据脱敏回显（只透露"设没设"）', async () => {
        persisted = {
            webTools: {
                searchProviderId: 'tavily',
                providers: [{ id: 'tavily', enabled: true, credentials: { apiKey: 'secret' }, timeoutMs: 15_000 }],
            },
        }
        const manager = makeManager()

        const response = await call(manager, 'get-web-tools-config', {}) as { config: { providers?: Array<{ credentials: Record<string, { set: boolean; preview?: string }> }> } }

        expect(response.config.providers?.[0]?.credentials).toEqual({ apiKey: { set: true, preview: '******' } })
    })

    it('get：存量配置损坏 → 回退空配置，不抛 RPC error', async () => {
        persisted = { webTools: { providers: 'garbage' } as unknown as Settings['webTools'] }
        const manager = makeManager()

        const response = await call(manager, 'get-web-tools-config', {}) as { config: unknown }

        expect(response).toEqual({ config: {} })
    })

    it('set：存量残留已下线 provider 条目（bocha）→ 保存不被砖化，落盘后条目被剔除', async () => {
        persisted = {
            webTools: {
                searchProviderId: 'tavily',
                providers: [
                    { id: 'tavily', enabled: true, credentials: { apiKey: 'old' }, timeoutMs: 15_000 },
                    { id: 'bocha', enabled: true, credentials: { apiKey: 'b' }, timeoutMs: 15_000 },
                ],
            } as unknown as Settings['webTools'],
        }
        const manager = makeManager()

        // 脱敏页保存：tavily 键不在场（保持旧值）
        const response = await call(manager, 'set-web-tools-config', {
            config: { searchProviderId: 'tavily', providers: [{ id: 'tavily', enabled: true, credentials: {} }] },
        })

        expect(response).toEqual({ success: true })
        // 落盘结果：bocha 条目消失，tavily 凭据沿用旧值
        expect(persisted.webTools?.providers?.map((p) => p.id)).toEqual(['tavily'])
        expect(persisted.webTools?.providers?.[0]?.credentials.apiKey).toBe('old')
    })

    it('get：存量残留已下线 provider 条目（bocha）→ 回显剔除后的合法配置而非空', async () => {
        persisted = {
            webTools: {
                searchProviderId: 'tavily',
                providers: [
                    { id: 'tavily', enabled: true, credentials: { apiKey: 'secret' }, timeoutMs: 8000 },
                    { id: 'bocha', enabled: true, credentials: { apiKey: 'b' }, timeoutMs: 15_000 },
                ],
            } as unknown as Settings['webTools'],
        }
        const manager = makeManager()

        const response = await call(manager, 'get-web-tools-config', {}) as {
            config: { searchProviderId?: string; providers?: Array<{ id: string; credentials: Record<string, { set: boolean; preview?: string }> }> }
        }

        expect(response.config.searchProviderId).toBe('tavily')
        expect(response.config.providers?.map((p) => p.id)).toEqual(['tavily'])
        expect(response.config.providers?.[0]?.credentials).toEqual({ apiKey: { set: true, preview: '******' } })
    })
})

describe('verify-web-tools-provider handler', () => {
    // updateSettings 的 mock：对内存快照应用 updater 并返回（模拟锁内读-改-写）
    let persisted: Settings

    beforeEach(() => {
        vi.mocked(readSettings).mockReset()
        vi.mocked(updateSettings).mockReset()
        vi.mocked(createProviderFor).mockReset()
        persisted = {}
        vi.mocked(readSettings).mockImplementation(async () => persisted)
        vi.mocked(updateSettings).mockImplementation(async (updater: (s: Settings) => Settings | Promise<Settings>) => {
            persisted = await updater(persisted)
            return persisted
        })
    })

    function makeManager(): RpcHandlerManager {
        const manager = new RpcHandlerManager({ scopePrefix: 'test', logger: () => {} })
        registerWebToolsConfigHandler(manager)
        return manager
    }

    const call = (manager: RpcHandlerManager, method: string, params: unknown) =>
        manager.handleRequest({ method: `test:${method}`, params } satisfies RpcRequest)

    it('草稿凭据优先于已存值（保存前验证新 key）', async () => {
        persisted = { webTools: { providers: [{ id: 'tavily', enabled: true, credentials: { apiKey: 'stored' }, timeoutMs: 15_000 }] } }
        const provider = { search: vi.fn().mockResolvedValue([]) }
        vi.mocked(createProviderFor).mockReturnValue(provider as never)
        const manager = makeManager()
        const res = await call(manager, 'verify-web-tools-provider', { providerId: 'tavily', credentials: { apiKey: 'draft' } })
        expect(res).toEqual({ ok: true, latencyMs: expect.any(Number) })
        expect(createProviderFor).toHaveBeenCalledWith('tavily', { apiKey: 'draft', timeoutMs: 15_000 })
    })

    it('无草稿 → 用已存凭据', async () => {
        persisted = { webTools: { providers: [{ id: 'tavily', enabled: true, credentials: { apiKey: 'stored' }, timeoutMs: 15_000 }] } }
        vi.mocked(createProviderFor).mockReturnValue({ search: vi.fn().mockResolvedValue([]) } as never)
        const manager = makeManager()
        await call(manager, 'verify-web-tools-provider', { providerId: 'tavily' })
        expect(createProviderFor).toHaveBeenCalledWith('tavily', { apiKey: 'stored', timeoutMs: 15_000 })
    })

    it('凭据缺失 → ok:false 带原因', async () => {
        persisted = {}
        const manager = makeManager()
        const res = await call(manager, 'verify-web-tools-provider', { providerId: 'tavily' })
        expect(res).toEqual({ ok: false, error: expect.stringContaining('缺少凭据') })
    })

    it('provider 抛错 → ok:false 透传错误文案', async () => {
        persisted = { webTools: { providers: [{ id: 'tavily', enabled: true, credentials: { apiKey: 'bad' }, timeoutMs: 15_000 }] } }
        vi.mocked(createProviderFor).mockReturnValue({
            search: vi.fn().mockRejectedValue(new Error('Invalid API key')),
        } as never)
        const manager = makeManager()
        const res = await call(manager, 'verify-web-tools-provider', { providerId: 'tavily' })
        expect(res).toEqual({ ok: false, error: 'Invalid API key' })
    })

    it('缺少 providerId → ok:false', async () => {
        const manager = makeManager()
        const res = await call(manager, 'verify-web-tools-provider', {})
        expect(res).toEqual({ ok: false, error: expect.stringContaining('providerId') })
    })

    it('未知 providerId → ok:false（RPC 边界无 schema 校验，handler 自行兜底）', async () => {
        const manager = makeManager()
        const res = await call(manager, 'verify-web-tools-provider', { providerId: 'nope' })
        expect(res).toEqual({ ok: false, error: expect.stringContaining('未知') })
        expect(createProviderFor).not.toHaveBeenCalled()
    })
})
