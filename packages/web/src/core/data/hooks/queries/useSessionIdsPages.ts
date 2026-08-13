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
import { queryKeys } from '@/core/lib/query-keys'
import { mergeSessions } from '@/core/data/cache/sessionCache'
import type { Session, ProjectSessionsPage, ProjectSessionsResponse } from '@/core/data/api/types'

/** useSessionIdsPages 入参：调用方只贡献查询键与单页拉取逻辑 */
export interface SessionIdsPagesInput {
    /** 无限查询键（queryKeys 工厂产物） */
    queryKey: readonly unknown[]
    /** 拉取一页（cursor=null 表示首页；返回完整 Session 分页载荷） */
    fetchPage: (cursor: number | null) => Promise<ProjectSessionsResponse>
    /** 是否启用（如 projectId 就绪才拉取） */
    enabled?: boolean
}

/**
 * 无限分页查询骨架（useProjectSessions / useRecentSessions 复用）
 *
 * 收口与具体分组无关的脚手架：
 * - useInfiniteQuery 装配（initialPageParam / getNextPageParam 的 cursor 语义）
 * - 单一数据源策略：每页完整 Session 经 mergeSessions upsert 进全局 ['sessions'] 缓存，
 *   本查询自身只保留 sessionIds 页
 *
 * 调用方拿到的 query 直接交给 usePagedSessionList 承担展示核心。
 */
export function useSessionIdsPages(input: SessionIdsPagesInput) {
    const queryClient = useQueryClient()

    return useInfiniteQuery<ProjectSessionsPage>({
        queryKey: input.queryKey,
        queryFn: async ({ pageParam }) => {
            // initialPageParam 为 undefined；归一为 null 交给 fetchPage（调用方自行转 API 的 undefined 语义）
            const cursor = (pageParam as number | undefined) ?? null
            const page = await input.fetchPage(cursor)

            // 将完整 Session 数据 upsert 到全局 sessions 缓存（单一数据源）
            queryClient.setQueryData<Session[]>(queryKeys.sessions, (old) =>
                mergeSessions(old, page.sessions)
            )

            return {
                sessionIds: page.sessions.map(s => s.id),
                nextCursor: page.nextCursor,
                hasMore: page.hasMore,
                total: page.total,
            }
        },
        initialPageParam: undefined,
        getNextPageParam: (lastPage) => {
            if (!lastPage.hasMore || lastPage.nextCursor === null) {
                return undefined
            }
            return lastPage.nextCursor
        },
        enabled: input.enabled,
    })
}
