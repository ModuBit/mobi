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
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ConfigProvider, App as AntApp } from 'antd'
import { SidebarDesktopStreams } from '@/components/layout/SidebarDesktopStreams'

// —— mock api：稳定引用 ——
const streamsMock = vi.fn()
const closeStreamMock = vi.fn()
const mockApi = {
    desktop: { streams: streamsMock, closeStream: closeStreamMock },
} as unknown as import('@/core/data/api/client').MobiApi
vi.mock('@/core/data/api/client', async (importOriginal) => {
    const original = await importOriginal<typeof import('@/core/data/api/client')>()
    return { ...original, useMobiApi: () => mockApi }
})

const navigateMock = vi.fn()
vi.mock('@tanstack/react-router', async (importOriginal) => {
    const original = await importOriginal<typeof import('@tanstack/react-router')>()
    return { ...original, useNavigate: () => navigateMock }
})

// —— mock i18next：直返 key ——
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (k: string) => k }) }))

function makeWrapper() {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    return ({ children }: { children: React.ReactNode }) => (
        <QueryClientProvider client={queryClient}>
            <ConfigProvider>
                <AntApp>{children}</AntApp>
            </ConfigProvider>
        </QueryClientProvider>
    )
}

beforeEach(() => {
    streamsMock.mockReset().mockResolvedValue({ data: { streams: [] } })
    closeStreamMock.mockReset().mockResolvedValue({ data: { success: true } })
    navigateMock.mockReset()
})

afterEach(() => {
    cleanup()
    vi.useRealTimers()
})

describe('SidebarDesktopStreams', () => {
    it('无活跃流 → 整体隐藏', async () => {
        const Wrapper = makeWrapper()
        const { container } = render(<SidebarDesktopStreams />, { wrapper: Wrapper })

        await waitFor(() => expect(streamsMock).toHaveBeenCalledTimes(1))
        // 组件整体 return null（wrapper 的 ant-app 空壳除外）
        expect(container.textContent).toBe('')
    })

    it('有活跃流 → 列表项展示 machineId，点击进入独立页（?machine=）', async () => {
        streamsMock.mockResolvedValue({
            data: { streams: [{ sessionId: 'sess-1', machineId: 'mac-1', startedAtMs: Date.now() }] },
        })
        const Wrapper = makeWrapper()
        render(<SidebarDesktopStreams />, { wrapper: Wrapper })

        expect(await screen.findByText('mac-1')).toBeInTheDocument()

        fireEvent.click(screen.getByText('mac-1').closest('[class*="Row"]') ?? screen.getByText('mac-1'))
        await waitFor(() => expect(navigateMock).toHaveBeenCalledWith({ to: '/desktop', search: { machine: 'mac-1' } }))
    })

    it('关闭有确认交互：确认后调 close API 并刷新列表', async () => {
        streamsMock.mockResolvedValue({
            data: { streams: [{ sessionId: 'sess-1', machineId: 'mac-1', startedAtMs: Date.now() }] },
        })
        const Wrapper = makeWrapper()
        render(<SidebarDesktopStreams />, { wrapper: Wrapper })

        const closeButton = await screen.findByRole('button', { name: 'nav.desktopStreamsClose' })
        fireEvent.click(closeButton)

        // antd modal.confirm 确认按钮（okText 默认「确定」，i18n mock 下直接找 OK）
        const okButton = await screen.findByRole('button', { name: /ok|确定|Ok/i })
        fireEvent.click(okButton)

        await waitFor(() => expect(closeStreamMock).toHaveBeenCalledWith('sess-1'))
    })
})
