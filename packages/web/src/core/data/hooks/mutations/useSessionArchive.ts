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
import { useMobiApi } from '@/core/data/api/client'
import { queryKeys } from '@/core/lib/queryKeys'
import { toggleIdInPages } from '@/core/data/cache/pinnedOptimistic'
import { removeFromGroupedLists, restoreToGroup, resolveGroupRestoreKey } from '@/core/data/cache/groupedSessionLists'
import type { GroupPages, SessionLike } from '@/core/data/cache/groupedSessionLists'

/**
 * 归档 / 取消归档会话（票 05）。
 *
 * 归档是用户终态：从主列表三分组（置顶/工作区/最近）消失，进归档列表，置顶被清；
 * 取消归档回到原归属分组（工作区有值回工作区组，否则回「最近」；置顶不恢复）。
 * API 期间 loading 由调用方展示；成功后本地缓存立即生效（不等 invalidate 收敛链路），
 * 详情缓存与 ['sessions'] 同步 patch status/archivedAt（SSE 的 session-updated 广播
 * 是真值收敛路径，两边一致不冲突）。归档被 gate 阻塞时 daemon 返回 409 blockers，
 * 错误提示由调用方处理。分组成员搬移规则单源在 groupedSessionLists。
 */
export function useSessionArchive() {
    const api = useMobiApi()
    const queryClient = useQueryClient()

    const archive = useMutation({
        mutationFn: async (sessionId: string) => {
            await api.sessions.archive(sessionId)
        },
        onSuccess: async (_data, sessionId) => {
            // 在途 refetch 携旧权威值落地会盖回乐观 patch（useSessionActions 同款防线）
            await queryClient.cancelQueries({ queryKey: queryKeys.session(sessionId) })
            await queryClient.cancelQueries({ queryKey: queryKeys.sessions })
            patchSessionStatus(queryClient, sessionId, 'archived', Date.now())
            // 从所有分组移除（归档会话不属于主列表任何分组；置顶被一并清掉）
            queryClient.setQueryData<GroupPages>(queryKeys.pinnedSessions, old =>
                toggleIdInPages(old, sessionId, false))
            removeFromGroupedLists(queryClient, sessionId)
            void queryClient.invalidateQueries({ queryKey: queryKeys.archivedSessions })
        },
    })

    const unarchive = useMutation({
        mutationFn: async (sessionId: string) => {
            await api.sessions.unarchive(sessionId)
        },
        onSuccess: async (_data, sessionId) => {
            await queryClient.cancelQueries({ queryKey: queryKeys.session(sessionId) })
            await queryClient.cancelQueries({ queryKey: queryKeys.sessions })
            patchSessionStatus(queryClient, sessionId, 'dormant', Date.now())
            // 回原归属分组（归属未知时不插，交 invalidate 收敛）
            restoreToGroup(queryClient, sessionId, resolveGroupRestoreKey(queryClient, sessionId))
            void queryClient.invalidateQueries({ queryKey: queryKeys.archivedSessions })
        },
    })

    return { archive, unarchive }
}

/**
 * status 迁移后的本地缓存同步：详情 + 全局列表两处 patch，patch 形状单源 patchOne
 * （归档动作同时清置顶 / 置 active=false，daemon 广播与本地 patch 同值）
 */
function patchSessionStatus(
    queryClient: ReturnType<typeof useQueryClient>,
    sessionId: string,
    status: 'archived' | 'dormant',
    at: number,
): void {
    const patchOne = <T extends SessionLike>(old: T): T => ({
        ...old,
        status,
        archivedAt: status === 'archived' ? at : null,
        ...(status === 'archived' ? { pinned: false, active: false } : {}),
    })
    queryClient.setQueryData<SessionLike>(queryKeys.session(sessionId), old => old && patchOne(old))
    queryClient.setQueryData<SessionLike[]>(queryKeys.sessions, old =>
        old?.map(s => (s.id === sessionId ? patchOne(s) : s)) ?? old)
}
