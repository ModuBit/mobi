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
import { render, screen, waitFor, cleanup, fireEvent } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { ConfigProvider } from 'antd'
import { DesktopPage } from '@/pages/DesktopPage'
import { connectDesktopView, type DesktopViewCallbacks } from '@/core/desktop/desktopStreamClient'
import type { MobiApi } from '@/core/data/api/client'

// —— mock desktopStreamClient：捕获 connectDesktopView 参数，测试内手动触发回调 ——
vi.mock('@/core/desktop/desktopStreamClient', () => ({
    connectDesktopView: vi.fn(),
    describeDesktopFailure: vi.fn((reason: string) =>
        reason === 'vnc auth failed' ? 'desktop.failure.vncAuthFailed' : null),
}))
const connectMock = vi.mocked(connectDesktopView)
const disconnectSpy = vi.fn()
const capturedCallbacks: DesktopViewCallbacks[] = []

// —— mock useMobiApi：必须返回稳定引用（模块级不稳定 mock 会导致 effect 无限循环）——
const watchMock = vi.fn()
const listMock = vi.fn()
const mockApi = {
    desktop: { watch: watchMock },
    machines: { list: listMock },
} as unknown as MobiApi
vi.mock('@/core/data/api/client', async (importOriginal) => {
    const original = await importOriginal<typeof import('@/core/data/api/client')>()
    return {
        ...original,
        useMobiApi: () => mockApi,
    }
})

// —— mock i18next：直返 key ——
vi.mock('react-i18next', () => ({
    useTranslation: () => ({ t: (k: string) => k }),
}))

const wrapper = ({ children }: { children: React.ReactNode }) => <ConfigProvider>{children}</ConfigProvider>

beforeEach(() => {
    connectMock.mockReset()
    disconnectSpy.mockReset()
    capturedCallbacks.length = 0
    watchMock.mockReset()
    listMock.mockReset()
    listMock.mockResolvedValue({
        data: { machines: [{ id: 'machine-1', active: true, metadata: {} }] },
    })
    connectMock.mockImplementation(async ({ callbacks }) => {
        capturedCallbacks.push(callbacks ?? {})
        return { disconnect: disconnectSpy }
    })
})

afterEach(() => {
    cleanup()
})

function renderPage() {
    return render(<DesktopPage />, { wrapper })
}

describe('DesktopPage', () => {
    it('点击开始观看：watch 换 token 后 noVNC 以 wss/ws observe URL 连接，viewOnly 由连接层固定', async () => {
        watchMock.mockResolvedValue({ data: { observeToken: 'token-abc', expiresAtMs: Date.now() + 60_000 } })

        renderPage()
        const button = await screen.findByRole('button', { name: 'desktop.start' })
        fireEvent.click(button)

        await waitFor(() => expect(connectMock).toHaveBeenCalledTimes(1))
        const options = connectMock.mock.calls[0]![0]!
        expect(watchMock).toHaveBeenCalledWith('machine-1')
        expect(options.url).toBe(`ws://${window.location.host}/desktop/observe?token=token-abc`)

        // 连上后状态翻 connected
        capturedCallbacks[0]!.onConnect?.()
        await waitFor(() => expect(screen.getByText('desktop.connected')).toBeInTheDocument())
    })

    it('https 页面用 wss 构建 observe URL（token 编码进 WS 而非地址栏）', async () => {
        const originalProtocol = window.location.protocol
        Object.defineProperty(window, 'location', {
            value: { ...window.location, protocol: 'https:', host: 'hub.example.com' },
            writable: true,
        })
        try {
            watchMock.mockResolvedValue({ data: { observeToken: 'a b/c', expiresAtMs: Date.now() + 60_000 } })

            renderPage()
            fireEvent.click(await screen.findByRole('button', { name: 'desktop.start' }))

            await waitFor(() => expect(connectMock).toHaveBeenCalledTimes(1))
            const options = connectMock.mock.calls[0]![0]!
            expect(options.url).toBe('wss://hub.example.com/desktop/observe?token=a%20b%2Fc')
        } finally {
            Object.defineProperty(window, 'location', {
                value: { ...window.location, protocol: originalProtocol },
                writable: true,
            })
        }
    })

    it('watch 失败 → 错误态并显示服务端文案，提供重连', async () => {
        watchMock.mockRejectedValue(new Error('Desktop stream unavailable: cli offline'))

        renderPage()
        fireEvent.click(await screen.findByRole('button', { name: 'desktop.start' }))

        await waitFor(() => expect(screen.getByText(/cli offline/)).toBeInTheDocument())
        expect(screen.getByRole('button', { name: 'desktop.reconnect' })).toBeInTheDocument()
    })

    it('无在线机器 → 空态提示，不调用 watch', async () => {
        listMock.mockResolvedValue({ data: { machines: [] } })

        renderPage()
        await waitFor(() => expect(screen.getByText('desktop.noMachine')).toBeInTheDocument())
        expect(watchMock).not.toHaveBeenCalled()
    })

    it('卸载时断开 noVNC 连接（幂等回收）', async () => {
        watchMock.mockResolvedValue({ data: { observeToken: 'token-abc', expiresAtMs: Date.now() + 60_000 } })

        const { unmount } = renderPage()
        fireEvent.click(await screen.findByRole('button', { name: 'desktop.start' }))
        await waitFor(() => expect(connectMock).toHaveBeenCalledTimes(1))

        unmount()
        expect(disconnectSpy).toHaveBeenCalledTimes(1)
    })

    it('异常断开（clean=false）→ 错误态可重连', async () => {
        watchMock.mockResolvedValue({ data: { observeToken: 'token-abc', expiresAtMs: Date.now() + 60_000 } })

        renderPage()
        fireEvent.click(await screen.findByRole('button', { name: 'desktop.start' }))
        await waitFor(() => expect(connectMock).toHaveBeenCalledTimes(1))

        capturedCallbacks[0]!.onDisconnect?.({ clean: false })
        await waitFor(() => expect(screen.getByText('desktop.disconnected')).toBeInTheDocument())
    })

    it('认证失败（securityfailure 已知归因）→ 展示映射后的可理解文案', async () => {
        watchMock.mockResolvedValue({ data: { observeToken: 'token-abc', expiresAtMs: Date.now() + 60_000 } })

        renderPage()
        fireEvent.click(await screen.findByRole('button', { name: 'desktop.start' }))
        await waitFor(() => expect(connectMock).toHaveBeenCalledTimes(1))

        capturedCallbacks[0]!.onFailure?.('vnc auth failed')
        await waitFor(() => expect(screen.getByText('desktop.failure.vncAuthFailed')).toBeInTheDocument())
        expect(screen.getByRole('button', { name: 'desktop.reconnect' })).toBeInTheDocument()
    })

    it('未知归因 → 回退展示原始 reason', async () => {
        watchMock.mockResolvedValue({ data: { observeToken: 'token-abc', expiresAtMs: Date.now() + 60_000 } })

        renderPage()
        fireEvent.click(await screen.findByRole('button', { name: 'desktop.start' }))
        await waitFor(() => expect(connectMock).toHaveBeenCalledTimes(1))

        capturedCallbacks[0]!.onFailure?.('no supported security type')
        await waitFor(() =>
            expect(screen.getByText(/no supported security type/)).toBeInTheDocument())
    })
})
