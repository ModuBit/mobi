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

/** 获取 Agent 工具的 sidechain 消息 */
export function useSidechainMessages(sessionId: string | null, parentToolUseId: string | null) {
    const api = useMobiApi()

    return useQuery({
        queryKey: queryKeys.sidechainMessages(sessionId!, parentToolUseId!),
        queryFn: async () => {
            if (!sessionId || !parentToolUseId) return []
            const res = await api.messages.sidechain(sessionId, parentToolUseId)
            return res.data.messages
        },
        enabled: !!sessionId && !!parentToolUseId,
        // 覆盖全局 30s，5 秒内重复打开使用缓存，超过则重新请求
        staleTime: 5_000,
    })
}
