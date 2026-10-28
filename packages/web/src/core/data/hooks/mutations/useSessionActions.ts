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

import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { isCancelQueued, DEFAULT_STOP_KIND, type StopKind } from '@mobi/shared'
import { useMobiApi } from '@/core/data/api/client'
import { resumeSession as resumeSessionModule } from '@/core/data/sessionResume'
import { queryKeys } from '@/core/lib/queryKeys'
import { clearMessageWindow, fetchLatestMessages, removeQueuedMessages } from '@/core/data/stores/messageWindowStore'
import { clearSessionResources } from '@/core/lib/sessionResources'

/**
 * 配置类 mutation 的同形工厂（权限模式 / 档位 / 快速模式 / 模型）。
 *
 * 四者只差端点：断言会话存在 → 调端点 → **只失效会话详情**（列表条目由 SSE 就地
 * 更新，见下方 invalidateSessionDetail 注释）。
 */
function useConfigMutation<T>(
    sessionId: string | null,
    send: (sessionId: string, value: T) => Promise<unknown>,
) {
    const queryClient = useQueryClient()
    return useMutation({
        mutationFn: async (value: T) => {
            if (!sessionId) {
                throw new Error('Session unavailable')
            }
            await send(sessionId, value)
        },
        onSuccess: () => {
            if (!sessionId) return
            void queryClient.invalidateQueries({ queryKey: queryKeys.session(sessionId) })
        },
    })
}

/**
 * 会话操作 Hook
 * 提供所有会话相关的操作方法（归档、删除、中断、恢复等）
 */
