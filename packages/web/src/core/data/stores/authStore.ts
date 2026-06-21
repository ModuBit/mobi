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

import { create } from 'zustand'

interface AuthState {
    /**
     * 是否已认证（驱动路由守卫 / SSE 连接 / HTTP 请求）。
     * 不持久化 —— cookie（httpOnly）是登录态真源，启动时调 /api/auth/status 判定。
     */
    authenticated: boolean
    /**
     * JWT token（仅内存，不持久化）。
     * socket.io terminal 走 handshake.auth.token 认证（非 HTTP cookie），故保留此字段供其使用。
     * HTTP/SSE 不再用它（cookie 自动携带）。
     */
    token: string | null
    /** 登录成功：置 authenticated 并存 token（供 socket.io） */
    setAuthenticated: (token: string) => void
    logout: () => void
    // 获取 baseUrl（始终是当前页面的 origin）
    getBaseUrl: () => string
}

export const useAuthStore = create<AuthState>()((set, _get) => ({
    authenticated: false,
    token: null,
    setAuthenticated: (token) => set({ authenticated: true, token }),
    logout: () => set({ authenticated: false, token: null }),
    getBaseUrl: () => window.location.origin,
}))

// 便捷函数：直接返回 baseUrl（非 hook，可在任意位置调用）
export function getBaseUrl() {
    return window.location.origin
}

// 向后兼容：保留 hook 形式导出
export function useBaseUrl() {
    return getBaseUrl()
}
