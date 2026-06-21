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
import type { EffortLevel } from '@mobi/shared'
import type { AgentType, SessionType } from '@/domain/session/types'

export interface SpawnInput {
    machineId: string
    directory: string
    agent?: AgentType
    model?: string
    effort?: EffortLevel
    yolo?: boolean
    sessionType?: SessionType
    worktreeName?: string
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
                    input.yolo,
                    input.sessionType,
                    input.worktreeName,
                    input.effort
                )

                return {
                    type: 'success',
                    sessionId: res.data?.sessionId
                }
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
