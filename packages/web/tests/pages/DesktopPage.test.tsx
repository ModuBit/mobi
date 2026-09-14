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
import { render, screen, cleanup, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { ConfigProvider } from 'antd'
import { DesktopPage } from '@/pages/DesktopPage'

// —— mock provider 单例：fake lease 记录 acquire/release（稳定引用，避免 effect 循环陷阱）——
const acquireCalls: Array<{ machineId: string; attachTo: unknown }> = []
const releases: Array<unknown> = []
const fakeLease = {
    attachTo: vi.fn(),
    release: vi.fn(() => releases.push(null)),
}
// snapshot 必须稳定引用（每次新对象会让 useSyncExternalStore 无限重渲染）
const STABLE_STATE = { phase: 'connecting' } as const
vi.mock('@/core/desktop/desktopStreamProvider', () => ({
    DESKTOP_STREAM_GRACE_MS: 30_000,
    desktopStreamProvider: {
        acquire: vi.fn((machineId: string) => {
            acquireCalls.push({ machineId, attachTo: undefined })
            return fakeLease
        }),
        subscribe: vi.fn(() => () => undefined),
        getState: vi.fn(() => STABLE_STATE),
    },
}))

// —— mock useMobiApi：稳定引用 ——
const watchMock = vi.fn()
const listMock = vi.fn()
const mockApi = {
    desktop: { watch: watchMock },
    machines: { list: listMock },
} as unknown as import('@/core/data/api/client').MobiApi
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

// jsdom 无 ResizeObserver：stub 为空实现（surface 用它观察展示面尺寸）
class ResizeObserverStub {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
}
window.ResizeObserver = window.ResizeObserver ?? (ResizeObserverStub as unknown as typeof ResizeObserver)

beforeEach(() => {
    acquireCalls.length = 0
    releases.length = 0
    fakeLease.attachTo.mockClear()
    fakeLease.release.mockClear()
    watchMock.mockReset()
    listMock.mockReset()
    listMock.mockResolvedValue({
        data: { machines: [{ id: 'machine-idle', active: false }, { id: 'machine-active', active: true }] },
    })
})

afterEach(() => {
    cleanup()
})

describe('DesktopPage', () => {
    it('挂载即取在线机器列表并默认选中在线机器，acquire 展示面', async () => {
        render(<DesktopPage />, { wrapper })

        await waitFor(() => expect(listMock).toHaveBeenCalledTimes(1))
        await waitFor(() => expect(acquireCalls).toHaveLength(1))
        expect(acquireCalls[0]!.machineId).toBe('machine-active')
        expect(fakeLease.attachTo).toHaveBeenCalledTimes(1)
    })

    it('卸载时 release（引用计数 GC 交还 Provider）', async () => {
        const { unmount } = render(<DesktopPage />, { wrapper })
        await waitFor(() => expect(acquireCalls).toHaveLength(1))

        unmount()
        expect(fakeLease.release).toHaveBeenCalledTimes(1)
    })
})
