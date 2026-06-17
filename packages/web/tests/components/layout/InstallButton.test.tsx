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

import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import type { ReactNode } from 'react'
import { InstallButton } from '@/components/layout/InstallButton'

// t(key) 直接返回 key,断言用 key 字符串
vi.mock('react-i18next', () => ({
    useTranslation: () => ({ t: (key: string) => key }),
}))

interface MockBeforeInstallEvent extends Event {
    prompt: ReturnType<typeof vi.fn>
    userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

// 派发 mock beforeinstallprompt 事件,触发组件内监听(setInstallEvent)
function fireBeforeInstall(): MockBeforeInstallEvent {
    const evt = new Event('beforeinstallprompt') as MockBeforeInstallEvent
    evt.prompt = vi.fn().mockResolvedValue(undefined)
    evt.userChoice = Promise.resolve({ outcome: 'dismissed' })
    act(() => {
        window.dispatchEvent(evt)
    })
    return evt
}

describe('InstallButton', () => {
    afterEach(() => {
        cleanup()
    })

    function wrap(ui: ReactNode) {
        // Tooltip(nav variant)依赖 ref/portal,ConfigProvider 提供 context
        return render(ui)
    }

    it('未触发 beforeinstallprompt → 不渲染任何按钮', () => {
        const { container } = wrap(<InstallButton variant="card" />)
        expect(container.firstChild).toBeNull()
    })

    it('card variant → 渲染按钮 + 安装文案', () => {
        wrap(<InstallButton variant="card" />)
        fireBeforeInstall()
        expect(screen.getByRole('button')).toBeInTheDocument()
        expect(screen.getByText('notification.pwa.install')).toBeInTheDocument()
    })

    it('点击 card 按钮 → 调 event.prompt', () => {
        wrap(<InstallButton variant="card" />)
        const evt = fireBeforeInstall()
        fireEvent.click(screen.getByRole('button'))
        expect(evt.prompt).toHaveBeenCalled()
    })

    it('nav variant → 渲染图标按钮,不含安装文案', () => {
        wrap(<InstallButton variant="nav" />)
        fireBeforeInstall()
        expect(screen.getByRole('button')).toBeInTheDocument()
        expect(screen.queryByText('notification.pwa.install')).not.toBeInTheDocument()
    })

    it('menu variant → 渲染安装文案', () => {
        wrap(<InstallButton variant="menu" />)
        fireBeforeInstall()
        expect(screen.getByText('notification.pwa.install')).toBeInTheDocument()
    })
})
