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

import { useQuery } from '@tanstack/react-query'
import { useAuthStore } from '@/stores/authStore'
import { useMobiApi } from '@/api/client'
import { queryKeys } from '@/lib/query-keys'
import type { Command } from '@/api/types'

export type { Command }

/**
 * 获取会话可用的命令列表（slash commands + skills）
 */
export function useCommands(sessionId: string | null) {
    const { token } = useAuthStore()
    const api = useMobiApi(token)

    return useQuery({
        queryKey: sessionId ? queryKeys.commands(sessionId) : ['commands', 'disabled'],
        queryFn: async (): Promise<Command[]> => {
            if (!sessionId) return []

            const res = await api.sessions.commands(sessionId)
            return res.data?.commands ?? []
        },
        enabled: !!token && !!sessionId,
        staleTime: 60_000, // 1 分钟内不重新获取
    })
}
