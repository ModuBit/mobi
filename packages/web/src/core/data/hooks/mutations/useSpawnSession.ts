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
import { useTranslation } from 'react-i18next'
import { useMobiApi } from '@/core/data/api/client'
import { queryKeys } from '@/core/lib/query-keys'
import type { SpawnResponse } from '@/core/data/api/types'
import type { EffortLevel, PermissionMode } from '@mobi/shared'
import type { AgentType, SessionType } from '@/domain/session/types'

export interface SpawnInput {
    machineId: string
    directory: string
    agent?: AgentType
    model?: string
    effort?: EffortLevel
    permissionMode?: PermissionMode
    sessionType?: SessionType
    worktreeName?: string
    /** 归属项目（缺省 = 游离会话，进「最近」）；hub 侧校验项目存在且属于该机器 */
    projectId?: string
}

export type { SpawnResponse }

export function useSpawnSession(): {
    spawnSession: (input: SpawnInput) => Promise<SpawnResponse>
    isPending: boolean
    error: string | null
} {
    const { t } = useTranslation()
    const api = useMobiApi()
    const queryClient = useQueryClient()

    const mutation = useMutation({
        mutationFn: async (input: SpawnInput): Promise<SpawnResponse> => {
            try {
                const res = await api.machines.spawn(
                    input.machineId,
                    input.directory,
                    input.agent,
                    input.model,
                    input.permissionMode,
                    input.sessionType,
                    input.worktreeName,
                    input.effort,
                    input.projectId
                )

                // hub spawnSession 失败时返回 { type:'error', message } 且 HTTP 仍 200，
                // axios 对 200 不抛错——必须读取 body.type 判定，否则真实失败原因被吞，
                // NewSessionPage 仅显示「创建会话失败」兜底文案而看不到具体错误。
                const data = res.data as SpawnResponse | undefined
                if (data && data.type === 'success' && data.sessionId) {
                    return { type: 'success', sessionId: data.sessionId }
                }
                if (data && data.type === 'error' && data.message) {
                    return { type: 'error', message: data.message }
                }
                // shape 异常（machine 离线 / RPC 返回非预期结构）
                return { type: 'error', message: t('newSession.createFailed') }
            } catch (e) {
                const message = e instanceof Error ? e.message : t('newSession.createFailed')
                return { type: 'error', message }
            }
        },
        onSuccess: (result) => {
            if (result.type === 'success') {
                void queryClient.invalidateQueries({ queryKey: queryKeys.sessions })
            }
        },
    })

    return {
        spawnSession: mutation.mutateAsync,
        isPending: mutation.isPending,
        error: mutation.error instanceof Error ? mutation.error.message : mutation.error ? String(mutation.error) : null,
    }
}
