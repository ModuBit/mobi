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
import { useEffect } from 'react'
import { setUnauthorizedHandler } from '@/core/data/api/client'
import { ErrorBoundary } from '@/components/ui/ErrorBoundary'

export function App() {
    const { token, logout } = useAuthStore()
    const navigate = useNavigate()
    const location = useLocation()

    // 设置 401 未授权处理器
    useEffect(() => {
        const cleanup = setUnauthorizedHandler(() => {
            // 清理登录态
            logout()
            // 跳转到登录页
            navigate({ to: '/login' })
        })
        return cleanup // 组件卸载时清理
    }, [logout, navigate])

    // 自动重定向到登录页
    useEffect(() => {
        if (!token && location.pathname !== '/login') {
            navigate({ to: '/login' })
        } else if (token && location.pathname === '/login') {
            navigate({ to: '/' })
        }
    }, [token, location.pathname, navigate])

    return (
        <ErrorBoundary>
            <SSEProvider>
                <Outlet />
            </SSEProvider>
        </ErrorBoundary>
    )
}
