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
import { SessionsLayout } from './pages/SessionsLayout'
import { SessionDetailPage } from './pages/SessionDetailPage'
import { NewSessionPage } from './pages/NewSessionPage'
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

// 索引路由 - 重定向到新对话
const indexRoute = createRoute({
    getParentRoute: () => mainLayoutRoute,
    path: '/',
    beforeLoad: () => {
        throw redirect({ to: '/sessions/new' })
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
        throw redirect({ to: '/sessions/new' })
    },
})

// 会话详情页
const sessionDetailRoute = createRoute({
    getParentRoute: () => sessionsLayoutRoute,
    path: '$sessionId',
    component: SessionDetailPage,
})

// 新建会话页
const newSessionRoute = createRoute({
    getParentRoute: () => mainLayoutRoute,
    path: 'sessions/new',
    component: NewSessionPage,
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
