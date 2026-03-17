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

import { createRootRoute, createRoute, createRouter, redirect, Outlet } from '@tanstack/react-router'
import { App } from './App'
import { LoginPage } from './pages/LoginPage'
import { MainLayout } from './components/layout/MainLayout'
import { SessionsPage } from './pages/SessionsPage'
import { SessionDetailPage } from './pages/SessionDetailPage'
import { SettingsPage } from './pages/SettingsPage'

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

// 索引路由 - 重定向到会话列表
const indexRoute = createRoute({
    getParentRoute: () => mainLayoutRoute,
    path: '/',
    beforeLoad: () => {
        throw redirect({ to: '/sessions' })
    },
})

// 会话列表页
const sessionsRoute = createRoute({
    getParentRoute: () => mainLayoutRoute,
    path: 'sessions',
    component: SessionsPage,
})

// 会话详情页
const sessionDetailRoute = createRoute({
    getParentRoute: () => mainLayoutRoute,
    path: 'sessions/$sessionId',
    component: SessionDetailPage,
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
            sessionsRoute,
            sessionDetailRoute,
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
