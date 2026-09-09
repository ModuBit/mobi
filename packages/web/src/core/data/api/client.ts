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
import type { Session, DecryptedMessage, MessagesResponse, Machine, ListDirectoryResponse, ListFilesResponse, Project, ProjectFolder, ProjectSessionsResponse } from './types'
import type { PermissionAnswers, PermissionMode, PermissionUpdate, RedactedWebToolsConfig, WebToolsConfigSubmission, WebToolProviderId, StopKind, UserMessageContent } from '@mobi/shared'
import type { ReadFileMetaResponse } from '@mobi/shared/fileMeta'

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

/**
 * 从请求异常中提取服务端下发的业务错误文案。
 * axios 对非 2xx 抛 AxiosError，其 message 只有笼统的「Request failed with status code N」；
 * hub 的错误响应 body 恒为 { success:false, error }，把真实原因（如读边界的
 * 「Access denied: ... protected directory」）提取出来供 UI 直接展示。
 */
export function extractApiError(error: unknown): string {
    if (axios.isAxiosError(error)) {
        const data = error.response?.data as { error?: string } | undefined
        if (data?.error) return data.error
    }
    if (error instanceof Error) return error.message
    // duck-typed 错误对象（非 Error 实例但带 message，如测试构造/非 axios 封装）
    const message = (error as { message?: unknown } | null)?.message
    if (typeof message === 'string' && message) return message
    // 其余抛出值直接文本化，保底空串回退
    return String(error ?? '') || 'Request failed'
}

/**
 * 把请求异常转成带真实文案的 Error（cause 保留原异常），供 queryFn rethrow——
 * react-query 的 error.message 即为 UI 可直接展示的服务端原因。
 */
