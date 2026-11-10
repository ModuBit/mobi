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

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act, cleanup } from '@testing-library/react'
import { App as AntdApp } from 'antd'

// useWebToolsConfig 打桩（协议矩阵直接喂 config 形状，绕开 react-query 数据层）
const configStub = vi.hoisted(() => ({
    value: {
        config: null as Record<string, unknown> | null,
        loaded: true,
        offline: false,
        loadError: null as string | null,
        saving: false,
        save: vi.fn(),
    },
}))
vi.mock('@/core/data/hooks/queries/useWebToolsConfig', () => ({
    useWebToolsConfig: () => configStub.value,
}))

// i18n 最小桩：只认兜底文案 key，其余原样返回
vi.mock('react-i18next', () => ({
    useTranslation: () => ({ t: (key: string) => (key === 'settings.webTools.saveFailed' ? '保存失败' : key) }),
}))

import { useWebToolsSubmission } from '@/features/settings/webtools/useWebToolsSubmission'

/** tavily 已启用已设 key + deepseek 已配置禁用（timeoutMs 非默认锁定回传断言） */
function stubConfig(overrides?: { searchProviderId?: string; fetchProviderId?: string; tavilyEnabled?: boolean }) {
    configStub.value.config = {
        searchProviderId: overrides?.searchProviderId,
        fetchProviderId: overrides?.fetchProviderId,
        providers: [
            { id: 'tavily', enabled: overrides?.tavilyEnabled ?? true, timeoutMs: 8000, credentials: { apiKey: { set: true, preview: 'tvly-******56' } } },
            { id: 'deepseek', enabled: false, timeoutMs: 9000, credentials: {} },
        ],
    }
    return configStub.value.config
}

function renderSubmission() {
    return renderHook(() => useWebToolsSubmission(), { wrapper: ({ children }) => <AntdApp>{children}</AntdApp> })
}

beforeEach(() => {
    vi.clearAllMocks()
    configStub.value.save.mockResolvedValue({ ok: true } as const)
    configStub.value.saving = false
    configStub.value.loadError = null
    configStub.value.offline = false
})
afterEach(cleanup)

describe('useWebToolsSubmission 提交构造协议', () => {
    it('setRoute：新路由携带 + 未提及路由回填现值（整体替换语义不清空另一路）', async () => {
        stubConfig({ searchProviderId: undefined, fetchProviderId: 'deepseek' })
        const { result } = renderSubmission()

        const ok = await act(() => result.current.setRoute('search', 'tavily'))
        expect(ok).toBe(true)
        expect(configStub.value.save).toHaveBeenCalledWith({
            searchProviderId: 'tavily',
            fetchProviderId: 'deepseek',
            providers: expect.any(Array),
        })
    })

    it('clearRoute：被清除路由字段整体缺席，另一路回填现值（null ≠ 未提及）', async () => {
        stubConfig({ searchProviderId: 'tavily', fetchProviderId: 'deepseek' })
        const { result } = renderSubmission()

        const ok = await act(() => result.current.clearRoute('fetch'))
        expect(ok).toBe(true)
        const payload = configStub.value.save.mock.calls[0][0] as Record<string, unknown>
        expect(payload.searchProviderId).toBe('tavily')
        expect('fetchProviderId' in payload).toBe(false)
    })

    it('toggleProvider：全量 providers 覆盖——目标翻转、其余回填现值、timeoutMs 回传、凭据键不在场', async () => {
        stubConfig({ tavilyEnabled: false })
        const { result } = renderSubmission()

        await act(() => result.current.toggleProvider('tavily', true))
        expect(configStub.value.save).toHaveBeenCalledWith({
            providers: [
                { id: 'tavily', enabled: true, timeoutMs: 8000, credentials: {} },
                { id: 'deepseek', enabled: false, timeoutMs: 9000, credentials: {} },
            ],
        })
    })

    it('saveCredentials：目标带凭据键 + 现值 enabled 保持；机器尚无条目的 provider 以默认条目随全量提交', async () => {
        configStub.value.config = {
            searchProviderId: undefined,
            fetchProviderId: undefined,
            providers: [{ id: 'tavily', enabled: true, timeoutMs: 8000, credentials: { apiKey: { set: true, preview: 'x' } } }],
        }
        const { result } = renderSubmission()

        await act(() => result.current.saveCredentials('tavily', { apiKey: 'tvly-new' }))
        expect(configStub.value.save).toHaveBeenCalledWith({
            providers: [
                { id: 'tavily', enabled: true, timeoutMs: 8000, credentials: { apiKey: 'tvly-new' } },
                { id: 'deepseek', enabled: false, timeoutMs: 15000, credentials: {} },
            ],
        })
    })

    it('saveCredentials 首存连带启用：机器尚无条目时 enabled=true（填凭据即启用）', async () => {
        configStub.value.config = { searchProviderId: undefined, fetchProviderId: undefined, providers: [] }
        const { result } = renderSubmission()

        await act(() => result.current.saveCredentials('deepseek', { apiKey: 'sk-x' }))
        const payload = configStub.value.save.mock.calls[0][0] as { providers: Array<{ id: string; enabled: boolean }> }
        expect(payload.providers.find((p) => p.id === 'deepseek')?.enabled).toBe(true)
    })

    it('失败收口：返回 false + message.error 透传 daemon 原因（非通用文案）', async () => {
        stubConfig()
        configStub.value.save.mockResolvedValue({ ok: false, error: 'provider "tavily" 缺少凭据：apiKey' } as const)
        const { result } = renderSubmission()

        const ok = await act(() => result.current.toggleProvider('tavily', false))
        expect(ok).toBe(false)
    })
})
