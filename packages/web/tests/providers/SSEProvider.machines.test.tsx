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
import { render, cleanup } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ConfigProvider, App as AntdApp } from 'antd'

// 捕获 SSEClient.subscribe 注册的事件回调，测试可手动派发 SSE 事件
const sseListener = vi.hoisted(() => ({ current: null as ((e: any) => void) | null }))

vi.mock('@/core/data/realtime/sseClient', () => ({
    SSEClient: vi.fn().mockImplementation(function (this: any) {
        this.subscribe = (cb: any) => {
            sseListener.current = cb
            return () => {}
        }
        this.connect = () => {}
        this.disconnect = () => {}
        this.reconnectIfStale = () => false
    }),
}))
vi.mock('@/core/data/api/client', () => ({
    useMobiApi: () => ({
        visibility: { report: vi.fn().mockResolvedValue(undefined) },
        messages: { list: vi.fn().mockResolvedValue({ data: { messages: [], page: { hasMore: false } } }) },
    }),
}))
vi.mock('@/core/data/stores/authStore', () => ({
    useAuthStore: () => ({ authenticated: true, logout: vi.fn() }),
}))
vi.mock('@tanstack/react-router', () => ({
    useNavigate: () => vi.fn(),
    useLocation: () => ({ pathname: '/' }),
}))
vi.mock('@/core/data/hooks/useNotify', () => ({
    useNotify: () => ({ warning: vi.fn(), success: vi.fn(), info: vi.fn(), error: vi.fn(), destroy: vi.fn() }),
}))
vi.mock('@/components/NotificationPermissionGate', () => ({
    NotificationPermissionGate: () => null,
    resetPermissionPrompt: vi.fn(),
}))
vi.mock('react-i18next', () => ({
    useTranslation: () => ({ t: (k: string) => k }),
}))
vi.mock('antd', async (orig) => {
    const actual = await orig()
    return {
        ...actual,
        App: {
            ...actual.App,
            useApp: () => ({
                notification: { info: vi.fn(), destroy: vi.fn() },
                message: { error: vi.fn() },
            }),
        },
    }
})

async function renderProvider() {
    const { SSEProvider } = await import('@/core/providers/SSEProvider')
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const tree = (
        <QueryClientProvider client={qc}>
            <ConfigProvider>
                <AntdApp>
                    <SSEProvider><div /></SSEProvider>
                </AntdApp>
            </ConfigProvider>
        </QueryClientProvider>
    )
    return { ...render(tree), queryClient: qc }
}

/** 缓存预置：一台在线机器（与 hub 全量事件投影前的 web 形状一致） */
function seedMachines(qc: QueryClient, machines: unknown[]) {
    qc.setQueryData(['machines'], { machines })
}