export function toApiError(error: unknown): Error {
    return Object.assign(new Error(extractApiError(error)), { cause: error })
}

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
            switchOutputStyle: (sessionId: string, style: string) =>
                client.post(`/api/sessions/${sessionId}/output-style`, { style }),
            // 会话操作
            archive: (sessionId: string) => client.post(`/api/sessions/${sessionId}/archive`),
            // 中断会话：stopKind 三档停止（缺省 'turn' 只停本轮，hub 侧同款缺省语义）
            abort: (sessionId: string, stopKind?: StopKind) =>
                client.post(`/api/sessions/${sessionId}/abort`, { stopKind }),
            switch: (sessionId: string) => client.post(`/api/sessions/${sessionId}/switch`),
            resume: (sessionId: string) => client.post<{ sessionId: string }>(`/api/sessions/${sessionId}/resume`),
            // 停止后台任务
            stopTask: (sessionId: string, taskId: string) =>
                client.post(`/api/sessions/${sessionId}/stop-task`, { taskId }),
            // rewind 预检：校验 transcript 锚点存在性 + 文件快照可恢复性（结果驱动确认弹窗三形态）；
            // reason 为 CLI 拒绝原因（链首 /clear 引导等，经 rewindRejectReasonKey 映射文案）
            rewindDryRun: (sessionId: string, nativeId: string) =>
                client.post<{ canRewind: boolean; canRestoreFiles: boolean; reason?: string }>(
                    `/api/sessions/${sessionId}/rewind/dry-run`,
                    { nativeId },
                ),
            // rewind 执行：闸门通过即受理（202），结果经 SSE 两段回报（rewind-truncated → rewind-completed）
            rewind: (sessionId: string, nativeId: string, restoreFiles: boolean) =>
                client.post(`/api/sessions/${sessionId}/rewind`, { nativeId, restoreFiles }),
            // fork 会话创建：建待激活会话行 + 复制锚点 turn（fork-session spec §5.1，hub 侧纯动作不要求 CLI 在线）；
            // 成功返回新会话 id 供跳转；失败 { error, code } 供归因文案（code 经 forkRejectReasonKey 映射）
            fork: (sessionId: string, anchorNativeId: string) =>
                client.post<{ sessionId: string }>(`/api/sessions/${sessionId}/fork`, { anchorNativeId }),
            // 清理 runtimeState 指定字段
            clearRuntimeStateFields: (sessionId: string, clearFields: ('todos' | 'tasks' | 'backgroundTasks' | 'teamState' | 'goalStatus')[]) =>
                client.patch(`/api/sessions/${sessionId}/runtime-state`, { clearFields }),
            rename: (sessionId: string, name: string) => client.patch(`/api/sessions/${sessionId}`, { name }),
            // 置顶 / 取消置顶（置顶进「置顶」分组，从「项目」「最近」过滤掉；取消反向）
            setPinned: (sessionId: string, pinned: boolean) =>
                client.patch(`/api/sessions/${sessionId}`, { pinned }),
            // 置顶会话分页（跨项目/游离，「置顶」区数据源）
            pinnedSessions: (cursor?: number, limit?: number) =>
                client.get<ProjectSessionsResponse>('/api/sessions/pinned', {
                    params: {
                        ...(cursor !== undefined && { cursor }),
                        limit: limit ?? 20,
                    },
                }),
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
            listDirectory: (sessionId: string, path: string, prefix?: string, opts?: { signal?: AbortSignal }) =>
                client.get<ListFilesResponse>(`/api/sessions/${sessionId}/list-directory`, { params: { path, prefix }, signal: opts?.signal }),
        },

        // Messages
        messages: {
            list: (sessionId: string, params?: { beforeSeq?: number; limit?: number }) =>
                client.get<MessagesResponse>(`/api/sessions/${sessionId}/messages`, { params }),
            // content 三形态（string / 单 block / block 数组），hub 端统一走 UserMessageContentSchema
            send: (sessionId: string, content: UserMessageContent, localId?: string) =>
                client.post(`/api/sessions/${sessionId}/messages`, { content, localId }),
            sidechain: (sessionId: string, parentToolUseId: string, opts?: { signal?: AbortSignal }) =>
                client.get<{ messages: DecryptedMessage[] }>(`/api/sessions/${sessionId}/sidechain-messages`, {
                    params: { parentToolUseId },
                    signal: opts?.signal,
                }),
            // 取消排队消息（仍处于 lifecycle='queued' 的 user 消息）；已 push 则返回 'submitted'
            cancel: (sessionId: string, messageId: string) =>
                client.delete<{ status: 'cancelled' | 'submitted' }>(`/api/sessions/${sessionId}/messages/${messageId}`),
            // steer：把仍排队的消息提前提交给 Claude Code SDK input stream
            steer: (sessionId: string, messageId: string) =>
                client.post<{ status: 'steered' | 'submitted' }>(`/api/sessions/${sessionId}/messages/${messageId}/steer`),
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
            // file-meta：轻量元数据（mime/size/etag/writable），不拉文件体，
            // 供「代码高亮 P1」等场景按 mime 决定渲染策略、按 etag 做条件请求；
            // writable = 是否在写边界（严格 cwd 子树）内，false 时 inspector 直接只读态
            meta: (sessionId: string, path: string) =>
                client.get<ReadFileMetaResponse>(
                    `/api/sessions/${sessionId}/file-meta`,
                    { params: { path } },
                ),
            // save-file：inspector 编辑保存（octet-stream；path/baseEtag 走 header）。
            // conflict → 409，CLI 业务错误（rpcError）经 hub 包成 500；
            // 二者都放行（validateStatus），让 useSaveFile 按 data.success 分流，
            // mutationFn 永不抛错（符合其 error:never 类型签名），仅断网等网络异常才 reject。
            save: (
                sessionId: string,
                path: string,
                content: Uint8Array,
                baseEtag: string,
            ) => client.post(`/api/sessions/${sessionId}/save-file`, content, {
                headers: {
                    'Content-Type': 'application/octet-stream',
                    'X-Mobi-Path': encodeURIComponent(path),
                    'X-Mobi-Base-Etag': baseEtag,
                },
                validateStatus: (s) => (s >= 200 && s < 300) || s === 409 || s === 500,
            }),
        },

        // Permissions
        permissions: {
            // 批准请求体（T1 单源收口：mode/decision/updatedPermissions/answers 均用具名类型，
            // 不再内联声明半新半旧）
            approve: (
                sessionId: string,
                requestId: string,
                body?: {
                    mode?: PermissionMode
                    updatedPermissions?: PermissionUpdate[]
                    decision?: string
                    answers?: PermissionAnswers
                },
            ) =>
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
        snapshotDelta: {
            /** 打开会话/重连后主动补发流式中的全量基线（delta 协议：衔接此后的增量帧） */
            resync: (subscriptionId: string, sessionId: string) =>
                client.post<{ ok: boolean; synced: number }>('/api/snapshot-resync', { subscriptionId, sessionId }),
        },

        // Push notifications
        push: {
            getVapidKey: () => client.get<{ publicKey: string }>('/api/push/vapid-public-key'),
            subscribe: (subscription: PushSubscriptionJSON) =>
                client.post('/api/push/subscribe', subscription),
            getSubscriptionStatus: () => client.get<{ subscribed: boolean }>('/api/push/subscription'),
        },

        // Projects（项目实体化，会话按项目 / 「最近」组织）
        projects: {
            // 项目列表（?machineId= 过滤某机器名下项目）
            list: (machineId?: string) =>
                client.get<{ projects: Project[] }>('/api/projects', {
                    params: machineId ? { machineId } : undefined,
                }),
            get: (projectId: string) =>
                client.get<{ project: Project }>(`/api/projects/${projectId}`),
            create: (input: { name: string; machineId: string; folders: ProjectFolder[] }) =>
                client.post<{ project: Project }>('/api/projects', input),
            update: (projectId: string, patch: { name?: string; folders?: ProjectFolder[] }) =>
                client.patch<{ project: Project }>(`/api/projects/${projectId}`, patch),
            remove: (projectId: string) =>
                client.delete<{ success: boolean }>(`/api/projects/${projectId}`),
            // 项目内会话分页（返回完整 Session）
            sessions: (projectId: string, cursor?: number, limit?: number) =>
                client.get<ProjectSessionsResponse>(`/api/projects/${projectId}/sessions`, {
                    params: {
                        ...(cursor !== undefined && { cursor }),
                        limit: limit ?? 20,
                    },
                }),
            // 未归入任何项目的「最近」会话分页
            unboundSessions: (cursor?: number, limit?: number) =>
                client.get<ProjectSessionsResponse>('/api/projects/sessions/unbound', {
                    params: {
                        ...(cursor !== undefined && { cursor }),
                        limit: limit ?? 20,
                    },
                }),
            // 会话归入项目 / 移出项目（projectId=null 移出）。
            // PATCH /api/sessions/:id 为合并端点（name/projectId 共用），此处只发 projectId
            assignSession: (sessionId: string, projectId: string | null) =>
                client.patch(`/api/sessions/${sessionId}`, { projectId }),
        },

        // Machines
        machines: {
            list: () => client.get<{ machines: Machine[] }>('/api/machines'),
            spawn: (machineId: string, directory: string, agent?: string, model?: string, permissionMode?: PermissionMode, sessionType?: string, worktreeName?: string, effort?: string, outputStyle?: string, projectId?: string) =>
                client.post(`/api/machines/${machineId}/spawn`, { directory, agent, model, permissionMode, sessionType, worktreeName, effort, outputStyle, projectId }),
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
            listSessionDirectory: (machineId: string, cwd: string, path: string, prefix?: string, opts?: { signal?: AbortSignal }) =>
                client.get<ListFilesResponse>(`/api/machines/${machineId}/list-session-directory`, { params: { cwd, path, prefix }, signal: opts?.signal }),
            // Web 工具配置（hub 纯透传 runner RPC；凭据脱敏回显，机器离线 502 reject）
            webTools: {
                get: (machineId: string) =>
                    client.get<{ config: RedactedWebToolsConfig } | { error: string }>(`/api/machines/${machineId}/web-tools`),
                // set：提交方向在场性类型（凭据键不在场=保持、null=清除、空串=旧客户端保持）
                set: (machineId: string, config: WebToolsConfigSubmission) =>
                    client.post<{ success: true } | { success: false; error: string }>(
                        `/api/machines/${machineId}/web-tools`,
                        { config },
                    ),
                // 验证连接：一次轻量真实搜索；草稿凭据优先于已存值，不落盘
                verify: (machineId: string, providerId: WebToolProviderId, credentials?: Record<string, string>) =>
                    client.post<{ success: true; latencyMs: number } | { success: false; error: string }>(
                        `/api/machines/${machineId}/web-tools/verify`,
                        { providerId, credentials },
                    ),
            },
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
