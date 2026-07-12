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
import type { InfiniteData } from '@tanstack/react-query'
import { useMobiApi } from '@/core/data/api/client'
import { queryKeys } from '@/core/lib/query-keys'
import type { MessagesResponse } from '@/core/data/api/types'

/**
 * 取消排队消息 Mutation Hook
 *
 * onMutate 立即从缓存移除该 localId 的消息（乐观删除）。
 * - 成功且 status='cancelled'：消息确已删除，乐观删除即终态
 * - 成功且 status='invoked'：CLI 抢先消费，乐观已移除但服务端仍会处理 → 失效重拉以恢复一致
 * - 失败：失效重拉，恢复被乐观删除的消息
 */
export function useCancelQueuedMessage(sessionId: string) {
    const api = useMobiApi()
    const qc = useQueryClient()

    return useMutation({
        mutationFn: (localId: string) => api.messages.cancel(sessionId, localId),
        onMutate: async (localId: string) => {
            await qc.cancelQueries({ queryKey: queryKeys.messages(sessionId) })
            qc.setQueryData<InfiniteData<MessagesResponse>>(queryKeys.messages(sessionId), (old) => {
                if (!old) return old
                return {
                    ...old,
                    pages: old.pages.map(p => ({
                        ...p,
                        messages: p.messages.filter(m => m.localId !== localId),
                    })),
                }
            })
        },
        onSuccess: (res) => {
            // 已 invoke（CLI 抢先消费）→ 失效重拉以恢复一致
            if (res.data.status === 'invoked') {
                qc.invalidateQueries({ queryKey: queryKeys.messages(sessionId) })
            }
        },
        onError: () => qc.invalidateQueries({ queryKey: queryKeys.messages(sessionId) }),
    })
}
