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
import { NotificationSettings } from '@/components/settings/NotificationSettings'

// 可变 mock 状态：每个用例可单独设置 permission / isPwa
const mockState = vi.hoisted(() => ({
    permission: 'default' as 'default' | 'granted' | 'denied',
    subscribed: false,
    enable: vi.fn().mockResolvedValue('granted'),
    refreshPermission: vi.fn().mockResolvedValue(undefined),
    isPwa: false,
    error: null as { kind: 'timeout' | 'subscribe' } | null,
}))

// message.error spy：mock antd App.useApp，捕获失败反馈调用
const messageErrorSpy = vi.hoisted(() => vi.fn())

// mock useNotificationSetup(避免真实 pushManager/Service Worker/hook 逻辑)。
// awaitServiceWorkerReady 已移到独立模块(pwa/swReady),NotificationSettings 直接 import,真实可用。
vi.mock('@/core/data/hooks/useNotificationSetup', () => ({
    useNotificationSetup: () => ({
        permission: mockState.permission,
        subscribed: mockState.subscribed,
        error: mockState.error,
        enable: mockState.enable,
        refreshPermission: mockState.refreshPermission,
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

// mock antd App.useApp：拦截 message.error，捕获失败反馈文案（其余 antd 真实，含 ConfigProvider/Button）
vi.mock('antd', async (orig) => {
    const actual = await orig()
    return {
        ...actual,
        App: {
            ...actual.App,
            useApp: () => ({ message: { error: messageErrorSpy } }),
        },
    }
})

// vi.mock 是 hoisted（在所有 import 之前执行），顶层 import 时各 mock 已生效。
// 用同步 render 避免 async import 在测试 timeout 后才 resolve、render 读到已被
// 下个测试 beforeEach 改写的 mockState 而污染 DOM（flaky multiple-match）。
function renderUi() {
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
        mockState.subscribed = false
        mockState.enable = vi.fn().mockResolvedValue('granted')
        mockState.refreshPermission = vi.fn().mockResolvedValue(undefined)
        mockState.isPwa = false
        mockState.error = null
    })

    afterEach(() => {
        cleanup()
    })

    it('permission=default 显示「开启通知」按钮', async () => {
        mockState.permission = 'default'
        renderUi()
        // primary 按钮文案对应 enable key
        expect(screen.getByText('notification.settings.enable')).toBeInTheDocument()
    })

    it('permission=granted 显示「已开启」+「发送测试通知」', async () => {
        mockState.permission = 'granted'
        renderUi()
        expect(screen.getByText('notification.settings.enabled')).toBeInTheDocument()
        expect(screen.getByText('notification.settings.test')).toBeInTheDocument()
    })

    it('permission=denied 显示禁止提示', async () => {
        mockState.permission = 'denied'
        renderUi()
        expect(screen.getByText('notification.settings.denied')).toBeInTheDocument()
    })

    it('permission=denied 显示「重新检查」按钮，点击触发 refreshPermission', async () => {
        mockState.permission = 'denied'
        const { fireEvent } = await import('@testing-library/react')
        renderUi()
        const btn = screen.getByText('notification.settings.refreshPermission')
        fireEvent.click(btn)
        expect(mockState.refreshPermission).toHaveBeenCalled()
    })

    it('非 PWA 显示安装引导', async () => {
        mockState.permission = 'default'
        mockState.isPwa = false
        renderUi()
        expect(screen.getByText('notification.settings.installPwa')).toBeInTheDocument()
        expect(screen.getByTestId('install-button')).toBeInTheDocument()
        // iOS 文字兜底
        expect(screen.getByText('notification.settings.installPwaIos')).toBeInTheDocument()
    })

    it('PWA 模式不显示安装引导', async () => {
        mockState.permission = 'granted'
        mockState.isPwa = true
        renderUi()
        expect(screen.queryByText('notification.settings.installPwa')).not.toBeInTheDocument()
        expect(screen.queryByTestId('install-button')).not.toBeInTheDocument()
    })

    it('点击「开启通知」触发 enable()', async () => {
        mockState.permission = 'default'
        const { fireEvent } = await import('@testing-library/react')
        renderUi()
        const btn = screen.getByText('notification.settings.enable')
        fireEvent.click(btn)
        expect(mockState.enable).toHaveBeenCalled()
    })

    it('点击「发送测试通知」通过 SW showNotification 显示', async () => {
        mockState.permission = 'granted'
        const showNotification = vi.fn().mockResolvedValue(undefined)
        const nav = navigator as any
        const original = nav.serviceWorker
        Object.defineProperty(nav, 'serviceWorker', {
            value: { ready: Promise.resolve({ showNotification }) },
            configurable: true,
        })
        const { fireEvent } = await import('@testing-library/react')
        renderUi()
        fireEvent.click(screen.getByText('notification.settings.test'))
        await vi.waitFor(() => expect(showNotification).toHaveBeenCalled())
        Object.defineProperty(nav, 'serviceWorker', { value: original, configurable: true })
    })

    it('测试通知发送失败时 message.error 提示', async () => {
        mockState.permission = 'granted'
        const nav = navigator as any
        const original = nav.serviceWorker
        Object.defineProperty(nav, 'serviceWorker', {
            value: { ready: Promise.reject(new Error('sw down')) },
            configurable: true,
        })
        const { fireEvent } = await import('@testing-library/react')
        renderUi()
        fireEvent.click(screen.getByText('notification.settings.test'))
        await vi.waitFor(() =>
            expect(messageErrorSpy).toHaveBeenCalledWith('notification.settings.testFailed'),
        )
        Object.defineProperty(nav, 'serviceWorker', { value: original, configurable: true })
    })

    it('granted + 未订阅 显示「重新订阅」按钮', async () => {
        mockState.permission = 'granted'
        mockState.subscribed = false
        renderUi()
        expect(screen.getByText('notification.settings.resubscribe')).toBeInTheDocument()
    })

    it('granted + 已订阅 不显示「重新订阅」按钮', async () => {
        mockState.permission = 'granted'
        mockState.subscribed = true
        renderUi()
        expect(screen.queryByText('notification.settings.resubscribe')).not.toBeInTheDocument()
    })

    it('点击「重新订阅」触发 enable()', async () => {
        mockState.permission = 'granted'
        mockState.subscribed = false
        const { fireEvent } = await import('@testing-library/react')
        renderUi()
        fireEvent.click(screen.getByText('notification.settings.resubscribe'))
        expect(mockState.enable).toHaveBeenCalled()
    })

    it('显示「如何允许浏览器通知」可折叠区块标题', async () => {
        mockState.permission = 'default'
        renderUi()
        expect(screen.getByText('notification.settings.howToAllow')).toBeInTheDocument()
    })

    it('denied 态默认展开说明区块(aria-expanded=true)', async () => {
        mockState.permission = 'denied'
        renderUi()
        const header = screen.getByRole('button', { name: 'notification.settings.howToAllow' })
        expect(header).toHaveAttribute('aria-expanded', 'true')
    })

    it('default 态默认收起,点击 header 后展开并显示步骤', async () => {
        mockState.permission = 'default'
        const { fireEvent } = await import('@testing-library/react')
        renderUi()
        const header = screen.getByRole('button', { name: 'notification.settings.howToAllow' })
        // 收起态
        expect(header).toHaveAttribute('aria-expanded', 'false')
        expect(screen.queryByText('notification.settings.stepMacWin1')).not.toBeInTheDocument()
        // 点击展开
        fireEvent.click(header)
        expect(header).toHaveAttribute('aria-expanded', 'true')
        expect(screen.getByText('notification.settings.stepMacWin1')).toBeInTheDocument()
    })

    it('展开后显示三平台步骤(mac/win、android、ios)', async () => {
        mockState.permission = 'denied' // denied 默认展开
        renderUi()
        expect(screen.getByText('notification.settings.stepMacWin1')).toBeInTheDocument()
        expect(screen.getByText('notification.settings.stepAndroid1')).toBeInTheDocument()
        expect(screen.getByText('notification.settings.stepIos1')).toBeInTheDocument()
    })

    it('PWA 卡显示「任意端」说明(installPwaDesc)', async () => {
        mockState.permission = 'default'
        mockState.isPwa = false
        renderUi()
        expect(screen.getByText('notification.settings.installPwaDesc')).toBeInTheDocument()
    })

    it('展开后显示「浏览器」与「操作系统」两层标签', async () => {
        mockState.permission = 'denied' // 默认展开
        renderUi()
        expect(screen.getByText('notification.settings.layerBrowser')).toBeInTheDocument()
        expect(screen.getByText('notification.settings.layerOs')).toBeInTheDocument()
    })

    it('展开后显示操作系统层四平台步骤', async () => {
        mockState.permission = 'denied' // 默认展开
        renderUi()
        expect(screen.getByText('notification.settings.osMac')).toBeInTheDocument()
        expect(screen.getByText('notification.settings.osWindows')).toBeInTheDocument()
        expect(screen.getByText('notification.settings.osAndroid')).toBeInTheDocument()
        expect(screen.getByText('notification.settings.osIos')).toBeInTheDocument()
    })

    it('error.kind=timeout → message.error 带固定 key 去重 + swReadyTimeout 文案', async () => {
        mockState.permission = 'granted'
        mockState.error = { kind: 'timeout' }
        renderUi()
        expect(messageErrorSpy).toHaveBeenCalledWith({
            key: 'notification-subscribe-error',
            content: 'notification.settings.swReadyTimeout',
        })
    })

    it('error.kind=subscribe → message.error 带固定 key 去重 + subscribeFailed 文案', async () => {
        mockState.permission = 'granted'
        mockState.error = { kind: 'subscribe' }
        renderUi()
        expect(messageErrorSpy).toHaveBeenCalledWith({
            key: 'notification-subscribe-error',
            content: 'notification.settings.subscribeFailed',
        })
    })
})
