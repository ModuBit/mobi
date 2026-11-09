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
import { render, screen, cleanup, fireEvent } from '@testing-library/react'

/** 媒体查询开关：true=PC（≥992px），false=mobile */
const mediaMatches = { value: true }
vi.mock('@/core/data/hooks/useMediaQuery', () => ({
    useMediaQuery: () => mediaMatches.value,
}))
// 票04 头部收敛后 SettingsPage 不再消费 PageHeader/SidebarToggle/汉堡钮；
// sidebar-toggle / mobile-menu 测试桩保留，用于断言「设置视图内不再出现」
vi.mock('@/features/layout/SidebarToggle', () => ({ SidebarToggle: () => <button data-testid="sidebar-toggle" /> }))
vi.mock('@/features/layout/mobileMenu', () => ({ MobileMenuButton: () => <button data-testid="mobile-menu" /> }))
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (k: string) => k }) }))
// 锁定调试分区未解锁态，避免受其它用例 localStorage 污染
vi.mock('@/core/lib/debug', () => ({ isDebugUnlocked: () => false }))
// PC 分区导航的 Web 工具徽标依赖 react-query，测试树无 QueryClientProvider——mock 到状态摘要层
vi.mock('@/core/data/hooks/queries/useWebToolsStatus', () => ({
    useWebToolsStatus: () => 'unconfigured',
}))

import { SettingsPage } from '@/pages/SettingsPage'
import {
    createMemoryHistory,
    createRouter,
    createRootRoute,
    RouterProvider,
    createRoute,
    Outlet,
} from '@tanstack/react-router'

/** 用内存路由渲染 SettingsPage（RouterProvider mount 异步，用 findBy* 等待路由 commit） */
async function renderLayout(path: string) {
    const root = createRootRoute({ component: Outlet })
    const layout = createRoute({ getParentRoute: () => root, path: 'settings', component: SettingsPage })
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
}

afterEach(() => cleanup())

describe('SettingsPage 响应式壳', () => {
    it('PC（≥992px）：全屏接管壳——返回键 + 搜索框 + 分组导航与子内容', async () => {
        mediaMatches.value = true
        await renderLayout('/settings/notifications')
        // 等子路由 Outlet 内容出现（RouterProvider 异步 commit）后再断言
        expect(await screen.findByTestId('child-outlet')).toBeTruthy()
        expect(screen.getByText('settings.sections.notifications.title')).toBeTruthy()
        expect(screen.getByText('settings.sections.webTools.title')).toBeTruthy()
        // debug 入口默认不可见（未解锁）
        expect(screen.queryByText('settings.sections.debug.title')).toBeNull()
        // 接管壳三件：返回键 / 分区搜索 / 分组标题
        expect(screen.getByRole('button', { name: 'common.back' })).toBeTruthy()
        expect(screen.getByRole('textbox', { name: 'settings.search' })).toBeTruthy()
        expect(screen.getByText('settings.groups.general.title')).toBeTruthy()
        expect(screen.getByText('settings.groups.tools.title')).toBeTruthy()
    })

    it('PC 搜索过滤：关键词过滤分区，空态提示', async () => {
        mediaMatches.value = true
        await renderLayout('/settings/notifications')
        expect(await screen.findByTestId('child-outlet')).toBeTruthy()
        const search = screen.getByRole('textbox', { name: 'settings.search' })
        // i18n mock 下 titleKey 即文案，'notifications' 命中通知分区
        fireEvent.change(search, { target: { value: 'notifications' } })
        expect(screen.getByText('settings.sections.notifications.title')).toBeTruthy()
        expect(screen.queryByText('settings.sections.webTools.title')).toBeNull()
        // 无命中 → 空态提示、分区行全部消失
        fireEvent.change(search, { target: { value: '不存在的关键词xyz' } })
        expect(screen.getByText('settings.searchEmpty')).toBeTruthy()
        expect(screen.queryByText('settings.sections.notifications.title')).toBeNull()
    })

    it('mobile（<992px）：不渲染分区导航，渲染子内容 + 返回键', async () => {
        mediaMatches.value = false
        await renderLayout('/settings/notifications')
        expect(await screen.findByTestId('child-outlet')).toBeTruthy()
        expect(screen.queryByText('settings.sections.webTools.title')).toBeNull()
        // debug 入口默认不可见（未解锁）
        expect(screen.queryByText('settings.sections.debug.title')).toBeNull()
        expect(screen.getByRole('button', { name: 'common.back' })).toBeTruthy()
    })

    it('mobile 未知子路由段：回入口态标题（settings.title），不崩溃；返回键离开设置而非回列表', async () => {
        mediaMatches.value = false
        // fuzzy notFoundMode 下 layout 仍渲染，activeSectionId 对未知段须返回 null 而非类型谎言。
        // 票04 头部收敛：返回键恒在（入口态语义 = 离开设置），无汉堡并存
        await renderLayout('/settings/foo')
        expect(await screen.findByText('settings.title')).toBeTruthy()
        expect(screen.getByRole('button', { name: 'common.back' })).toBeTruthy()
        expect(screen.queryByTestId('mobile-menu')).toBeNull()
        expect(screen.queryByTestId('sidebar-toggle')).toBeNull()
    })
})
