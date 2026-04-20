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
import { useAuthStore } from '@/core/data/stores/authStore'
import { useMobiApi } from '@/core/data/api/client'
import { queryKeys } from '@/core/lib/query-keys'
import type { Session } from '@/core/data/api/types'

/**
 * 获取单个会话详情
 */
export function useSession(sessionId: string | null) {
    const { token } = useAuthStore()
    const api = useMobiApi(token)

    return useQuery({
        queryKey: queryKeys.session(sessionId ?? ''),
        queryFn: async () => {
            if (!sessionId) return null
            const res = await api.sessions.get(sessionId)
            return res.data.session as Session
        },
        enabled: !!token && !!sessionId,
    })
}
