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
import { useAuthStore } from '@/stores/authStore'
import { useMobiApi } from '@/api/client'

/**
 * 发送消息 Mutation Hook
 */
export function useSendMessage(sessionId: string) {
    const { token } = useAuthStore()
    const api = useMobiApi(token)
    const queryClient = useQueryClient()

    return useMutation({
        mutationFn: (text: string) => {
            const localId = `local-${Date.now()}`
            return api.messages.send(sessionId, text, localId)
        },
        onSuccess: () => {
            // 发送成功后刷新消息列表
            queryClient.invalidateQueries({ queryKey: ['messages', sessionId] })
        }
    })
}
