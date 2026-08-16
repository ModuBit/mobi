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

import { readSettings, updateSettings, type Settings } from '@/persistence'
import { RpcHandlerManager } from '@/api/rpc/RpcHandlerManager'
import type { RpcRequest } from '@/api/rpc/types'
import {
    validateWebToolsConfig,
    parseWebToolsConfig,
    validateSelection,
    mergeProviderCredentials,
    registerWebToolsConfigHandler,
} from '@/modules/common/handlers/webToolsConfig'

describe('validateWebToolsConfig（写入校验）', () => {
    it('选中的 provider 必须存在且启用', () => {
        expect(validateWebToolsConfig({ searchProviderId: 'tavily' }).ok).toBe(false)
        expect(validateWebToolsConfig({ searchProviderId: 'tavily', providers: [{ id: 'tavily', enabled: false, credentials: { apiKey: 'k' } }] }).ok).toBe(false)
    })
    it('选中的 provider 凭据必须齐全', () => {
        expect(validateWebToolsConfig({ searchProviderId: 'tavily', providers: [{ id: 'tavily', enabled: true, credentials: {} }] }).ok).toBe(false)
    })
    it('合法配置通过并补默认 timeoutMs', () => {
        const result = validateWebToolsConfig({ searchProviderId: 'tavily', providers: [{ id: 'tavily', enabled: true, credentials: { apiKey: 'k' } }] })
        expect(result.ok).toBe(true)
        if (result.ok) expect(result.config.providers?.[0]?.timeoutMs).toBe(15_000)
    })
    it('空配置合法（清空场景）', () => {
        expect(validateWebToolsConfig({}).ok).toBe(true)
    })
    it('非法输入（字符串/null）→ ok:false', () => {
        expect(validateWebToolsConfig('nope').ok).toBe(false)
        expect(validateWebToolsConfig(null).ok).toBe(false)
    })
})

describe('mergeProviderCredentials（凭据 merge——空值=保持不变）', () => {
    it('空字符串凭据沿用旧值', () => {
        const merged = mergeProviderCredentials(
            { providers: [{ id: 'tavily', enabled: true, credentials: { apiKey: 'old' } }] },
            { providers: [{ id: 'tavily', enabled: true, credentials: { apiKey: '' } }] },
        )
        expect(merged.providers?.[0]?.credentials.apiKey).toBe('old')
    })
    it('新值覆盖旧值', () => {
        const merged = mergeProviderCredentials(
            { providers: [{ id: 'tavily', enabled: true, credentials: { apiKey: 'old' } }] },
            { providers: [{ id: 'tavily', enabled: true, credentials: { apiKey: 'new' } }] },
        )
        expect(merged.providers?.[0]?.credentials.apiKey).toBe('new')
    })
    it('新增条目（旧配置无 provider 段）直接采用新值', () => {
        const merged = mergeProviderCredentials(
            {},
            { providers: [{ id: 'tavily', enabled: true, credentials: { apiKey: 'fresh' } }] },
        )
        expect(merged.providers?.[0]?.credentials.apiKey).toBe('fresh')
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
            config: { searchProviderId: 'tavily', providers: [{ id: 'tavily', enabled: true, credentials: { apiKey: '' } }] },
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
            config: { searchProviderId: 'tavily', providers: [{ id: 'tavily', enabled: true, credentials: { apiKey: '' } }] },
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

        const response = await call(manager, 'get-web-tools-config', {}) as { config: { providers?: Array<{ credentials: Record<string, { set: boolean }> }> } }

        expect(response.config.providers?.[0]?.credentials).toEqual({ apiKey: { set: true } })
    })

    it('get：存量配置损坏 → 回退空配置，不抛 RPC error', async () => {
        persisted = { webTools: { providers: 'garbage' } as unknown as Settings['webTools'] }
        const manager = makeManager()

        const response = await call(manager, 'get-web-tools-config', {}) as { config: unknown }

        expect(response).toEqual({ config: {} })
    })
})
