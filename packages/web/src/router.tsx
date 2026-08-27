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

import { lazy, type ComponentType } from 'react'
import { createRootRoute, createRoute, createRouter, redirect } from '@tanstack/react-router'
import { App } from './App'

// 页面组件用 React.lazy 拆成独立 chunk，把 chat/bubble/toolcard/markdown/editor 等
// 重依赖移出主入口 bundle——首屏（尤其登录路径）只下 react+antd+providers+router 基础包。
// App（root，含 SSEProvider）保持 eager（所有路由共用）兜 root 级懒加载（LoginPage/MainLayout 自身），
// MainLayout 内层再兜页面级懒加载（跳转时侧边栏不闪、只有内容区出 loading）。

/** 路由 chunk 加载器：动态 import + 页面的具名导出名 */
interface RouteChunkLoader {
    load: () => Promise<unknown>
    pick: string
}

// 路由 chunk 加载器表：React.lazy 与空闲预取（prefetchRouteChunks）共用同一批 import()，
// 保证预取拉到的 URL 就是路由真正要的 chunk，后续导航命中 HTTP 缓存毫秒级返回。
// 页面均为具名导出，mount 时由 lazyRoute 适配 React.lazy 的 default 约定。
export const routeChunkLoaders = {
    LoginPage: { load: () => import('./pages/LoginPage'), pick: 'LoginPage' },
    MainLayout: { load: () => import('./components/layout/MainLayout'), pick: 'MainLayout' },
    SessionsLayout: { load: () => import('./pages/SessionsLayout'), pick: 'SessionsLayout' },
    SessionDetailPage: { load: () => import('./pages/SessionDetailPage'), pick: 'SessionDetailPage' },
    NewSessionPage: { load: () => import('./pages/NewSessionPage'), pick: 'NewSessionPage' },
    SettingsLayout: { load: () => import('./pages/SettingsPage'), pick: 'SettingsLayout' },
    NotificationsSection: { load: () => import('./components/settings/sections/NotificationsSection'), pick: 'NotificationsSection' },
    SettingsIndex: { load: () => import('./components/settings/sections/SettingsIndex'), pick: 'SettingsIndex' },
    WebToolsSection: { load: () => import('./components/settings/sections/WebToolsSection'), pick: 'WebToolsSection' },
    DebugSectionRoute: { load: () => import('./components/settings/sections/DebugSectionRoute'), pick: 'DebugSectionRoute' },
} satisfies Record<string, RouteChunkLoader>

// 具名导出 → React.lazy 的 default 约定适配
const lazyRoute = (loader: RouteChunkLoader) =>
    lazy(async () => {
        const mod = (await loader.load()) as Record<string, ComponentType>
        return { default: mod[loader.pick] }
    })

/**
 * 空闲预取全部路由 chunk：认证判定通过后由 App 在浏览器空闲时调用一次。
 * 单个 chunk 预取失败静默——真正导航时 React.lazy 会重新发起加载，走既有 loading 兜底。
 */
export async function prefetchRouteChunks(): Promise<void> {
    await Promise.all(
        Object.values(routeChunkLoaders).map((loader) =>
            loader.load().catch(() => {
                // 静默：预取是锦上添花，失败不应打扰用户
            }),
        ),
    )
}

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