describe('SSEProvider machine-updated —— 缓存 patch 替代 refetch（渲染集成）', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        sseListener.current = null
    })
    afterEach(() => cleanup())

    it('全量 machine 负载 → upsert 为 web 投影（不塞入 hub 专有字段）', async () => {
        const { queryClient } = await renderProvider()
        seedMachines(queryClient, [
            { id: 'm1', active: true, metadata: { host: 'h1', platform: 'darwin', displayName: 'A', homeDir: '/a' }, runnerState: null },
        ])

        sseListener.current!({
            type: 'machine-updated',
            machineId: 'm2',
            // hub 全量行形状（含 namespace/seq/activeAt 等专有字段）
            data: {
                id: 'm2', namespace: 'ns', seq: 1, createdAt: 1, updatedAt: 1,
                active: true, activeAt: 2, metadataVersion: 0, runnerStateVersion: 0,
                metadata: { host: 'h2', platform: 'linux', mobiCliVersion: '1.0', displayName: 'B', homeDir: '/b', mobiHomeDir: '/mh', mobiLibDir: '/ml' },
                runnerState: { version: 1, value: { running: false } },
            },
        })

        const cached = queryClient.getQueryData<any>(['machines'])
        expect(cached.machines).toHaveLength(2)
        const m2 = cached.machines.find((m: any) => m.id === 'm2')
        // web 投影字段齐备
        expect(m2).toEqual({
            id: 'm2',
            active: true,
            metadata: { host: 'h2', platform: 'linux', displayName: 'B', homeDir: '/b' },
            runnerState: { version: 1, value: { running: false } },
        })
        // 已有机器不受影响
        expect(cached.machines.find((m: any) => m.id === 'm1').active).toBe(true)
    })

    it('{ active: false } 负载 → 下线机器从缓存移除（与 refetch 的 active-only 语义一致）', async () => {
        const { queryClient } = await renderProvider()
        seedMachines(queryClient, [
            { id: 'm1', active: true, metadata: { host: 'h1', platform: 'darwin' }, runnerState: null },
            { id: 'm2', active: true, metadata: { host: 'h2', platform: 'linux' }, runnerState: null },
        ])

        sseListener.current!({ type: 'machine-updated', machineId: 'm1', data: { active: false } })

        const cached = queryClient.getQueryData<any>(['machines'])
        // GET /api/machines 只返回 active 机器——patch 若保留 active:false 行，
        // 死机器会一直出现在机器选择列表，直到 5min 兜底 refetch 才被清走
        expect(cached.machines.map((m: any) => m.id)).toEqual(['m2'])
    })

    it('null 负载 → 移除该机器', async () => {
        const { queryClient } = await renderProvider()
        seedMachines(queryClient, [
            { id: 'm1', active: true, metadata: null, runnerState: null },
            { id: 'm2', active: true, metadata: null, runnerState: null },
        ])

        sseListener.current!({ type: 'machine-updated', machineId: 'm1', data: null })

        const cached = queryClient.getQueryData<any>(['machines'])
        expect(cached.machines.map((m: any) => m.id)).toEqual(['m2'])
    })

    it('全量负载命中已有缓存行 → 合并覆写投影字段，保留 fetch 缓存的 hub 专有字段', async () => {
        const { queryClient } = await renderProvider()
        seedMachines(queryClient, [
            // 模拟 refetch 缓存的 hub 全行（含 namespace/activeAt 等 web Machine 类型之外的字段）
            { id: 'm1', active: true, metadata: { host: 'h1', platform: 'darwin' }, runnerState: null, namespace: 'ns', activeAt: 42 },
        ])

        sseListener.current!({
            type: 'machine-updated',
            machineId: 'm1',
            data: { id: 'm1', active: true, metadata: { host: 'h1', platform: 'darwin' } },
        })

        const cached = queryClient.getQueryData<any>(['machines'])
        const m1 = cached.machines.find((m: any) => m.id === 'm1')
        expect(m1.namespace).toBe('ns')
        expect(m1.activeAt).toBe(42)
    })

    it('{ id } 占位负载 → 不动缓存（hub 同步跟随全量事件）', async () => {
        const { queryClient } = await renderProvider()
        seedMachines(queryClient, [
            { id: 'm1', active: true, metadata: null, runnerState: null },
        ])

        sseListener.current!({ type: 'machine-updated', machineId: 'm1', data: { id: 'm1' } })

        const cached = queryClient.getQueryData<any>(['machines'])
        expect(cached.machines).toHaveLength(1)
    })

    it('缓存不存在 → 不创建（避免单机 patch 被当成完整列表）', async () => {
        const { queryClient } = await renderProvider()

        sseListener.current!({
            type: 'machine-updated',
            machineId: 'm1',
            data: { id: 'm1', active: true, metadata: { host: 'h1', platform: 'linux' } },
        })

        expect(queryClient.getQueryData(['machines'])).toBeUndefined()
    })

    it('machine-updated 不再触发 invalidateQueries（CLI 心跳不再引发每 20s refetch）', async () => {
        const { queryClient } = await renderProvider()
        seedMachines(queryClient, [])
        const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries')

        sseListener.current!({
            type: 'machine-updated',
            machineId: 'm1',
            data: { id: 'm1', active: true, metadata: { host: 'h1', platform: 'linux' } },
        })

        expect(invalidateSpy).not.toHaveBeenCalled()
    })
})

describe('SSEProvider 断连重连 —— machines 对账（patch 模式的确定性补拉点）', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        sseListener.current = null
    })
    afterEach(() => cleanup())

    it('reconnected → 失效 machines（断连窗口内 machine-updated 不会被重放）', async () => {
        vi.useFakeTimers()
        const { queryClient } = await renderProvider()
        const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries')

        sseListener.current!({ type: 'connection-changed', connected: true, reconnected: true })
        await vi.advanceTimersByTimeAsync(16)

        const keys = invalidateSpy.mock.calls.map(c => (c[0] as { queryKey?: unknown }).queryKey)
        expect(keys.some(k => Array.isArray(k) && k[0] === 'machines')).toBe(true)

        vi.useRealTimers()
    })
})