export function useSessionActions(sessionId: string | null): {
    abortSession: (stopKind?: StopKind) => Promise<void>
    switchSession: () => Promise<void>
    resumeSession: () => Promise<string>
    setPermissionMode: (mode: string) => Promise<void>
    setModelMode: (mode: string) => Promise<void>
    setEffort: (effort: string) => Promise<void>
    setFastMode: (fastMode: boolean) => Promise<void>
    renameSession: (name: string) => Promise<void>
    deleteSession: () => Promise<void>
    isPending: boolean
    isAbortPending: boolean
    isResumePending: boolean
    isSwitchPending: boolean
} {
    const api = useMobiApi()
    const queryClient = useQueryClient()
    const navigate = useNavigate()

    /**
     * 只失效会话详情。
     *
     * 配置/运行态类操作（中断、模式切换、档位、模型、快速模式）不改变列表的成员与排序，
     * 列表条目由 SSE 的 patchSessionCache 就地更新；而 `['sessions']` 一次返回本 namespace
     * 的**全部**会话（无 limit），是全站最贵的拉取之一，不该为这类操作重拉。
     */
    const invalidateSessionDetail = async () => {
        if (!sessionId) return
        await queryClient.invalidateQueries({ queryKey: queryKeys.session(sessionId) })
    }

    /** 详情 + 全量列表：改变列表可见字段（名称）或成员的操作才需要 */
    const invalidateSessionAndList = async () => {
        if (!sessionId) return
        // 两个键互不依赖：并行等待的总耗时取较大者，串行则是相加（全量列表是主导项）
        await Promise.all([
            invalidateSessionDetail(),
            queryClient.invalidateQueries({ queryKey: queryKeys.sessions }),
        ])
    }

    // 中断会话（stopKind 三档停止，缺省 'turn'）
    const abortMutation = useMutation({
        mutationFn: async (stopKind?: StopKind) => {
            if (!sessionId) {
                throw new Error('Session unavailable')
            }
            await api.sessions.abort(sessionId, stopKind)
        },
        onMutate: (stopKind?: StopKind) => {
            // 清队列档：乐观移除本地 queued 行，与 daemon 批删同步——onSettled 的 fetchLatest
            // 走 merge（只增/更新不删），缺这步悬浮条残留（单条取消靠 onMutate 乐观删除，同款模式）
            if (!sessionId) return
            if (isCancelQueued(stopKind ?? DEFAULT_STOP_KIND)) removeQueuedMessages(sessionId)
        },
        onSuccess: () => void invalidateSessionDetail(),
        onSettled: (_data, _error, stopKind) => {
            // 仅清队列档 refetch：daemon 已物理删除 queued 行，merge 不会复活，靠整页拉取清空
            // QueuedMessagesBar（spec §6.2）；普通停止的行更新由 SSE 增量到位，不再拉整页。
            // mutationFn 入参可为 undefined（点按路径），按缺省档判断
            if (!sessionId) return
            if (!isCancelQueued(stopKind ?? DEFAULT_STOP_KIND)) return
            void fetchLatestMessages(api, sessionId)
        },
    })

    // 切换会话（remote/local 模式切换）
    const switchMutation = useMutation({
        mutationFn: async () => {
            if (!sessionId) {
                throw new Error('Session unavailable')
            }
            await api.sessions.switch(sessionId)
        },
        onSuccess: () => void invalidateSessionDetail(),
    })

    // 恢复会话
    const resumeMutation = useMutation({
        mutationFn: async () => {
            if (!sessionId) {
                throw new Error('Session unavailable')
            }
            return await resumeSessionModule(api, sessionId, queryClient)
        },
        onSuccess: async (newSessionId) => {
            // resume 可能返回新的权威会话 ID
            if (newSessionId && newSessionId !== sessionId) {
                await navigate({ to: '/sessions/$sessionId', params: { sessionId: newSessionId }, replace: true })
            }
        },
    })

    // 设置权限模式
    const permissionMutation = useConfigMutation(sessionId, (id: string, mode: string) => api.sessions.setPermissionMode(id, mode))

    const effortMutation = useConfigMutation(sessionId, (id: string, effort: string) => api.sessions.setEffort(id, effort))

    // 设置模型模式
    const fastModeMutation = useConfigMutation(sessionId, (id: string, fastMode: boolean) => api.sessions.setFastMode(id, fastMode))

    const modelMutation = useConfigMutation(sessionId, (id: string, mode: string) => api.sessions.setModelMode(id, mode))

    // 重命名会话
    const renameMutation = useMutation({
        mutationFn: async (name: string) => {
            if (!sessionId) {
                throw new Error('Session unavailable')
            }
            await api.sessions.rename(sessionId, name)
        },
        onSuccess: () => void invalidateSessionAndList(),
    })

    // 删除会话
    const deleteMutation = useMutation({
        mutationFn: async () => {
            if (!sessionId) {
                throw new Error('Session unavailable')
            }
            await api.sessions.delete(sessionId)
        },
        onSuccess: async () => {
            if (!sessionId) return
            // 删除时移除缓存而不是失效
            queryClient.removeQueries({ queryKey: queryKeys.session(sessionId) })
            // 清理消息 store 窗口
            clearMessageWindow(sessionId)
            // 清理检视面板状态 + 缓存终端（顺带关闭后端 PTY）
            clearSessionResources(sessionId)
            await queryClient.invalidateQueries({ queryKey: queryKeys.sessions })
        },
    })

    return {
        abortSession: (stopKind?: StopKind) => abortMutation.mutateAsync(stopKind),
        switchSession: switchMutation.mutateAsync,
        resumeSession: resumeMutation.mutateAsync,
        setPermissionMode: permissionMutation.mutateAsync,
        setModelMode: modelMutation.mutateAsync,
        setEffort: effortMutation.mutateAsync,
        setFastMode: fastModeMutation.mutateAsync,
        renameSession: renameMutation.mutateAsync,
        deleteSession: deleteMutation.mutateAsync,
        isPending:
            abortMutation.isPending ||
            switchMutation.isPending ||
            resumeMutation.isPending ||
            permissionMutation.isPending ||
            modelMutation.isPending ||
            effortMutation.isPending ||
            fastModeMutation.isPending ||
            renameMutation.isPending ||
            deleteMutation.isPending,
        isAbortPending: abortMutation.isPending,
        isResumePending: resumeMutation.isPending,
        isSwitchPending: switchMutation.isPending,
    }
}
