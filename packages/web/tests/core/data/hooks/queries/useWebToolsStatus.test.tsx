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
import { renderHook, waitFor, cleanup } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'

// ============ useMobiApi mock（必须返回稳定引用，否则 effect 无限循环 OOM——项目已知坑） ============

const machinesList = vi.hoisted(() => vi.fn())
const webToolsGet = vi.hoisted(() => vi.fn())
const mockApi = {
    machines: { list: machinesList, webTools: { get: webToolsGet } },
}
vi.mock('@/core/data/api/client', () => ({
    useMobiApi: () => mockApi,
}))

import { useWebToolsStatus } from '@/core/data/hooks/queries/useWebToolsStatus'

/** 每用例新建 QueryClient，避免缓存串测 */
function makeQueryClient() {
    return new QueryClient({ defaultOptions: { queries: { retry: false } } })
}

function makeHookWrapper(qc: QueryClient) {
    return ({ children }: { children: ReactNode }) => (
        <QueryClientProvider client={qc}>{children}</QueryClientProvider>
    )
}

function makeMachine(overrides: Partial<{ id: string; active: boolean }> = {}) {
    return { id: 'm1', active: true, ...overrides }
}

/** 渲染 hook 并等到非 loading（queryFn resolve 后必然离开 pending） */
async function renderStatus() {
    const { result } = renderHook(() => useWebToolsStatus(), {
        wrapper: makeHookWrapper(makeQueryClient()),
    })
    await waitFor(() => expect(result.current).not.toBe('loading'))
    return result.current
}

// vitest 未开 globals：渲染型测试必须显式 cleanup——项目已知坑
afterEach(() => cleanup())

describe('useWebToolsStatus 三态推导', () => {
    beforeEach(() => {
        vi.clearAllMocks()
    })

    it('无 active 机器 → offline', async () => {
        machinesList.mockResolvedValue({ data: { machines: [makeMachine({ active: false })] } })
        expect(await renderStatus()).toBe('offline')
        // 第一跳已短路，不应再请求配置
        expect(webToolsGet).not.toHaveBeenCalled()
    })

    it('webTools.get 返回 { error } 变体 → offline', async () => {
        machinesList.mockResolvedValue({ data: { machines: [makeMachine()] } })
        webToolsGet.mockResolvedValue({ data: { error: 'boom' } })
        expect(await renderStatus()).toBe('offline')
    })

    it('providers.some(enabled)=true → enabled', async () => {
        machinesList.mockResolvedValue({ data: { machines: [makeMachine({ id: 'm1' }), makeMachine({ id: 'm2' })] } })
        webToolsGet.mockResolvedValue({
            data: { config: { providers: [{ id: 'tavily', enabled: true }, { id: 'bocha', enabled: false }] } },
        })
        expect(await renderStatus()).toBe('enabled')
        // 多机取第一台在线
        expect(webToolsGet).toHaveBeenCalledWith('m1')
    })

    it('providers 存在但均未启用 → unconfigured', async () => {
        machinesList.mockResolvedValue({ data: { machines: [makeMachine()] } })
        webToolsGet.mockResolvedValue({
            data: { config: { providers: [{ id: 'tavily', enabled: false }] } },
        })
        expect(await renderStatus()).toBe('unconfigured')
    })

    it('providers 缺省（未配置任何 provider）→ unconfigured', async () => {
        machinesList.mockResolvedValue({ data: { machines: [makeMachine()] } })
        webToolsGet.mockResolvedValue({ data: { config: {} } })
        expect(await renderStatus()).toBe('unconfigured')
    })

    it('machines.list reject → offline', async () => {
        machinesList.mockRejectedValue(new Error('network down'))
        expect(await renderStatus()).toBe('offline')
    })
})
