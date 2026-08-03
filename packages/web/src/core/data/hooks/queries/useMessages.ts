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

import { useCallback, useEffect, useSyncExternalStore } from 'react'
import { useMobiApi } from '@/core/data/api/client'
import type { DecryptedMessage } from '@/core/data/api/types'
import {
    fetchLatestMessages,
    fetchOlderMessages,
    getMessageWindowState,
    subscribeMessageWindow,
    EMPTY_STATE,
} from '@/core/data/stores/messageWindowStore'

/**
 * 获取会话消息列表（自管 store，替代 useInfiniteQuery）
 *
 * 数据源从 react-query 切换到 messageWindowStore（useSyncExternalStore），
 * SSE 增量直接写 store，hook 自动重选，无需 invalidate 缓存。
 *
 * @param sessionId 会话 id
 * @param select 可选投影（如排队子集 / 是否存在布尔）。
 *   注意：与 react-query 的结构化共享不同，select 每次 render 产生新引用，
 *   订阅方可能因此多渲染——已知 trade-off，后续按需优化。
 *   useSyncExternalStore 的 getSnapshot 返回 state 对象（稳定引用），
 *   select 在 hook body 算，不在 getSnapshot 里，不会触发无限循环。
 */
export function useMessages<T = DecryptedMessage[]>(
    sessionId: string | null,
    select?: (messages: DecryptedMessage[]) => T,
) {
    const api = useMobiApi()
    const state = useSyncExternalStore(
        useCallback(l => sessionId ? subscribeMessageWindow(sessionId, l) : () => {}, [sessionId]),
        useCallback(() => sessionId ? getMessageWindowState(sessionId) : EMPTY_STATE, [sessionId]),
        () => EMPTY_STATE,
    )

    useEffect(() => {
        if (!api || !sessionId) return
        void fetchLatestMessages(api, sessionId)
    }, [api, sessionId])

    const messages = state.messages
    const projected = select ? select(messages) : (messages as unknown as T)
    return {
        data: projected,
        messages,
        hasNextPage: state.hasMore,
        isLoading: state.isLoading,
        isFetchingNextPage: state.isLoadingMore,
        fetchNextPage: useCallback(() => api && sessionId ? fetchOlderMessages(api, sessionId) : Promise.resolve(), [api, sessionId]),
    }
}
