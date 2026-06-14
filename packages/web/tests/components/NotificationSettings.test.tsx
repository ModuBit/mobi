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
import { render, screen, cleanup } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { ConfigProvider, App as AntdApp } from 'antd'

// 可变 mock 状态：每个用例可单独设置 permission / isPwa
const mockState = vi.hoisted(() => ({
    permission: 'default' as 'default' | 'granted' | 'denied',
    enable: vi.fn().mockResolvedValue('granted'),
    isPwa: false,
}))

// mock useNotificationSetup(避免真实 pushManager/Service Worker)
vi.mock('@/core/data/hooks/useNotificationSetup', () => ({
    useNotificationSetup: () => ({
        permission: mockState.permission,
        enable: mockState.enable,
    }),
}))
// mock usePwaMode
vi.mock('@/components/layout/usePwaMode', () => ({
    usePwaMode: () => mockState.isPwa,
}))
// mock InstallButton(避免 beforeinstallprompt 监听)
vi.mock('@/components/layout/InstallButton', () => ({
    InstallButton: () => <div data-testid="install-button" />,
}))

// t(key) 直接返回 key，断言用 key 字符串（与项目其他组件测试一致，避免 locale 探测问题）
vi.mock('react-i18next', () => ({
    useTranslation: () => ({ t: (key: string) => key }),
}))

// 动态 import 让 vi.mock 在模块系统内先生效
async function renderUi() {
    const { NotificationSettings } = await import('@/components/settings/NotificationSettings')
    return render(
        <ConfigProvider>
            <AntdApp>
                <NotificationSettings namespace="ns1" />
            </AntdApp>
        </ConfigProvider>
    )
}

describe('NotificationSettings', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        mockState.permission = 'default'
        mockState.enable = vi.fn().mockResolvedValue('granted')
        mockState.isPwa = false
    })

    afterEach(() => {
        cleanup()
    })

    it('permission=default 显示「开启通知」按钮', async () => {
        mockState.permission = 'default'
        await renderUi()
        // primary 按钮文案对应 enable key
        expect(screen.getByText('notification.settings.enable')).toBeInTheDocument()
    })

    it('permission=granted 显示「已开启」+「发送测试通知」', async () => {
        mockState.permission = 'granted'
        await renderUi()
        expect(screen.getByText('notification.settings.enabled')).toBeInTheDocument()
        expect(screen.getByText('notification.settings.test')).toBeInTheDocument()
    })

    it('permission=denied 显示禁止提示', async () => {
        mockState.permission = 'denied'
        await renderUi()
        expect(screen.getByText('notification.settings.denied')).toBeInTheDocument()
    })

    it('非 PWA 显示安装引导', async () => {
        mockState.permission = 'default'
        mockState.isPwa = false
        await renderUi()
        expect(screen.getByText('notification.settings.installPwa')).toBeInTheDocument()
        expect(screen.getByTestId('install-button')).toBeInTheDocument()
        // iOS 文字兜底
        expect(screen.getByText('notification.settings.installPwaIos')).toBeInTheDocument()
    })

    it('PWA 模式不显示安装引导', async () => {
        mockState.permission = 'granted'
        mockState.isPwa = true
        await renderUi()
        expect(screen.queryByText('notification.settings.installPwa')).not.toBeInTheDocument()
        expect(screen.queryByTestId('install-button')).not.toBeInTheDocument()
    })

    it('点击「开启通知」触发 enable()', async () => {
        mockState.permission = 'default'
        const { fireEvent } = await import('@testing-library/react')
        await renderUi()
        const btn = screen.getByText('notification.settings.enable')
        fireEvent.click(btn)
        expect(mockState.enable).toHaveBeenCalled()
    })
})
