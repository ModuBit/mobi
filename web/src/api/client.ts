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

import { useMemo } from 'react'
import axios, { type AxiosInstance, type AxiosError } from 'axios'
import type { Session, DecryptedMessage } from './types'

// 全局 401 处理回调（由外部设置）
let onUnauthorized: (() => void) | null = null
let isHandling401 = false // 防止重复调用

/**
 * 设置 401 未授权回调
 * 当 API 请求返回 401 时，会调用此回调
 * @returns 清理函数，调用后移除回调
 */
export function setUnauthorizedHandler(handler: () => void): () => void {
    onUnauthorized = () => {
        // 防止重复调用（短时间内多个 401 响应）
        if (isHandling401) return
        isHandling401 = true

        try {
            handler()
        } finally {
            // 延迟重置，防止短时间内重复触发
            setTimeout(() => {
                isHandling401 = false
            }, 1000)
        }
    }

    // 返回清理函数
    return () => {
        onUnauthorized = null
    }
}

// 创建 API 客户端（使用当前页面的 origin）
export function createApiClient(token: string | null): AxiosInstance {
    const client = axios.create({
        baseURL: window.location.origin,
        headers: {
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
            'Content-Type': 'application/json'
        }
    })

    // 响应拦截器：处理 401 未授权
    client.interceptors.response.use(
        (response) => response,
        (error: AxiosError) => {
            if (error.response?.status === 401 && onUnauthorized) {
                onUnauthorized()
            }
            return Promise.reject(error)
        }
    )

    return client
}

// 创建 Mobi API 对象
export function createMobiApi(token: string | null) {
    const client = createApiClient(token)

    return {
        // Auth
        auth: {
            exchangeToken: (accessToken: string) =>
                client.post<{ token: string; user: { id: number; firstName: string } }>('/api/auth', { accessToken }),
        },

        // Sessions
        sessions: {
            list: () => client.get<{ sessions: Session[] }>('/api/sessions'),
            get: (sessionId: string) => client.get<Session>(`/api/sessions/${sessionId}`),
            create: (path: string) => client.post<Session>('/api/sessions', { path }),
            delete: (sessionId: string) => client.delete(`/api/sessions/${sessionId}`),
            setPermissionMode: (sessionId: string, mode: string) =>
                client.post(`/api/sessions/${sessionId}/permission-mode`, { mode }),
            setModelMode: (sessionId: string, mode: string) =>
                client.post(`/api/sessions/${sessionId}/model-mode`, { mode }),
        },

        // Messages
        messages: {
            list: (sessionId: string, params?: { before?: number; limit?: number }) =>
                client.get<{ messages: DecryptedMessage[] }>(`/api/sessions/${sessionId}/messages`, { params }),
            send: (sessionId: string, text: string, localId?: string) =>
                client.post(`/api/sessions/${sessionId}/messages`, { text, localId }),
        },

        // Git
        git: {
            status: (sessionId: string) =>
                client.get(`/api/sessions/${sessionId}/git/status`),
            diff: (sessionId: string, filePath?: string) =>
                client.get(`/api/sessions/${sessionId}/git/diff`, { params: { path: filePath } }),
        },

        // Files (via RPC)
        files: {
            list: (sessionId: string, path: string) =>
                client.post(`/api/sessions/${sessionId}/rpc/list-directory`, { path }),
            read: (sessionId: string, path: string) =>
                client.post(`/api/sessions/${sessionId}/rpc/read-file`, { path }),
        },

        // Permissions
        permissions: {
            approve: (sessionId: string, requestId: string) =>
                client.post(`/api/sessions/${sessionId}/permissions/${requestId}/approve`),
            deny: (sessionId: string, requestId: string) =>
                client.post(`/api/sessions/${sessionId}/permissions/${requestId}/deny`),
        },

        // Events (SSE)
        events: {
            subscribeUrl: (namespace: string, token: string) =>
                `${window.location.origin}/api/events?namespace=${namespace}&token=${token}`,
        },

        // Push notifications
        push: {
            getVapidKey: () => client.get<{ publicKey: string }>('/api/push/vapid-key'),
            subscribe: (subscription: PushSubscriptionJSON) =>
                client.post('/api/push/subscribe', subscription),
        },
    }
}

export type MobiApi = ReturnType<typeof createMobiApi>

/**
 * React Hook: 获取缓存的 Mobi API 实例
 * 只在 token 变化时重建 API 客户端
 */
export function useMobiApi(token: string | null): MobiApi {
    return useMemo(() => createMobiApi(token), [token])
}
