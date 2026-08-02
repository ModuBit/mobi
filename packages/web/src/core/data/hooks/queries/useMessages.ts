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
import type { InfiniteData } from '@tanstack/react-query'
import { useMobiApi } from '@/core/data/api/client'
import type { DecryptedMessage, MessagesResponse } from '@/core/data/api/types'
import { queryKeys } from '@/core/lib/query-keys'
import { flattenMessagesPages } from '@/core/lib/messages'

/**
 * 获取会话消息列表（分页）
 * 使用 useInfiniteQuery 支持向上滚动加载历史消息
 *
 * @param select 可选派生函数：在展平的全部消息上做投影（如排队子集 / 是否存在布尔）。
 *   利用 react-query 结构化共享：select 输出做深比较，未变化不触发组件重渲染。
 *   例：订阅「是否存在排队消息」时只返回 boolean，仅在该布尔翻转时重渲染，
 *   避免每条消息变动都重渲染订阅方。
 */
export function useMessages<T = DecryptedMessage[]>(
    sessionId: string | null,
    select?: (messages: DecryptedMessage[]) => T,
) {
    const api = useMobiApi()

    return useInfiniteQuery<MessagesResponse, Error, T>({
        queryKey: queryKeys.messages(sessionId!),
        queryFn: async ({ pageParam }) => {
            if (!sessionId) {
                return {
                    messages: [],
                    page: { limit: 0, beforeSeq: null, nextBeforeSeq: null, hasMore: false },
                }
            }
            const res = await api.messages.list(sessionId, {
                beforeSeq: pageParam as number | undefined,
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
        select: (data: InfiniteData<MessagesResponse>) => {
            // pages: [最新页, 更旧页, ...]，每页内部按 seq 升序（旧→新）。
            // 反转后用 flattenMessagesPages 跨页合并并按 id 去重（防游标漂移导致重叠页重复）。
            const flat = flattenMessagesPages(data.pages.slice().reverse())
            return (select ? select(flat) : flat) as T
        },
        enabled: !!sessionId,
        staleTime: Infinity,
    })
}
