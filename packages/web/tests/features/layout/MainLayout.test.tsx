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

import { describe, expect, it, vi, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { createContext } from 'react'

// MainLayout 周边重依赖全部 mock（PWA / WCO / 布局位移观测），只留布局分支本体
vi.mock('@/core/data/hooks/useMediaQuery', () => ({ useIsMobile: () => false }))
vi.mock('@/features/layout/AppSidebar', () => ({ AppSidebar: () => <div data-testid="app-sidebar" /> }))
vi.mock('@/features/layout/mobileMenu', () => ({
    MobileMenuDrawer: () => <div data-testid="mobile-menu-drawer" />,
}))
vi.mock('@/features/layout/WcoTitleBar', () => ({
    WcoTitleBar: () => null,
    resolveChromeColor: () => '#ffffff',
}))
vi.mock('@/features/layout/useWindowControlsOverlay', () => ({
    useWindowControlsOverlay: () => false,
    WcoContext: createContext(false),
}))
vi.mock('@/core/pwa/registerSW', () => ({ registerServiceWorker: () => () => {} }))
vi.mock('@/core/pwa/useUpdateAvailable', () => ({
    useUpdateAvailable: () => null,
    setUpdateReload: vi.fn(),
}))
vi.mock('@/core/lib/layoutShiftObserver', () => ({ startLayoutShiftObserver: () => () => {} }))
vi.mock('react-i18next', () => ({
    useTranslation: () => ({ t: (k: string) => k }),
    // 导入链上的 i18n 配置模块会消费 initReactI18next
    initReactI18next: { type: '3rd-party', init: vi.fn() },
}))
vi.mock('react-helmet-async', () => ({ Helmet: ({ children }: { children?: React.ReactNode }) => <div>{children}</div> }))

import { MainLayout } from '@/features/layout/MainLayout'
import {
    createMemoryHistory,
    createRouter,
    createRootRoute,
    RouterProvider,
    createRoute,
    Outlet,
} from '@tanstack/react-router'

/** 内存路由渲染 MainLayout（mount 异步，findBy* 等待 commit） */
async function renderLayout(path: string) {
    const root = createRootRoute({ component: Outlet })
    // pathless layout route（与真实路由树同构：mainLayout 是 pathless）
    const layout = createRoute({ getParentRoute: () => root, id: 'mainLayout', component: MainLayout })
    const sessions = createRoute({
        getParentRoute: () => layout,
        path: 'sessions/new',
        component: () => <div data-testid="workspace-page" />,
    })
    const settings = createRoute({
        getParentRoute: () => layout,
        path: 'settings',
        component: Outlet,
    })
    const notifications = createRoute({
        getParentRoute: () => settings,
        path: 'notifications',
        component: () => <div data-testid="settings-page" />,
    })
    const router = createRouter({
        routeTree: root.addChildren([layout.addChildren([sessions, settings.addChildren([notifications])])]),
        history: createMemoryHistory({ initialEntries: [path] }),
    })
    render(<RouterProvider router={router} />)
}

afterEach(() => cleanup())

describe('MainLayout 设置路由族分支（全屏视图接管）', () => {
    it('工作区路由：主侧栏可见（contents），内容区带面板描边', async () => {
        await renderLayout('/sessions/new')
        expect(await screen.findByTestId('workspace-page')).toBeTruthy()
        const slot = screen.getByTestId('app-sidebar-slot')
        expect(slot.style.display).toBe('contents')
        const content = document.querySelector('.ant-layout-content') as HTMLElement
        expect(content.style.borderLeft).not.toBe('')
    })

    it('设置路由族：主侧栏让位（display:none 保挂载），内容区交由设置全屏接管（无面板描边）', async () => {
        await renderLayout('/settings/notifications')
        expect(await screen.findByTestId('settings-page')).toBeTruthy()
        const slot = screen.getByTestId('app-sidebar-slot')
        expect(slot.style.display).toBe('none')
        // 侧栏只是隐藏：AppSidebar 实例仍在文档中（零卸载，返回时零 refetch）
        expect(screen.getByTestId('app-sidebar')).toBeTruthy()
        const content = document.querySelector('.ant-layout-content') as HTMLElement
        expect(content.style.borderLeft).toBe('')
    })

    it('返回来源记录：落在工作区路由时写入 sessionStorage，设置路由不覆盖', async () => {
        sessionStorage.clear()
        await renderLayout('/sessions/new')
        expect(await screen.findByTestId('workspace-page')).toBeTruthy()
        expect(sessionStorage.getItem('settings.returnOrigin')).toBe('/sessions/new')
    })
})
