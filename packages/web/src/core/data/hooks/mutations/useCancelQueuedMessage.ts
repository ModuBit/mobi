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

import { useMutation } from '@tanstack/react-query'
import { useMobiApi } from '@/core/data/api/client'
import { removeOptimisticMessage, fetchLatestMessages } from '@/core/data/stores/messageWindowStore'

/**
 * 取消排队消息 Mutation Hook
 *
 * onMutate 立即从 store 移除该 localId 的消息（乐观删除）。
 * - 成功且 status='cancelled'：消息确已删除，乐观删除即终态
 * - 成功且 status='submitted'：CLI 抢先提交，乐观已移除但服务端仍会处理 → fetchLatest 恢复一致
 * - 失败：fetchLatest 恢复被乐观删除的消息
 */
export function useCancelQueuedMessage(sessionId: string) {
    const api = useMobiApi()

    return useMutation({
        mutationFn: (localId: string) => api.messages.cancel(sessionId, localId),
        onMutate: (localId: string) => {
            removeOptimisticMessage(sessionId, localId)
        },
        onSuccess: (res) => {
            // 已 invoke（CLI 抢先提交）→ fetchLatest 恢复一致
            if (res.data.status === 'submitted') {
                if (api) void fetchLatestMessages(api, sessionId)
            }
        },
        onError: () => {
            if (api) void fetchLatestMessages(api, sessionId)
        },
    })
}
