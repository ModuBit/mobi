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
import { ConfigProvider, App as AntdApp } from 'antd'
import { DesktopSection } from '@/components/settings/sections/DesktopSection'
import type { MobiApi } from '@/core/data/api/client'

// —— mock useMobiApi：稳定引用（不稳定 mock 会导致 effect 无限循环）——
const setVncPasswordMock = vi.fn()
const vncStatusMock = vi.fn()
const listMock = vi.fn()
const mockApi = {
    desktop: {
        setVncPassword: setVncPasswordMock,
        vncStatus: vncStatusMock,
    },
    machines: { list: listMock },
} as unknown as MobiApi
vi.mock('@/core/data/api/client', async (importOriginal) => {
    const original = await importOriginal<typeof import('@/core/data/api/client')>()
    return {
        ...original,
        useMobiApi: () => mockApi,
    }
})

vi.mock('react-i18next', () => ({
    useTranslation: () => ({ t: (k: string) => k }),
}))

const wrapper = ({ children }: { children: React.ReactNode }) => (
    <ConfigProvider>
        <AntdApp>{children}</AntdApp>
    </ConfigProvider>
)

beforeEach(() => {
    setVncPasswordMock.mockReset()
    vncStatusMock.mockReset()
    listMock.mockReset()
    listMock.mockResolvedValue({ data: { machines: [{ id: 'machine-1', active: true, metadata: {} }] } })
    vncStatusMock.mockResolvedValue({ data: { configured: false } })
})

afterEach(() => cleanup())

describe('DesktopSection', () => {
    it('渲染两步引导与保存表单，展示未配置状态', async () => {
        render(<DesktopSection />, { wrapper })

        expect(screen.getByText('desktop.settings.guideTitle')).toBeInTheDocument()
        await waitFor(() => expect(screen.getByText('desktop.settings.notConfigured')).toBeInTheDocument())
        expect(vncStatusMock).toHaveBeenCalledWith('machine-1')
    })

    it('提交密码：调 setVncPassword 并刷新状态为已配置', async () => {
        setVncPasswordMock.mockResolvedValue({ data: { success: true } })

        render(<DesktopSection />, { wrapper })
        const input = await screen.findByTestId('desktop-vnc-password')
        fireEvent.change(input, { target: { value: 'ab12cd34' } })
        fireEvent.click(screen.getByRole('button', { name: 'desktop.settings.save' }))

        await waitFor(() => expect(setVncPasswordMock).toHaveBeenCalledWith('machine-1', 'ab12cd34'))
        await waitFor(() => expect(screen.getByText('desktop.settings.configured')).toBeInTheDocument())
    })

    it('保存失败 → 显示服务端错误文案', async () => {
        setVncPasswordMock.mockRejectedValue(new Error('Failed to reach cli'))

        render(<DesktopSection />, { wrapper })
        const input = await screen.findByTestId('desktop-vnc-password')
        fireEvent.change(input, { target: { value: 'ab12cd34' } })
        fireEvent.click(screen.getByRole('button', { name: 'desktop.settings.save' }))

        await waitFor(() => expect(screen.getByText(/Failed to reach cli/)).toBeInTheDocument())
    })

    it('无在线机器 → 不查询状态也不可提交', async () => {
        listMock.mockResolvedValue({ data: { machines: [] } })

        render(<DesktopSection />, { wrapper })
        await waitFor(() => expect(listMock).toHaveBeenCalled())

        // vncStatus 未被调用（无 machineId）
        expect(vncStatusMock).not.toHaveBeenCalled()
        expect(screen.getByRole('button', { name: 'desktop.settings.save' })).toBeDisabled()
    })
})
