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
     * 是否已认证（驱动路由守卫 / SSE 连接 / HTTP 请求 / socket.io terminal）。
     * 不持久化 —— cookie（httpOnly）是登录态真源，启动时调 /api/auth/status 判定。
     * socket.io terminal 同源走 httpOnly cookie，无需内存 token。
     */
    authenticated: boolean
    /** 登录成功：置 authenticated（cookie 由 Set-Cookie 写入浏览器，无需内存 token） */
    setAuthenticated: (v: boolean) => void
    logout: () => void
    // 获取 baseUrl（始终是当前页面的 origin）
    getBaseUrl: () => string
}

export const useAuthStore = create<AuthState>()((set, _get) => ({
    authenticated: false,
    setAuthenticated: (v) => set({ authenticated: v }),
    logout: () => set({ authenticated: false }),
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
