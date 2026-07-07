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
import type { Session, DecryptedMessage, MessagesResponse, SessionGroupsResponse, GroupSessionsResponse, Machine, ListDirectoryResponse, ListFilesResponse } from './types'

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
// cookie 链路：withCredentials 让浏览器自动随同源请求携带 httpOnly cookie，
// 不再手写 Authorization header（CORS credentials 配套见 hub server.ts）
export function createApiClient(): AxiosInstance {
    const client = axios.create({
        baseURL: window.location.origin,
        withCredentials: true,
        headers: {
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
export function createMobiApi() {
    const client = createApiClient()

    return {
        // Auth
        auth: {
            exchangeToken: (accessToken: string) =>
                client.post<{ token: string; user: { id: number; firstName: string } }>('/api/auth', { accessToken }),
            // 登出：清 httpOnly cookie（cookie 链路下必须服务端清，仅清内存 state 会在刷新后因 cookie 仍有效而自动恢复登录）
            logout: () => client.post('/api/auth/logout'),
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
            // 清理 runtimeState 指定字段
            clearRuntimeStateFields: (sessionId: string, clearFields: ('todos' | 'tasks' | 'backgroundTasks' | 'teamState')[]) =>
                client.patch(`/api/sessions/${sessionId}/runtime-state`, { clearFields }),
            rename: (sessionId: string, name: string) => client.patch(`/api/sessions/${sessionId}`, { name }),
            // 上传文件（二进制流式 + 进度 + 取消，替换 FormData→multipart）
            upload: (
                sessionId: string,
                file: File,
                opts?: { signal?: AbortSignal; onProgress?: (percent: number) => void },
            ) => client.post(`/api/sessions/${sessionId}/upload`, file, {
                headers: {
                    'Content-Type': 'application/octet-stream',
                    'X-Mobi-Filename': encodeURIComponent(file.name),
                },
                onUploadProgress: opts?.onProgress
                    ? (e) => opts.onProgress!(e.total ? Math.round((e.loaded / e.total) * 100) : 0)
                    : undefined,
                signal: opts?.signal,
            }),
            deleteUpload: (sessionId: string, path: string) =>
                client.post(`/api/sessions/${sessionId}/upload/delete`, { path }),
            // SDK 元数据（commands, models, agents, account 等）
            metadata: (sessionId: string) => client.get(`/api/sessions/${sessionId}/metadata`),
            // 文件搜索和目录列表（@ 引用）
            searchFiles: (
                sessionId: string,
                query: string,
                type?: 'file' | 'directory',
                opts?: { signal?: AbortSignal },
            ) =>
                client.get<ListFilesResponse>(`/api/sessions/${sessionId}/search-files`, { params: { query, type }, signal: opts?.signal }),
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
                client.get(`/api/sessions/${sessionId}/list-directory`, { params: { path } }),
            // read-file 为标准 HTTP 流式端点：返回原始二进制（非 base64 JSON），
            // headers 带 Content-Type/ETag/Content-Length/Accept-Ranges/Content-Disposition。
            // 用 arraybuffer 接收后包成 Blob，按 mime 在前端三分发（文本/图片/二进制）。
            // 304 协商命中时 axios 默认会 throw，这里放行让上层保持旧缓存。
            read: async (
                sessionId: string,
                path: string,
            ): Promise<{ blob: Blob; mime: string; etag?: string } | null> => {
                const res = await client.get(`/api/sessions/${sessionId}/read-file`, {
                    params: { path },
                    responseType: 'arraybuffer',
                    validateStatus: (s) => (s >= 200 && s < 300) || s === 304,
                })
                if (res.status === 304) return null
                const mime = (res.headers['content-type'] as string) ?? 'application/octet-stream'
                const etag = res.headers['etag'] as string | undefined
                const blob = new Blob([res.data as ArrayBuffer], { type: mime })
                return { blob, mime, etag }
            },
            // file-meta：轻量元数据（mime/size/etag），不拉文件体，
            // 供「代码高亮 P1」等场景按 mime 决定渲染策略、按 etag 做条件请求
            meta: (sessionId: string, path: string) =>
                client.get<{ success: boolean; meta?: { mime: string; size: number; etag: string }; error?: string }>(
                    `/api/sessions/${sessionId}/file-meta`,
                    { params: { path } },
                ),
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
            // cookie 链路：SSE 客户端 withCredentials 自动带 cookie，无需 query token
            subscribeUrl: (namespace: string) =>
                `${window.location.origin}/api/events?namespace=${namespace}`,
        },

        // Visibility
        visibility: {
            report: (subscriptionId: string, visibility: 'visible' | 'hidden') =>
                client.post('/api/visibility', { subscriptionId, visibility }),
        },

        // Push notifications
        push: {
            getVapidKey: () => client.get<{ publicKey: string }>('/api/push/vapid-public-key'),
            subscribe: (subscription: PushSubscriptionJSON) =>
                client.post('/api/push/subscribe', subscription),
            getSubscriptionStatus: () => client.get<{ subscribed: boolean }>('/api/push/subscription'),
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
            // SDK metadata（slash 命令）
            metadata: (machineId: string, cwd: string, opts?: { signal?: AbortSignal }) =>
                client.get(`/api/machines/${machineId}/metadata`, { params: { cwd }, signal: opts?.signal }),
            // 文件上传（二进制流式 + 进度 + 取消，cwd 走 header，替换 FormData→multipart）
            upload: (
                machineId: string,
                cwd: string,
                file: File,
                opts?: { signal?: AbortSignal; onProgress?: (percent: number) => void },
            ) => client.post(`/api/machines/${machineId}/upload`, file, {
                headers: {
                    'Content-Type': 'application/octet-stream',
                    'X-Mobi-Filename': encodeURIComponent(file.name),
                    'X-Mobi-Cwd': encodeURIComponent(cwd),
                },
                onUploadProgress: opts?.onProgress
                    ? (e) => opts.onProgress!(e.total ? Math.round((e.loaded / e.total) * 100) : 0)
                    : undefined,
                signal: opts?.signal,
            }),
            // 文件上传删除
            deleteUpload: (machineId: string, cwd: string, path: string) =>
                client.post(`/api/machines/${machineId}/upload/delete`, { cwd, path }),
            // 文件搜索（@ 引用）
            searchFiles: (machineId: string, cwd: string, query: string, opts?: { signal?: AbortSignal }) =>
                client.get<ListFilesResponse>(`/api/machines/${machineId}/search-files`, { params: { cwd, query }, signal: opts?.signal }),
            // 目录列表（@ 引用展开子目录）
            listSessionDirectory: (machineId: string, cwd: string, path: string, opts?: { signal?: AbortSignal }) =>
                client.get<ListFilesResponse>(`/api/machines/${machineId}/list-session-directory`, { params: { cwd, path }, signal: opts?.signal }),
        },
    }
}

export type MobiApi = ReturnType<typeof createMobiApi>

/**
 * React Hook: 获取缓存的 Mobi API 实例
 * cookie 链路下不再依赖 token，实例全局单例即可
 */
export function useMobiApi(): MobiApi {
    return useMemo(() => createMobiApi(), [])
}
