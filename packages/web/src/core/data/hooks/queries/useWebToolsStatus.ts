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

/** Web 工具状态摘要（设置入口徽标渲染用） */
export type WebToolsStatus = 'enabled' | 'unconfigured' | 'offline' | 'loading'

/**
 * Web 工具分区状态摘要（入口徽标用）。
 * 两跳：机器列表（第一台在线）→ 该机器脱敏配置。staleTime 内缓存复用。
 * 任何一步失败 → offline（机器离线语义）。
 */
export function useWebToolsStatus(): WebToolsStatus {
    const api = useMobiApi()
    const query = useQuery({
        queryKey: queryKeys.webToolsStatus,
        queryFn: async () => {
            const machinesRes = await api.machines.list()
            const online = machinesRes.data.machines.find((m) => m.active)
            if (!online) return 'offline' as const
            const configRes = await api.machines.webTools.get(online.id)
            if (!('config' in configRes.data)) return 'offline' as const
            return configRes.data.config.providers?.some((p) => p.enabled)
                ? ('enabled' as const)
                : ('unconfigured' as const)
        },
        staleTime: 30_000,
        retry: false,
    })
    if (query.isPending) return 'loading'
    return query.data ?? 'offline'
}
