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

import { lazy } from 'react'
import { createRootRoute, createRoute, createRouter, redirect } from '@tanstack/react-router'
import { App } from './App'

// 页面组件用 React.lazy 拆成独立 chunk，把 chat/bubble/toolcard/markdown/editor 等
// 重依赖移出主入口 bundle——首屏（尤其登录路径）只下 react+antd+providers+router 基础包。
// App（root，含 SSEProvider）保持 eager（所有路由共用），并在 App 内用 Suspense 兜住懒加载。
// 页面均为具名导出，故用 .then(m => ({ default: m.X })) 适配 React.lazy 的 default 约定。
const LoginPage = lazy(() => import('./pages/LoginPage').then((m) => ({ default: m.LoginPage })))
const MainLayout = lazy(() =>
    import('./components/layout/MainLayout').then((m) => ({ default: m.MainLayout })),
)
const SessionsLayout = lazy(() =>
    import('./pages/SessionsLayout').then((m) => ({ default: m.SessionsLayout })),
)
const SessionDetailPage = lazy(() =>
    import('./pages/SessionDetailPage').then((m) => ({ default: m.SessionDetailPage })),
)
const NewSessionPage = lazy(() =>
    import('./pages/NewSessionPage').then((m) => ({ default: m.NewSessionPage })),
)
const SettingsPage = lazy(() =>
    import('./pages/SettingsPage').then((m) => ({ default: m.SettingsPage })),
)

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

// 设置页
const settingsRoute = createRoute({
    getParentRoute: () => mainLayoutRoute,
    path: 'settings',
    component: SettingsPage,
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
            settingsRoute,
        ]),
    ]),
})

// Type declaration for router
declare module '@tanstack/react-router' {
    interface Register {
        router: typeof router
    }
}
