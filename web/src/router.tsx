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

import { createRootRoute, createRoute, createRouter } from '@tanstack/react-router'
import { App } from './App'
import { LoginPage } from './pages/LoginPage'
import { MainLayout } from './components/layout/MainLayout'

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

// 主布局路由
const mainRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/',
    component: MainLayout,
})

// 会话详情页
const sessionRoute = createRoute({
    getParentRoute: () => mainRoute,
    path: 'sessions/$sessionId',
})

// Create router
export const router = createRouter({
    routeTree: rootRoute.addChildren([
        loginRoute,
        mainRoute.addChildren([
            sessionRoute,
        ]),
    ]),
})

// Type declaration for router
declare module '@tanstack/react-router' {
    interface Register {
        router: typeof router
    }
}
