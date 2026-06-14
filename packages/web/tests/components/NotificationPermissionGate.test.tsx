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
import { render, screen, fireEvent, act, cleanup } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { ConfigProvider, App as AntdApp } from 'antd'

// mock useNotificationSetup：返回受控 enable，隔离真实 pushManager/Service Worker
const mockEnable = vi.hoisted(() => vi.fn().mockResolvedValue('granted'))
vi.mock('@/core/data/hooks/useNotificationSetup', () => ({
    useNotificationSetup: () => ({ permission: 'default', subscribed: false, enable: mockEnable }),
}))
// t(key) 直接返回 key，断言用 key 字符串（与项目其他组件测试一致）
vi.mock('react-i18next', () => ({
    useTranslation: () => ({ t: (key: string) => key }),
}))

async function renderGate() {
    const { NotificationPermissionGate } = await import('@/components/NotificationPermissionGate')
    return render(
        <ConfigProvider>
            <AntdApp>
                <NotificationPermissionGate />
            </AntdApp>
        </ConfigProvider>
    )
}

describe('NotificationPermissionGate', () => {
    beforeEach(() => {
        vi.useFakeTimers()
        vi.clearAllMocks()
        vi.resetModules()
    })
    afterEach(() => {
        vi.useRealTimers()
        // antd notification 渲染到全局 body portal，必须 cleanup 清理，否则跨用例残留污染
        cleanup()
        vi.unstubAllGlobals()
    })

    it('permission=default → 2s 后弹授权引导', async () => {
        vi.stubGlobal('Notification', { permission: 'default' })
        await renderGate()
        // 未到 2s 不弹
        expect(screen.queryByText('notification.permissionRequest')).not.toBeInTheDocument()
        act(() => {
            vi.advanceTimersByTime(2000)
        })
        expect(screen.getByText('notification.permissionRequest')).toBeInTheDocument()
    })

    it('点击授权按钮触发 enable（授权 + 订阅，而非仅 requestPermission）', async () => {
        vi.stubGlobal('Notification', { permission: 'default' })
        await renderGate()
        act(() => {
            vi.advanceTimersByTime(2000)
        })
        act(() => {
            fireEvent.click(screen.getByText('notification.permissionRequestBtn'))
        })
        expect(mockEnable).toHaveBeenCalled()
    })

    it('permission=denied → 弹引导去浏览器设置', async () => {
        vi.stubGlobal('Notification', { permission: 'denied' })
        await renderGate()
        act(() => {
            vi.advanceTimersByTime(2000)
        })
        expect(screen.getByText('notification.permissionGuide')).toBeInTheDocument()
    })

    it('permission=granted → 不弹任何引导', async () => {
        vi.stubGlobal('Notification', { permission: 'granted' })
        await renderGate()
        act(() => {
            vi.advanceTimersByTime(2000)
        })
        expect(screen.queryByText('notification.permissionRequest')).not.toBeInTheDocument()
        expect(screen.queryByText('notification.permissionGuide')).not.toBeInTheDocument()
    })
})
