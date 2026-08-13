/*
 * Copyright Maner·Fan
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *         https://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query'
import { useMobiApi } from '@/core/data/api/client'
import { usePagedSessionList } from '@/core/data/hooks/queries/usePagedSessionList'
import { queryKeys } from '@/core/lib/query-keys'
import { mergeSessions } from '@/core/data/cache/sessionCache'
import type { Session, ProjectSessionsPage } from '@/core/data/api/types'

const PAGE_SIZE = 20

/**
 * 「最近」会话列表的统一逻辑层（未归入任何项目的会话，与 useProjectSessions 同构）
 *
 * - 分页查询拿到完整 Session 后 upsert 进全局 ['sessions'] 缓存，本查询只返回 sessionIds
 *   （单一数据源策略）
 * - 分页/展开/剩余数等展示逻辑由 usePagedSessionList 共享核心承担
 */
export type UseRecentSessionsResult = ReturnType<typeof usePagedSessionList>

export function useRecentSessions(
    activeSessionId?: string,
    /** 默认展开（「最近」区默认展开，用户仍可手动折叠） */
    defaultExpanded = false,
): UseRecentSessionsResult {
    const api = useMobiApi()
    const queryClient = useQueryClient()

    // 获取未归入项目的会话 ID 列表（始终请求，避免折叠时无数据判断激活态）
    const query = useInfiniteQuery<ProjectSessionsPage>({
        queryKey: queryKeys.recentSessions,
        queryFn: async ({ pageParam }) => {
            const cursor = pageParam as number | undefined
            const res = await api.projects.unboundSessions(cursor, PAGE_SIZE)

            // 将完整 Session 数据 upsert 到全局 sessions 缓存（单一数据源）
            queryClient.setQueryData<Session[]>(queryKeys.sessions, (old) =>
                mergeSessions(old, res.data.sessions)
            )

            return {
                sessionIds: res.data.sessions.map(s => s.id),
                nextCursor: res.data.nextCursor,
                hasMore: res.data.hasMore,
                total: res.data.total,
            }
        },
        initialPageParam: undefined,
        getNextPageParam: (lastPage) => {
            if (!lastPage.hasMore || lastPage.nextCursor === null) {
                return undefined
            }
            return lastPage.nextCursor
        },
    })

    // 分页/展开/剩余数等展示逻辑：共享核心
    return usePagedSessionList(query, activeSessionId, defaultExpanded)
}
