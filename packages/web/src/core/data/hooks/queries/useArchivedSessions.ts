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

import { useInfiniteQuery } from '@tanstack/react-query'
import { ARCHIVED_WORKSPACE_NONE } from '@mobi/shared'
import { useMobiApi } from '@/core/data/api/client'
import { queryKeys } from '@/core/lib/queryKeys'

/**
 * 归档会话分页列表（票 05；归档时间倒序游标，触底加载）。
 * 归档页与本 hook 的其他消费者共用同一缓存键；归档/取消归档/删除动作经
 * invalidateSessionViews invalidate 此键即时收敛（重拉已加载页——归档低频，可接受）。
 * 归档会话自持完整 Session（不进全局 ['sessions'] 缓存）：归档行不在主列表出现，
 * 无跨视图共享诉求，单一消费方自持最简。
 *
 * 项目过滤下推 daemon（workspaceId 进 queryKey）：切换过滤 = 独立查询从第一页重拉，
 * 各过滤视图的已加载页在缓存中互不覆盖。
 */
export function useArchivedSessions(workspaceFilter?: string | null) {
    const api = useMobiApi()

    return useInfiniteQuery({
        queryKey: queryKeys.archivedSessionsWorkspace(workspaceFilter ?? null),
        queryFn: ({ pageParam }) => api.sessions.archivedSessions({
            // 未指定 = 全部归档；哨兵（单源 @mobi/shared）= 未归入工作区，由 client 编码为 null
            workspaceId: workspaceFilter === ARCHIVED_WORKSPACE_NONE ? null : workspaceFilter,
            cursor: pageParam,
        }).then(res => res.data),
        initialPageParam: undefined as number | undefined,
        getNextPageParam: (lastPage): number | undefined => {
            if (!lastPage.hasMore || lastPage.nextCursor === null) return undefined
            return lastPage.nextCursor
        },
    })
}
