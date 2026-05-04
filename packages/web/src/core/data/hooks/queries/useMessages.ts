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
import { useAuthStore } from '@/core/data/stores/authStore'
import { useMobiApi } from '@/core/data/api/client'
import type { DecryptedMessage, MessagesResponse } from '@/core/data/api/types'
import { queryKeys } from '@/core/lib/query-keys'

/**
 * 获取会话消息列表（分页）
 * 使用 useInfiniteQuery 支持向上滚动加载历史消息
 */
export function useMessages(sessionId: string | null) {
    const { token } = useAuthStore()
    const api = useMobiApi(token)

    return useInfiniteQuery<MessagesResponse, Error, DecryptedMessage[]>({
        queryKey: queryKeys.messages(sessionId!),
        queryFn: async ({ pageParam }) => {
            if (!sessionId) {
                return {
                    messages: [],
                    page: { limit: 0, beforeSeq: null, nextBeforeSeq: null, hasMore: false },
                }
            }
            const res = await api.messages.list(sessionId, {
                before: pageParam as number | undefined,
            })
            return res.data
        },
        initialPageParam: undefined as number | undefined,
        getNextPageParam: (lastPage) => {
            if (!lastPage.page.hasMore || lastPage.page.nextBeforeSeq === null) {
                return undefined
            }
            return lastPage.page.nextBeforeSeq
        },
        select: (data) => {
            // pages: [最新页, 更旧页, ...]
            // 每页内部按 seq 升序（从旧到新）
            // 合并为全局升序: [...更旧页, ...最新页]
            return data.pages
                .slice()
                .reverse()
                .flatMap((page) => page.messages)
        },
        enabled: !!token && !!sessionId,
        staleTime: Infinity,
    })
}
