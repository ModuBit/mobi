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

import { createRootRoute, createRoute, createRouter, redirect } from '@tanstack/react-router'
import { App } from './App'
import { lazyRoute, routeChunkLoaders } from '@/core/lib/routeChunks'

// 页面组件用 React.lazy 拆成独立 chunk（加载器与预取定义见 @/core/lib/routeChunks，
// 该模块独立存在以避免 App ↔ router 循环依赖）。App（root，含 SSEProvider）保持
// eager（所有路由共用）兜 root 级懒加载（LoginPage/MainLayout 自身），
// MainLayout 内层再兜页面级懒加载（跳转时侧边栏不闪、只有内容区出 loading）。

const LoginPage = lazyRoute(routeChunkLoaders.LoginPage)
const MainLayout = lazyRoute(routeChunkLoaders.MainLayout)
const SessionsLayout = lazyRoute(routeChunkLoaders.SessionsLayout)
const SessionDetailPage = lazyRoute(routeChunkLoaders.SessionDetailPage)
const NewSessionPage = lazyRoute(routeChunkLoaders.NewSessionPage)
const SettingsLayout = lazyRoute(routeChunkLoaders.SettingsLayout)
const NotificationsSection = lazyRoute(routeChunkLoaders.NotificationsSection)
const SettingsIndex = lazyRoute(routeChunkLoaders.SettingsIndex)
const WebToolsSection = lazyRoute(routeChunkLoaders.WebToolsSection)
const DebugSectionRoute = lazyRoute(routeChunkLoaders.DebugSectionRoute)

// Root route - wraps all routes with App component
const rootRoute = createRootRoute({
    component: App,
})

// 登录路由（无布局）
const loginRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/login',
    component: LoginPage,
})

// 主布局路由 - pathless layout route（不消耗 URL 路径）
const mainLayoutRoute = createRoute({
    getParentRoute: () => rootRoute,
    id: 'mainLayout',
    component: MainLayout,
})

// 索引路由 - 重定向到新对话
const indexRoute = createRoute({
    getParentRoute: () => mainLayoutRoute,
    path: '/',
    beforeLoad: () => {
        throw redirect({ to: '/sessions/new', search: {} })
    },
})

// 会话布局路由
const sessionsLayoutRoute = createRoute({
    getParentRoute: () => mainLayoutRoute,
    path: 'sessions',
    component: SessionsLayout,
})

// 会话索引路由 - 重定向到新对话
const sessionsIndexRoute = createRoute({
    getParentRoute: () => sessionsLayoutRoute,
    path: '/',
    beforeLoad: () => {
        throw redirect({ to: '/sessions/new', search: {} })
    },
})

// 会话详情页
const sessionDetailRoute = createRoute({
    getParentRoute: () => sessionsLayoutRoute,
    path: '$sessionId',
    component: SessionDetailPage,
})

// 新建会话页（?projectId= 预设归属项目；web 创建会话必须选项目，机器/目录由项目派生）
const newSessionRoute = createRoute({
    getParentRoute: () => mainLayoutRoute,
    path: 'sessions/new',
    component: NewSessionPage,
    validateSearch: (search: Record<string, unknown>): { projectId?: string } => ({
        projectId: (search.projectId as string) || undefined,
    }),
})

// 设置页 layout 路由（左侧分区导航 / mobile 子页由 SettingsLayout 响应式分流）
const settingsRoute = createRoute({
    getParentRoute: () => mainLayoutRoute,
    path: 'settings',
    component: SettingsLayout,
})
// 设置 index：PC 渲染默认分区（通知），mobile 渲染分组入口列表（SettingsIndex 内部分流）
const settingsIndexRoute = createRoute({
    getParentRoute: () => settingsRoute,
    path: '/',
    component: SettingsIndex,
})
// 通知与推送分区
const settingsNotificationsRoute = createRoute({
    getParentRoute: () => settingsRoute,
    path: 'notifications',
    component: NotificationsSection,
})
// Web 工具分区
const settingsWebToolsRoute = createRoute({
    getParentRoute: () => settingsRoute,
    path: 'web-tools',
    component: WebToolsSection,
})
// 调试分区（未解锁渲染空分区）
const settingsDebugRoute = createRoute({
    getParentRoute: () => settingsRoute,
    path: 'debug',
    component: DebugSectionRoute,
})

// Create router
export const router = createRouter({
    routeTree: rootRoute.addChildren([
        loginRoute,
        mainLayoutRoute.addChildren([
            indexRoute,
            sessionsLayoutRoute.addChildren([
                sessionsIndexRoute,
                sessionDetailRoute,
            ]),
            newSessionRoute,
            settingsRoute.addChildren([
                settingsIndexRoute,
                settingsNotificationsRoute,
                settingsWebToolsRoute,
                settingsDebugRoute,
            ]),
        ]),
    ]),
})

// Type declaration for router
declare module '@tanstack/react-router' {
    interface Register {
        router: typeof router
    }
}
