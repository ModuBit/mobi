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

/**
 * 主列表分组成员的乐观搬移规则单源（置顶 / 最近 / 全部工作区组）。
 * 置顶翻转（useSessionPinned）与归档进出（useSessionArchive）都涉及
 * 「从哪些分组移除 / 回哪个分组」——此前两处各抄一遍且归属回填规则有细微分叉，
 * 收口此文件，成员搬移的「为什么」只维护一处。乐观即时性保留：不等 invalidate
 * 收敛链路（大库多会话 2-3s 的「点了没反应」是票 05 明确要避免的）。
 */

import type { QueryClient } from '@tanstack/react-query'
import type { InfiniteData, QueryKey } from '@tanstack/react-query'
import type { WorkspaceSessionsPage } from '@/core/data/api/types'
import { queryKeys } from '@/core/lib/queryKeys'
import { toggleIdInPages } from './pinnedOptimistic'

export type GroupPages = InfiniteData<WorkspaceSessionsPage> | undefined

/** 会话身份缓存（['sessions']）的最小字段投影 */
export interface SessionLike {
    id: string
    workspaceId?: string | null
}

/** 取某根前缀下已缓存的全部 [key, data]（用于从所有分组搬移成员） */
function getGroupEntries(
    queryClient: QueryClient,
    root: QueryKey,
): Array<[QueryKey, GroupPages]> {
    return queryClient.getQueriesData<GroupPages>({ queryKey: root })
}

/**
 * 会话当前归属分组键：workspaceId 有值回工作区组，否则回「最近」。
 * 缓存不含该会话（归属未知）时返回 null——插错分组（工作区会话闪进「最近」）
 * 比晚到更糟，交 invalidate 收敛。
 */
export function resolveGroupRestoreKey(queryClient: QueryClient, sessionId: string): QueryKey | null {
    const sessions = queryClient.getQueryData<SessionLike[]>(queryKeys.sessions)
    const session = sessions?.find(s => s.id === sessionId)
    if (!session) return null
    return session.workspaceId
        ? queryKeys.workspaceSessions(session.workspaceId)
        : queryKeys.recentSessions
}

/** 从「最近」与所有工作区组移除成员（幂等，不存在的移除是 no-op；归属未知时全扫是唯一安全做法） */
export function removeFromGroupedLists(queryClient: QueryClient, sessionId: string): void {
    queryClient.setQueryData<GroupPages>(queryKeys.recentSessions, old =>
        toggleIdInPages(old, sessionId, false))
    for (const [key] of getGroupEntries(queryClient, queryKeys.workspaceSessionsRoot)) {
        queryClient.setQueryData<GroupPages>(key, old =>
            toggleIdInPages(old, sessionId, false))
    }
}

/** 回指定分组；key 为 null（归属未知）时 no-op，交 invalidate 收敛 */
export function restoreToGroup(
    queryClient: QueryClient,
    sessionId: string,
    restoreKey: QueryKey | null,
): void {
    if (!restoreKey) return
    queryClient.setQueryData<GroupPages>(restoreKey, old =>
        toggleIdInPages(old, sessionId, true))
}
