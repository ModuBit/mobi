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
import { useAuthStore } from '@/stores/authStore'
import { useMobiApi } from '@/api/client'
import { queryKeys } from '@/lib/query-keys'
import type { SpawnResponse } from '@/api/types'

/**
 * 创建会话的输入参数
 */
export interface SpawnInput {
    /** 机器 ID */
    machineId: string
    /** 工作目录 */
    directory: string
    /** Agent 类型（Mobi 当前仅支持 Claude） */
    agent?: 'claude'
    /** 模型 */
    model?: string
    /** 推理强度（保留用于 API 兼容） */
    modelReasoningEffort?: string
    /** 是否启用 YOLO 模式 */
    yolo?: boolean
    /** 会话类型 */
    sessionType?: 'simple' | 'worktree'
    /** Worktree 名称 */
    worktreeName?: string
}

export type { SpawnResponse }

/**
 * 创建新会话的 Hook
 */
export function useSpawnSession(): {
    spawnSession: (input: SpawnInput) => Promise<SpawnResponse>
    isPending: boolean
    error: string | null
} {
    const { token } = useAuthStore()
    const api = useMobiApi(token)
    const queryClient = useQueryClient()

    const mutation = useMutation({
        mutationFn: async (input: SpawnInput): Promise<SpawnResponse> => {
            if (!token) {
                return { type: 'error', message: '未授权' }
            }

            try {
                const res = await api.machines.spawn(
                    input.machineId,
                    input.directory,
                    input.agent,
                    input.model,
                    input.yolo,
                    input.sessionType,
                    input.worktreeName
                )

                // 假设 API 返回 { sessionId: string }
                return {
                    type: 'success',
                    sessionId: res.data?.sessionId
                }
            } catch (e) {
                const message = e instanceof Error ? e.message : '创建会话失败'
                return { type: 'error', message }
            }
        },
        onSuccess: (result) => {
            if (result.type === 'success') {
                // 刷新会话列表
                void queryClient.invalidateQueries({ queryKey: queryKeys.sessions })
            }
        },
    })

    return {
        spawnSession: mutation.mutateAsync,
        isPending: mutation.isPending,
        error: mutation.error instanceof Error ? mutation.error.message : mutation.error ? '创建会话失败' : null,
    }
}
