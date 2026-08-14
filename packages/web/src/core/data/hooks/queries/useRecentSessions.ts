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

import { useMobiApi } from '@/core/data/api/client'
import { usePagedSessionList } from '@/core/data/hooks/queries/usePagedSessionList'
import { useSessionIdsPages } from '@/core/data/hooks/queries/useSessionIdsPages'
import { queryKeys } from '@/core/lib/query-keys'

const PAGE_SIZE = 20

/**
 * 「最近」会话列表的统一逻辑层（未归入任何项目的会话，与 useProjectSessions 同构）
 *
 * - 无限分页 + ['sessions'] upsert 脚手架由 useSessionIdsPages 承担（单一数据源策略）
 * - 分页/展开/剩余数等展示逻辑由 usePagedSessionList 共享核心承担
 */
export type UseRecentSessionsResult = ReturnType<typeof usePagedSessionList>

export function useRecentSessions(
    activeSessionId?: string,
    /** 「最近」为平级分区：有会话默认展开、空分区默认收起（用户 toggle 后以用户选择为准） */
    expandWithContent = true,
): UseRecentSessionsResult {
    const api = useMobiApi()

    // 获取未归入项目的会话 ID 列表（始终请求，避免折叠时无数据判断激活态）
    const query = useSessionIdsPages({
        queryKey: queryKeys.recentSessions,
        fetchPage: (cursor) =>
            api.projects.unboundSessions(cursor ?? undefined, PAGE_SIZE).then(res => res.data),
    })

    // 分页/展开/剩余数等展示逻辑：共享核心
    return usePagedSessionList(query, activeSessionId, expandWithContent)
}
