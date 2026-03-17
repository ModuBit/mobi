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
import type { GitStatusResponse } from '@/api/types'

/**
 * 获取会话的 Git 状态
 */
export function useGitStatus(sessionId: string | null) {
    const { token } = useAuthStore()
    const api = useMobiApi(token)

    return useQuery({
        queryKey: ['git-status', sessionId],
        queryFn: async () => {
            if (!sessionId) return null
            const res = await api.git.status(sessionId)
            return res.data as GitStatusResponse
        },
        enabled: !!token && !!sessionId,
        refetchInterval: 10_000, // 每 10 秒自动刷新
    })
}
