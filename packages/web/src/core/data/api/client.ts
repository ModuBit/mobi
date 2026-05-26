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
import type { Session, DecryptedMessage, MessagesResponse, SessionGroup, SessionGroupsResponse, GroupSessionsResponse, Machine, ListDirectoryResponse, ListFilesResponse } from './types'

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
            get: (sessionId: string) => client.get<{ session: Session }>(`/api/sessions/${sessionId}`),
            create: (path: string) => client.post<Session>('/api/sessions', { path }),
            delete: (sessionId: string) => client.delete(`/api/sessions/${sessionId}`),
            setPermissionMode: (sessionId: string, mode: string) =>
                client.post(`/api/sessions/${sessionId}/permission-mode`, { mode }),
            setModelMode: (sessionId: string, mode: string) =>
                client.post(`/api/sessions/${sessionId}/model`, { model: mode }),
            setEffort: (sessionId: string, effort: string) =>
                client.post(`/api/sessions/${sessionId}/effort`, { effort }),
            // 会话操作
            archive: (sessionId: string) => client.post(`/api/sessions/${sessionId}/archive`),
            abort: (sessionId: string) => client.post(`/api/sessions/${sessionId}/abort`),
            switch: (sessionId: string) => client.post(`/api/sessions/${sessionId}/switch`),
            resume: (sessionId: string) => client.post<{ sessionId: string }>(`/api/sessions/${sessionId}/resume`),
            // 停止后台任务
            stopTask: (sessionId: string, taskId: string) =>
                client.post(`/api/sessions/${sessionId}/stop-task`, { taskId }),
            rename: (sessionId: string, name: string) => client.patch(`/api/sessions/${sessionId}`, { name }),
            // 上传文件
            upload: (sessionId: string, filename: string, content: string, mimeType: string) =>
                client.post(`/api/sessions/${sessionId}/upload`, { filename, content, mimeType }),
            deleteUpload: (sessionId: string, path: string) =>
                client.post(`/api/sessions/${sessionId}/upload/delete`, { path }),
            // SDK 元数据（commands, models, agents, account 等）
            metadata: (sessionId: string) => client.get(`/api/sessions/${sessionId}/metadata`),
            // 文件搜索和目录列表（@ 引用）
            searchFiles: (sessionId: string, query: string, opts?: { signal?: AbortSignal }) =>
                client.get<ListFilesResponse>(`/api/sessions/${sessionId}/search-files`, { params: { query }, signal: opts?.signal }),
            listDirectory: (sessionId: string, path: string, opts?: { signal?: AbortSignal }) =>
                client.get<ListFilesResponse>(`/api/sessions/${sessionId}/list-directory`, { params: { path }, signal: opts?.signal }),
        },

        // Messages
        messages: {
            list: (sessionId: string, params?: { beforeSeq?: number; limit?: number }) =>
                client.get<MessagesResponse>(`/api/sessions/${sessionId}/messages`, { params }),
            send: (sessionId: string, text: string, localId?: string) =>
                client.post(`/api/sessions/${sessionId}/messages`, { text, localId }),
            sidechain: (sessionId: string, parentToolUseId: string, opts?: { signal?: AbortSignal }) =>
                client.get<{ messages: DecryptedMessage[] }>(`/api/sessions/${sessionId}/sidechain-messages`, {
                    params: { parentToolUseId },
                    signal: opts?.signal,
                }),
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
            approve: (sessionId: string, requestId: string, body?: {
                mode?: string
                allowTools?: string[]
                decision?: string
                answers?: Record<string, string | string[]> | Record<string, { answers: string[] }>
            }) =>
                client.post(`/api/sessions/${sessionId}/permissions/${requestId}/approve`, body),
            deny: (sessionId: string, requestId: string, body?: { decision?: string; reason?: string }) =>
                client.post(`/api/sessions/${sessionId}/permissions/${requestId}/deny`, body),
        },

        // Events (SSE)
        events: {
            subscribeUrl: (namespace: string, token: string) =>
                `${window.location.origin}/api/events?namespace=${namespace}&token=${token}`,
        },

        // Visibility
        visibility: {
            report: (subscriptionId: string, visibility: 'visible' | 'hidden') =>
                client.post('/api/visibility', { subscriptionId, visibility }),
        },

        // Push notifications
        push: {
            getVapidKey: () => client.get<{ publicKey: string }>('/api/push/vapid-key'),
            subscribe: (subscription: PushSubscriptionJSON) =>
                client.post('/api/push/subscribe', subscription),
        },

        // Session Groups
        sessionGroups: {
            list: () => client.get<SessionGroupsResponse>('/api/session-groups'),
            getSessions: (groupKey: string, cursor?: number, limit?: number) =>
                client.get<GroupSessionsResponse>('/api/session-groups/sessions', {
                    params: {
                        groupKey,
                        ...(cursor !== undefined && { cursor }),
                        limit: limit ?? 20
                    }
                }),
        },

        // Machines
        machines: {
            list: () => client.get<{ machines: Machine[] }>('/api/machines'),
            spawn: (machineId: string, directory: string, agent?: string, model?: string, yolo?: boolean, sessionType?: string, worktreeName?: string, effort?: string) =>
                client.post(`/api/machines/${machineId}/spawn`, { directory, agent, model, yolo, sessionType, worktreeName, effort }),
            checkPathsExist: (machineId: string, paths: string[]) =>
                client.post<{ exists: Record<string, boolean> }>(`/api/machines/${machineId}/paths/exists`, { paths }),
            listDirectory: (machineId: string, path: string, opts?: { signal?: AbortSignal }) =>
                client.get<ListDirectoryResponse>(`/api/machines/${machineId}/list-directory`, { params: { path }, signal: opts?.signal }),
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
