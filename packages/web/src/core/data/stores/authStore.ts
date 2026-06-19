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
import { persist } from 'zustand/middleware'

interface AuthState {
    token: string | null
    setToken: (token: string | null) => void
    logout: () => void
    // 获取 baseUrl（始终是当前页面的 origin）
    getBaseUrl: () => string
}

export const useAuthStore = create<AuthState>()(
    persist(
        (set, _get) => ({
            token: null,
            setToken: (token) => set({ token }),
            logout: () => set({ token: null }),
            getBaseUrl: () => window.location.origin,
        }),
        {
            name: 'mobi-auth',
            // 只持久化 token，不持久化 baseUrl
            partialize: (state) => ({ token: state.token }),
        }
    )
)

// 便捷函数：直接返回 baseUrl（非 hook，可在任意位置调用）
export function getBaseUrl() {
    return window.location.origin
}

// 向后兼容：保留 hook 形式导出
export function useBaseUrl() {
    return getBaseUrl()
}
