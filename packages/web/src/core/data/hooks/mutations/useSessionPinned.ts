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

import { useMutation, useQueryClient } from '@tanstack/react-query'
import type { InfiniteData, QueryKey } from '@tanstack/react-query'
import { useMobiApi } from '@/core/data/api/client'
import type { ProjectSessionsPage, Session } from '@/core/data/api/types'
import { queryKeys } from '@/core/lib/query-keys'
import { invalidateProjectViews } from '@/core/lib/invalidateProjectViews'
import { toggleIdInPages } from '@/core/data/cache/pinnedOptimistic'

type GroupPages = InfiniteData<ProjectSessionsPage> | undefined

/** 取某根前缀下已缓存的全部 [key, data]（用于批量调整项目分组） */
function getGroupEntries(
    queryClient: ReturnType<typeof useQueryClient>,
    root: QueryKey,
): Array<[QueryKey, GroupPages]> {
    return queryClient.getQueriesData<GroupPages>({ queryKey: root })
}

/**
 * 置顶 / 取消置顶会话。
 *
 * API 期间由调用方展示 loading（pinPendingSessionId / ActionSheet loading）；
 * 成功后本地缓存立即生效——不再等 invalidate→refetch 的整条收敛链路
 * （大库多会话时要 2-3s，用户感知「点了没反应/慢一拍」）：
 * - ['sessions'] 中该会话 pinned 翻转（按钮态立即正确）
 * - 分组成员同步搬移：pin → 进 ['pinnedSessions']、从「最近」/项目组移除；unpin 反向
 *   （归属未变：projectId 有值回项目组，否则回「最近」）
 * 随后 invalidateProjectViews + 会话本体/全局缓存失效做真值补偿；
 * SSE 事件（现有逻辑不变）负责同步其他端。
 * 失败不做任何本地改动（错误提示由调用方处理）。
 */
export function useSetSessionPinned() {
    const api = useMobiApi()
    const queryClient = useQueryClient()

    return useMutation({
        mutationFn: async ({ sessionId, pinned }: { sessionId: string; pinned: boolean }) => {
            await api.sessions.setPinned(sessionId, pinned)
        },

        onSuccess: (_data, { sessionId, pinned }) => {
            // 会话当前归属（决定 unpin 回填哪个分组）
            const sessions = queryClient.getQueryData<Session[]>(queryKeys.sessions)
            const session = sessions?.find(s => s.id === sessionId)
            const restoreKey = session?.projectId
                ? queryKeys.projectSessions(session.projectId)
                : queryKeys.recentSessions

            // 1. 全局会话列表：pinned 翻转
            queryClient.setQueryData<Session[]>(queryKeys.sessions, old =>
                old?.map(s => (s.id === sessionId ? { ...s, pinned } : s)) ?? old)

            // 2. 详情缓存同步（若已拉过）
            queryClient.setQueryData<Session>(queryKeys.session(sessionId), old =>
                old ? { ...old, pinned } : old)

            // 3. 分组成员搬移
            queryClient.setQueryData<GroupPages>(queryKeys.pinnedSessions, old =>
                toggleIdInPages(old, sessionId, pinned))

            if (pinned) {
                // 离开原分组：从「最近」与所有项目组移除（幂等，不存在的移除是 no-op）
                queryClient.setQueryData<GroupPages>(queryKeys.recentSessions, old =>
                    toggleIdInPages(old, sessionId, false))
                for (const [key] of getGroupEntries(queryClient, queryKeys.projectSessionsRoot)) {
                    queryClient.setQueryData<GroupPages>(key, old =>
                        toggleIdInPages(old, sessionId, false))
                }
            } else {
                // 回原分组
                queryClient.setQueryData<GroupPages>(restoreKey, old =>
                    toggleIdInPages(old, sessionId, true))
            }

            // 真值补偿：invalidate 三键 + 会话本体/全局缓存（SSE 侧逻辑不变，天然去重）
            void Promise.all([
                queryClient.invalidateQueries({ queryKey: queryKeys.session(sessionId) }),
                queryClient.invalidateQueries({ queryKey: queryKeys.sessions }),
                invalidateProjectViews(queryClient),
            ])
        },
    })
}
