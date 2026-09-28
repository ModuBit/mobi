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
import type { Workspace } from '@/core/data/api/types'
import { queryKeys } from '@/core/lib/query-keys'

/**
 * 获取工作区列表
 *
 * @param machineId 可选，过滤某机器名下的工作区；缺省拉全部（缓存维度 'all'）
 */
export function useWorkspaces(machineId?: string) {
    const api = useMobiApi()

    return useQuery({
        // 第二维 machineId ?? 'all'：不同过滤维度各自缓存，['workspaces'] 前缀失效全部
        queryKey: [...queryKeys.workspaces, machineId ?? 'all'],
        queryFn: async () => {
            const res = await api.workspaces.list(machineId)
            return res.data.workspaces as Workspace[]
        },
        enabled: true,
    })
}
