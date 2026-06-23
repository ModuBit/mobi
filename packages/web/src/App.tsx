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

import { Outlet } from '@tanstack/react-router'
import { SSEProvider } from '@/core/providers/SSEProvider'
import { useAuthStore } from '@/core/data/stores/authStore'
import { useNavigate, useLocation } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { setUnauthorizedHandler, createApiClient, useMobiApi } from '@/core/data/api/client'
import { ErrorBoundary } from '@/components/ui/ErrorBoundary'

export function App() {
    const { authenticated, logout } = useAuthStore()
    // 启动态：cookie 是登录态真源，authenticated 不持久化，启动时调 /api/auth/status 判定
    const [bootstrapped, setBootstrapped] = useState(false)
    const navigate = useNavigate()
    const location = useLocation()
    const api = useMobiApi()

    // 启动认证检查：根据 httpOnly cookie 是否有效恢复 authenticated flag
    useEffect(() => {
        let cancelled = false
        createApiClient()
            .get<{ authenticated: boolean }>('/api/auth/status')
            .then((res) => {
                if (cancelled) return
                if (res.data?.authenticated) {
                    // cookie 有效但 authenticated 尚未置位（刷新后内存丢失）
                    // cookie httpOnly 无法读出 token，但 socket.io terminal 同源自动携带 cookie（C-T3 闭环），
                    // 刷新后 terminal 不依赖内存 token，此处仅恢复 authenticated 以驱动路由/SSE
                    useAuthStore.setState({ authenticated: true })
                }
            })
            .catch(() => {
                // status 查询失败视为未认证
            })
            .finally(() => {
                if (!cancelled) setBootstrapped(true)
            })
        return () => { cancelled = true }
    }, [])

    // 设置 401 未授权处理器
    useEffect(() => {
        const cleanup = setUnauthorizedHandler(() => {
            // 先清服务端 httpOnly cookie（cookie 链路下 JS 清不了，必须 POST /api/auth/logout），
            // 再清内存 authenticated flag。两步缺一：cookie 残留 → bootstrap status 重新认证 → 登录循环。
            // 对齐 SidebarFooter.tsx / MobileMenu.tsx 的登出按钮做法。
            api.auth.logout().catch(() => {}).finally(() => {
                logout()
                navigate({ to: '/login' })
            })
        })
        return cleanup // 组件卸载时清理
    }, [api, logout, navigate])

    // 自动重定向到登录页（等启动认证检查完成后再判定，避免刷新瞬间闪登录页）
    useEffect(() => {
        if (!bootstrapped) return
        if (!authenticated && location.pathname !== '/login') {
            navigate({ to: '/login' })
        } else if (authenticated && location.pathname === '/login') {
            navigate({ to: '/' })
        }
    }, [authenticated, bootstrapped, location.pathname, navigate])

    return (
        <ErrorBoundary>
            <SSEProvider>
                <Outlet />
            </SSEProvider>
        </ErrorBoundary>
    )
}
