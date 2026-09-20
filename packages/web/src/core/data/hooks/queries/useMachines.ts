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
import { useMobiApi } from '@/core/data/api/client'
import { queryKeys } from '@/core/lib/query-keys'
import type { Machine } from '@/core/data/api/types'

/**
 * 获取在线机器列表
 */
export function useMachines(enabled: boolean = true): {
    machines: Machine[]
    isLoading: boolean
    error: string | null
    refetch: () => Promise<unknown>
} {
    const api = useMobiApi()

    const query = useQuery({
        queryKey: queryKeys.machines,
        queryFn: async () => {
            const res = await api.machines.list()
            return res.data
        },
        enabled: enabled,
        // 稳态更新走 machine-updated 事件 patch（SSEProvider），不再随 CLI 心跳 refetch；
        // 低频兜底覆盖未知的漏事件场景（确定性对账在 SSE 重连的 resyncAfterGap）
        refetchInterval: 5 * 60_000,
    })

    return {
        machines: query.data?.machines ?? [],
        isLoading: query.isLoading,
        error: query.error instanceof Error ? query.error.message : query.error ? 'Failed to load machines' : null,
        refetch: query.refetch,
    }
}
