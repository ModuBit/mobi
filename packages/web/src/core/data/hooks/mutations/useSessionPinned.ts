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
import type { Session } from '@/core/data/api/types'
import { queryKeys } from '@/core/lib/queryKeys'
import { toggleIdInPages } from '@/core/data/cache/pinnedOptimistic'
import { removeFromGroupedLists, restoreToGroup, resolveGroupRestoreKey } from '@/core/data/cache/groupedSessionLists'
import type { GroupPages } from '@/core/data/cache/groupedSessionLists'

/**
 * 置顶 / 取消置顶会话。
 *
 * API 期间由调用方展示 loading（pinPendingSessionId / ActionSheet loading）；
 * 成功后本地缓存立即生效——不再等 invalidate→refetch 的整条收敛链路
 * （大库多会话时要 2-3s，用户感知「点了没反应/慢一拍」）：
 * - ['sessions'] 中该会话 pinned 翻转（按钮态立即正确）
 * - 分组成员同步搬移：pin → 进 ['pinnedSessions']、从「最近」/工作区组移除；unpin 反向
 *   （归属未变：workspaceId 有值回工作区组，否则回「最近」；缓存不含该会话、归属未知时
 *   不本地插入，插错分组比晚到更糟，交 invalidate 收敛）
 * 随后**不**在本端失效工作区视图：daemon 广播的 membership 事件是唯一真值收敛路径，
 * 本端也会收到（见下方 onSuccess 注释）。失败不做任何本地改动（错误提示由调用方处理）。
 */
export function useSetSessionPinned() {
    const api = useMobiApi()
    const queryClient = useQueryClient()

    return useMutation({
        mutationFn: async ({ sessionId, pinned }: { sessionId: string; pinned: boolean }) => {
            await api.sessions.setPinned(sessionId, pinned)
        },

        onSuccess: (_data, { sessionId, pinned }) => {
            // 1. 全局会话列表：pinned 翻转
            queryClient.setQueryData<Session[]>(queryKeys.sessions, old =>
                old?.map(s => (s.id === sessionId ? { ...s, pinned } : s)) ?? old)

            // 2. 详情缓存同步（若已拉过）
            queryClient.setQueryData<Session>(queryKeys.session(sessionId), old =>
                old ? { ...old, pinned } : old)

            // 3. 分组成员搬移（规则单源 groupedSessionLists）：进置顶则离开原分组，
            // 取消置顶则回原分组（归属未知时不插，交 invalidate 收敛）
            queryClient.setQueryData<GroupPages>(queryKeys.pinnedSessions, old =>
                toggleIdInPages(old, sessionId, pinned))

            if (pinned) {
                removeFromGroupedLists(queryClient, sessionId)
            } else {
                restoreToGroup(queryClient, sessionId, resolveGroupRestoreKey(queryClient, sessionId))
            }

            // 真值补偿不再在这里做：daemon 对置顶/归属变更广播 session-updated 且显式带
            // affects: 'membership'，SSE 侧据此失效工作区视图——本端也收得到那条事件。
            // 两边都失效会**各拉一遍**全部工作区视图（2026-10-28 实测一次置顶 20 个 GET，
            // 其中 10 个是本端多余的一次）。断连窗口内漏掉的事件由 SSE 重连时的
            // resyncAfterGap 对账补回，不依赖此处的补偿。
        },
    })
}
