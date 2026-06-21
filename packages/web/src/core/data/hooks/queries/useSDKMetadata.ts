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
import type { SDKMetadata, SDKMetadataResponse } from '@/core/data/api/types'

export type { SDKMetadata, ModelOption, Command, AgentInfo, AccountInfo } from '@/core/data/api/types'

/**
 * 获取会话的 SDK 元数据（commands, models, agents 等）
 *
 * 打开 session detail 后请求一次，缓存在 TanStack Query 中，
 * 其他 hook（useCommands）通过 select 派生。
 */
export function useSDKMetadata(sessionId: string | null, enabled: boolean = true) {
    const api = useMobiApi()

    return useQuery<SDKMetadata | null>({
        queryKey: sessionId ? queryKeys.sdkMetadata(sessionId) : ['sdkMetadata', 'disabled'],
        queryFn: async () => {
            if (!sessionId) return null

            const res = await api.sessions.metadata(sessionId)
            return (res.data as SDKMetadataResponse | undefined)?.metadata ?? null
        },
        enabled: !!sessionId && enabled,
        staleTime: 60_000,
    })
}
