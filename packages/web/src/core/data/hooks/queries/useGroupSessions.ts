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

import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query'
import { useAuthStore } from '@/core/data/stores/authStore'
import { useMobiApi } from '@/core/data/api/client'
import type { Session, GroupSessionsPage } from '@/core/data/api/types'
import { queryKeys } from '@/core/lib/query-keys'
import { mergeSessions } from '@/core/data/cache/sessionCache'

const PAGE_SIZE = 20

/**
 * 获取分组内的会话列表（分页）
 * 返回只含 sessionId 的数据，完整 Session 数据 upsert 到全局 sessions 缓存
 */
export function useGroupSessions(groupKey: string | null) {
    const { token } = useAuthStore()
    const api = useMobiApi(token)
    const queryClient = useQueryClient()

    return useInfiniteQuery<GroupSessionsPage>({
        queryKey: queryKeys.groupSessions(groupKey!),
        queryFn: async ({ pageParam }) => {
            const cursor = pageParam as number | undefined
            const res = await api.sessionGroups.getSessions(groupKey!, cursor, PAGE_SIZE)

            // 将完整 Session 数据 upsert 到全局 sessions 缓存
            queryClient.setQueryData<Session[]>(queryKeys.sessions, (old) =>
                mergeSessions(old, res.data.sessions)
            )

            return {
                sessionIds: res.data.sessions.map(s => s.id),
                nextCursor: res.data.nextCursor,
                hasMore: res.data.hasMore,
            }
        },
        initialPageParam: undefined,
        getNextPageParam: (lastPage) => {
            if (!lastPage.hasMore || lastPage.nextCursor === null) {
                return undefined
            }
            return lastPage.nextCursor
        },
        enabled: !!token && !!groupKey,
    })
}
