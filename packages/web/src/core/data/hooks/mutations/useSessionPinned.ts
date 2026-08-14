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

/** 取某根前缀下已缓存的全部 [key, data]（用于快照与批量调整项目分组） */
function getGroupEntries(
    queryClient: ReturnType<typeof useQueryClient>,
    root: QueryKey,
): Array<[QueryKey, GroupPages]> {
    return queryClient.getQueriesData<GroupPages>({ queryKey: root })
}

/** 乐观更新涉及的缓存快照（onError 回滚用） */
interface PinnedSnapshot {
    /** 全局会话列表（pinned 标记所在） */
    sessions: Session[] | undefined
    /** ['pinnedSessions'] 无限分页数据 */
    pinned: unknown
    /** 「最近」与各项目分组的无限分页数据（pin 时从这些组移除） */
    recent: GroupPages
    projects: Array<[QueryKey, GroupPages]>
}

/**
 * 置顶 / 取消置顶会话（乐观更新）。
 *
 * 点击瞬间本地缓存先行生效（避免大库下 invalidate→refetch 链路 2-3s 的「点了没反应」感）：
 * - ['sessions'] 中该会话 pinned 翻转（按钮态立即正确）
 * - 分组成员同步搬移：pin → 进 ['pinnedSessions']、从「最近」/项目组移除；unpin 反向
 * 失败回滚快照；成功后 invalidateProjectViews + 会话本体/全局缓存失效做真值补偿，
 * SSE 事件（现有逻辑不变）负责同步其他端。
 */
export function useSetSessionPinned() {
    const api = useMobiApi()
    const queryClient = useQueryClient()

    return useMutation({
        mutationFn: async ({ sessionId, pinned }: { sessionId: string; pinned: boolean }) => {
            await api.sessions.setPinned(sessionId, pinned)
        },

        onMutate: async ({ sessionId, pinned }): Promise<PinnedSnapshot> => {
            // 取消在途请求，防止 refetch 回写覆盖乐观态
            await queryClient.cancelQueries({ queryKey: queryKeys.sessions })
            await queryClient.cancelQueries({ queryKey: queryKeys.pinnedSessions })
            await queryClient.cancelQueries({ queryKey: queryKeys.recentSessions })
            await queryClient.cancelQueries({ queryKey: queryKeys.projectSessionsRoot })

            // 快照（回滚用）
            const snapshot: PinnedSnapshot = {
                sessions: queryClient.getQueryData<Session[]>(queryKeys.sessions),
                pinned: queryClient.getQueryData(queryKeys.pinnedSessions),
                recent: queryClient.getQueryData<GroupPages>(queryKeys.recentSessions),
                projects: getGroupEntries(queryClient, queryKeys.projectSessionsRoot),
            }

            // 会话当前归属（决定 unpin 回填哪个分组）
            const session = snapshot.sessions?.find(s => s.id === sessionId)
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
            queryClient.setQueryData<GroupPages>(queryKeys.pinnedSessions, old => toggleIdInPages(old, sessionId, pinned))

            if (pinned) {
                // 离开原分组：从「最近」与所有项目组移除（幂等，不存在的移除是 no-op）
                queryClient.setQueryData<GroupPages>(queryKeys.recentSessions, old => toggleIdInPages(old, sessionId, false))
                for (const [key] of getGroupEntries(queryClient, queryKeys.projectSessionsRoot)) {
                    queryClient.setQueryData<GroupPages>(key, old => toggleIdInPages(old, sessionId, false))
                }
            } else {
                // 回原分组（归属未变：projectId 有值回项目组，否则回「最近」）
                queryClient.setQueryData<GroupPages>(restoreKey, old => toggleIdInPages(old, sessionId, true))
            }

            return snapshot
        },

        // 失败回滚乐观态（API 未生效，UI 不能停在假状态）
        onError: (_error, _variables, snapshot) => {
            if (!snapshot) return
            queryClient.setQueryData(queryKeys.sessions, snapshot.sessions)
            queryClient.setQueryData(queryKeys.pinnedSessions, snapshot.pinned)
            queryClient.setQueryData(queryKeys.recentSessions, snapshot.recent)
            for (const [key, data] of snapshot.projects) {
                queryClient.setQueryData(key, data)
            }
        },

        // 成功后真值补偿：invalidate 三键 + 会话本体/全局缓存（SSE 侧逻辑不变，天然去重）
        onSettled: async (_data, _error, variables) => {
            await Promise.all([
                queryClient.invalidateQueries({ queryKey: queryKeys.session(variables.sessionId) }),
                queryClient.invalidateQueries({ queryKey: queryKeys.sessions }),
                invalidateProjectViews(queryClient),
            ])
        },
    })
}
