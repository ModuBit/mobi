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
import { render, fireEvent, cleanup, act } from '@testing-library/react'
import type { ReactNode } from 'react'

// ---- hooks / 数据源 mock ----
// t(key) 直接返回 key,断言用 key 字符串
vi.mock('react-i18next', () => ({
    useTranslation: () => ({ t: (key: string) => key }),
}))

vi.mock('@tanstack/react-router', () => ({
    useNavigate: () => vi.fn(),
    useLocation: () => ({ pathname: '/' }),
}))

// uiStore:setMobileMenuOpen 用 spy(no-op 不改 state),保持 drawer 开着便于连续查询
const setMobileMenuOpen = vi.fn()
vi.mock('@/core/data/stores/uiStore', () => ({
    useUiStore: () => ({ mobileMenuOpen: true, setMobileMenuOpen }),
}))

vi.mock('@/core/data/stores/authStore', () => ({
    useAuthStore: () => ({ logout: vi.fn() }),
}))

vi.mock('@/core/data/api/client', () => ({
    useMobiApi: () => ({ auth: { logout: vi.fn() } }),
}))

vi.mock('@/core/data/hooks/useMediaQuery', () => ({
    useIsMobile: () => true,
}))

vi.mock('@/components/layout/useThemeLocaleToggle', () => ({
    useThemeLocaleToggle: () => ({
        resolvedTheme: 'dark',
        locale: 'zh',
        toggleTheme: vi.fn(),
        toggleLocale: vi.fn(),
    }),
}))

const checkUpdate = vi.fn()
vi.mock('@/core/pwa/useForceUpdate', () => ({
    useForceUpdate: () => checkUpdate,
}))

// MobileProjectList 自带 API/hooks,mock 掉避免噪声
vi.mock('@/components/layout/MobileProjectList', () => ({
    MobileProjectList: () => null,
}))

// MobileDrawer 渲染重(portal + history guard + emotion),mock 成裸 div 透传 children
vi.mock('@/components/ui/MobileDrawer', () => ({
    MobileDrawer: ({ children, open }: { children: ReactNode; open: boolean }) =>
        open ? <div data-testid="drawer">{children}</div> : null,
}))

import { MobileMenuDrawer } from '@/components/layout/MobileMenu'

describe('MobileMenuDrawer 刷新按钮', () => {
    let reloadSpy: ReturnType<typeof vi.fn>

    beforeEach(() => {
        vi.useFakeTimers()
        reloadSpy = vi.fn()
        // jsdom 无 location.reload 实现,与 forceUpdate.test.ts 同套 mock
        Object.defineProperty(window, 'location', {
            value: { ...window.location, reload: reloadSpy },
            writable: true,
        })
        setMobileMenuOpen.mockClear()
        checkUpdate.mockClear()
    })

    afterEach(() => {
        vi.useRealTimers()
        cleanup()
    })

    it('刷新:reload 必须被推迟(非同步),让 React 先 flush drawer 关闭态', () => {
        // 移动端 PWA 实测:同步 window.location.reload() 紧随 setState 会被 Android Chrome
        // standalone 吞掉(drawer 关了但页面不重载)。必须延到下一 task 触发。
        render(<MobileMenuDrawer />)

        // drawer 内含「刷新」文案(t('nav.refresh') → 'nav.refresh')
        const drawer = document.querySelector('[data-testid="drawer"]')!
        const refreshSpan = Array.from(drawer.querySelectorAll('span'))
            .find(s => s.textContent === 'nav.refresh')
        expect(refreshSpan).toBeTruthy()

        act(() => {
            fireEvent.click(refreshSpan!)
        })

        // 关键断言 1:点击后同步态,reload 尚未调用(被 setTimeout 推迟)
        expect(reloadSpy).not.toHaveBeenCalled()
        // drawer 关闭已发起(setMobileMenuOpen(false))
        expect(setMobileMenuOpen).toHaveBeenCalledWith(false)

        // 关键断言 2:推进定时器后,reload 才触发
        act(() => {
            vi.runOnlyPendingTimers()
        })
        expect(reloadSpy).toHaveBeenCalledTimes(1)
    })

    it('检查更新:走 checkUpdate(Modal 异步路径),不直接 reload', () => {
        render(<MobileMenuDrawer />)
        const drawer = document.querySelector('[data-testid="drawer"]')!
        const checkSpan = Array.from(drawer.querySelectorAll('span'))
            .find(s => s.textContent === 'nav.checkUpdate')
        expect(checkSpan).toBeTruthy()

        act(() => {
            fireEvent.click(checkSpan!)
        })

        expect(checkUpdate).toHaveBeenCalledTimes(1)
        // 检查更新不直接 reload(由 Modal 确认后的 forceUpdateAndReload 异步触发)
        expect(reloadSpy).not.toHaveBeenCalled()
    })
})
