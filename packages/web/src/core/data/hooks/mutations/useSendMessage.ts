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
import { makeClientSideId } from '@/core/lib/messages'

/**
 * 发送消息 Mutation Hook
 */
export function useSendMessage(sessionId: string) {
    const api = useMobiApi()

    return useMutation({
        mutationFn: (text: string) => {
            const localId = makeClientSideId('local')
            if (import.meta.env.DEV) console.log('[Send] api.messages.send', { sessionId, localId, textLen: text.length })
            return api.messages.send(sessionId, text, localId)
        },
        onSuccess: () => {
            if (import.meta.env.DEV) console.log('[Send] 发送请求成功')
        },
        onError: (error) => {
            // SSE 会推送正确状态，此处仅记录错误
            console.error('[Send] 发送消息失败:', error)
        }
    })
}
