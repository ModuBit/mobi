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
import { queryKeys } from '@/core/lib/query-keys'
import { invalidateProjectViews } from '@/core/lib/invalidateProjectViews'

/**
 * 置顶 / 取消置顶会话。
 * 置顶改变「置顶」「项目」「最近」三个分组视图的成员（invalidateProjectViews 收口，
 * pinnedSessions 已并入其中），成功后连带刷新会话本体与全局缓存
 */
export function useSetSessionPinned() {
    const api = useMobiApi()
    const queryClient = useQueryClient()

    return useMutation({
        mutationFn: async ({ sessionId, pinned }: { sessionId: string; pinned: boolean }) => {
            await api.sessions.setPinned(sessionId, pinned)
        },
        onSuccess: async (_data, variables) => {
            await Promise.all([
                queryClient.invalidateQueries({ queryKey: queryKeys.session(variables.sessionId) }),
                queryClient.invalidateQueries({ queryKey: queryKeys.sessions }),
                invalidateProjectViews(queryClient),
            ])
        },
    })
}
