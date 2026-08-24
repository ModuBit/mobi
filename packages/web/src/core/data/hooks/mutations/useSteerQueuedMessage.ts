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
import { fetchLatestMessages } from '@/core/data/stores/messageWindowStore'

/**
 * steer 排队消息 Mutation Hook
 *
 * 把仍排队（lifecycle='queued'）的消息提前提交给 Claude Code SDK input stream。
 * 提交成功后由 SSE messages-submitted 事件把消息移出 QueuedMessagesBar 并进主 timeline。
 * 无论成功失败都失效重拉，确保与服务端一致（lifecycle 推进态、是否已不在队列）。
 */
export function useSteerQueuedMessage(sessionId: string) {
    const api = useMobiApi()

    return useMutation({
        mutationFn: (localId: string) => api.messages.steer(sessionId, localId),
        onSettled: () => {
            // 重新拉首页消息，确保与服务端一致（submitted 状态、是否已不在队列）
            void fetchLatestMessages(api, sessionId)
        },
    })
}
