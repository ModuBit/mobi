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

/** 媒体查询开关：true=PC（≥992px），false=mobile */
const mediaMatches = { value: true }
vi.mock('@/core/data/hooks/useMediaQuery', () => ({
    useMediaQuery: () => mediaMatches.value,
}))
vi.mock('@/components/layout/PageHeader', () => ({
    PageHeader: ({ left }: { left: React.ReactNode }) => <header data-testid="page-header">{left}</header>,
}))
vi.mock('@/components/layout/SidebarToggle', () => ({ SidebarToggle: () => <button data-testid="sidebar-toggle" /> }))
vi.mock('@/components/layout/MobileMenu', () => ({ MobileMenuButton: () => <button data-testid="mobile-menu" /> }))
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (k: string) => k }) }))
// 锁定调试分区未解锁态，避免受其它用例 localStorage 污染
vi.mock('@/core/lib/debug', () => ({ isDebugUnlocked: () => false }))

import { SettingsLayout } from '@/pages/SettingsPage'
import { SETTINGS_SECTIONS } from '@/components/settings/sections/registry'
import {
    createMemoryHistory,
    createRouter,
    createRootRoute,
    RouterProvider,
    createRoute,
    Outlet,
} from '@tanstack/react-router'

/** 用内存路由渲染 SettingsLayout（RouterProvider mount 异步，返回 findBy* 等待路由 commit） */
async function renderLayout(path: string) {
    const root = createRootRoute({ component: Outlet })
    const layout = createRoute({ getParentRoute: () => root, path: 'settings', component: SettingsLayout })
    const child = createRoute({
        getParentRoute: () => layout,
        path: 'notifications',
        component: () => <div data-testid="child-outlet" />,
    })
    const router = createRouter({
        routeTree: root.addChildren([layout.addChildren([child])]),
        history: createMemoryHistory({ initialEntries: [path] }),
    })
    render(<RouterProvider router={router} />)
    // 等子路由 Outlet 内容出现（RouterProvider 异步 commit）
    await screen.findByTestId('child-outlet')
}

afterEach(() => cleanup())

describe('SettingsLayout 响应式壳', () => {
    it('PC（≥992px）：渲染分区导航与子内容', async () => {
        mediaMatches.value = true
        await renderLayout('/settings/notifications')
        expect(screen.getByText('settings.sections.notifications.title')).toBeTruthy()
        expect(screen.getByText('settings.sections.webTools.title')).toBeTruthy()
        expect(screen.getByTestId('child-outlet')).toBeTruthy()
    })

    it('mobile（<992px）：不渲染分区导航，渲染子内容 + 返回键', async () => {
        mediaMatches.value = false
        await renderLayout('/settings/notifications')
        expect(screen.queryByText('settings.sections.webTools.title')).toBeNull()
        expect(screen.getByTestId('child-outlet')).toBeTruthy()
        expect(screen.getByRole('button', { name: 'common.back' })).toBeTruthy()
    })

    it('debug 分区默认不可见', async () => {
        mediaMatches.value = true
        await renderLayout('/settings/notifications')
        expect(SETTINGS_SECTIONS.find((s) => s.id === 'debug')!.visible()).toBe(false)
    })
})
