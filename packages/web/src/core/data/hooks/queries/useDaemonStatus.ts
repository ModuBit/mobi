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

/** GET /api/daemon/status 返回形状（205 补 executor 段后此处同步扩展） */
export interface DaemonStatus {
    status: 'ok' | 'starting'
    host: {
        hostname: string
        platform: string
        homeDir: string
    }
}

/**
 * 获取 daemon 状态（单机：daemon 即宿主）。
 * 取代 useMachines 作为宿主身份（hostname/homeDir）与就绪判据的数据源——
 * 机器列表这一层随 machine 概念移除退场（ticket 201）。
 */
export function useDaemonStatus(enabled: boolean = true): {
    status: DaemonStatus | null
    isLoading: boolean
    error: string | null
    refetch: () => Promise<unknown>
} {
    const api = useMobiApi()

    const query = useQuery({
        queryKey: queryKeys.daemonStatus,
        queryFn: async () => {
            const res = await api.daemon.status()
            return res.data
        },
        enabled: enabled,
    })

    return {
        status: query.data ?? null,
        isLoading: query.isLoading,
        error: query.error instanceof Error ? query.error.message : query.error ? 'Failed to load daemon status' : null,
        refetch: query.refetch,
    }
}
