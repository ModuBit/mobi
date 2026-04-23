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
import { useAuthStore } from '@/core/data/stores/authStore'
import { useMobiApi } from '@/core/data/api/client'
import { queryKeys } from '@/core/lib/query-keys'

/**
 * 会话操作 Hook
 * 提供所有会话相关的操作方法（归档、删除、中断、恢复等）
 */
export function useSessionActions(sessionId: string | null): {
    abortSession: () => Promise<void>
    archiveSession: () => Promise<void>
    switchSession: () => Promise<void>
    resumeSession: () => Promise<string>
    setPermissionMode: (mode: string) => Promise<void>
    setModelMode: (mode: string) => Promise<void>
    renameSession: (name: string) => Promise<void>
    deleteSession: () => Promise<void>
    isPending: boolean
    isAbortPending: boolean
    isArchivePending: boolean
    isResumePending: boolean
    isSwitchPending: boolean
} {
    const { token } = useAuthStore()
    const api = useMobiApi(token)
    const queryClient = useQueryClient()
    const navigate = useNavigate()

    const invalidateSession = async () => {
        if (!sessionId) return
        await queryClient.invalidateQueries({ queryKey: queryKeys.session(sessionId) })
        await queryClient.invalidateQueries({ queryKey: queryKeys.sessions })
    }

    // 中断会话
    const abortMutation = useMutation({
        mutationFn: async () => {
            if (!sessionId) {
                throw new Error('Session unavailable')
            }
            await api.sessions.abort(sessionId)
        },
        onSuccess: () => void invalidateSession(),
    })

    // 归档会话
    const archiveMutation = useMutation({
        mutationFn: async () => {
            if (!sessionId) {
                throw new Error('Session unavailable')
            }
            await api.sessions.archive(sessionId)
        },
        onSuccess: () => void invalidateSession(),
    })

    // 切换会话（remote/local 模式切换）
    const switchMutation = useMutation({
        mutationFn: async () => {
            if (!sessionId) {
                throw new Error('Session unavailable')
            }
            await api.sessions.switch(sessionId)
        },
        onSuccess: () => void invalidateSession(),
    })

    // 恢复会话
    const resumeMutation = useMutation({
        mutationFn: async () => {
            if (!sessionId) {
                throw new Error('Session unavailable')
            }
            const res = await api.sessions.resume(sessionId)
            return res.data.sessionId as string
        },
        onSuccess: async (newSessionId) => {
            await invalidateSession()
            // resume 后后端可能 mergeSessions，新 session ID 会变化
            if (newSessionId && newSessionId !== sessionId) {
                await navigate({ to: '/sessions/$sessionId', params: { sessionId: newSessionId }, replace: true })
            }
        },
    })

    // 设置权限模式
    const permissionMutation = useMutation({
        mutationFn: async (mode: string) => {
            if (!sessionId) {
                throw new Error('Session unavailable')
            }
            await api.sessions.setPermissionMode(sessionId, mode)
        },
        onSuccess: () => void invalidateSession(),
    })

    // 设置模型模式
    const modelMutation = useMutation({
        mutationFn: async (mode: string) => {
            if (!sessionId) {
                throw new Error('Session unavailable')
            }
            await api.sessions.setModelMode(sessionId, mode)
        },
        onSuccess: () => void invalidateSession(),
    })

    // 重命名会话
    const renameMutation = useMutation({
        mutationFn: async (name: string) => {
            if (!sessionId) {
                throw new Error('Session unavailable')
            }
            await api.sessions.rename(sessionId, name)
        },
        onSuccess: () => void invalidateSession(),
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
            // 同时移除消息缓存
            queryClient.removeQueries({ queryKey: queryKeys.messages(sessionId) })
            await queryClient.invalidateQueries({ queryKey: queryKeys.sessions })
        },
    })

    return {
        abortSession: abortMutation.mutateAsync,
        archiveSession: archiveMutation.mutateAsync,
        switchSession: switchMutation.mutateAsync,
        resumeSession: resumeMutation.mutateAsync,
        setPermissionMode: permissionMutation.mutateAsync,
        setModelMode: modelMutation.mutateAsync,
        renameSession: renameMutation.mutateAsync,
        deleteSession: deleteMutation.mutateAsync,
        isPending:
            abortMutation.isPending ||
            archiveMutation.isPending ||
            switchMutation.isPending ||
            resumeMutation.isPending ||
            permissionMutation.isPending ||
            modelMutation.isPending ||
            renameMutation.isPending ||
            deleteMutation.isPending,
        isAbortPending: abortMutation.isPending,
        isArchivePending: archiveMutation.isPending,
        isResumePending: resumeMutation.isPending,
        isSwitchPending: switchMutation.isPending,
    }
}
