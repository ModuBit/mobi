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
import { makeClientSideId } from '@/core/lib/messages'
import { queryKeys } from '@/core/lib/query-keys'
import type { DecryptedMessage, MessagesResponse } from '@/core/data/api/types'

/**
 * 发送消息 Mutation Hook
 *
 * 发送时立即在最新页（pages[0]）追加一条乐观气泡：
 * - 会话运行中 → status='queued'（悬浮条展示，等待 agent 消费）
 * - 会话未运行 → status='sending'（服务端收到即入库回显）
 *
 * 关键：乐观 localId 必须与服务端发送 localId 一致，否则服务端 echo
 * 无法通过 mergeMessages 的 localId 去重替换乐观气泡。
 * 因此在 mutate(text) 时生成一次 localId，作为 { text, localId } 传入。
 */
export function useSendMessage(sessionId: string, isRunning: boolean) {
    const api = useMobiApi()
    const qc = useQueryClient()

    const mutation = useMutation({
        mutationFn: (vars: { text: string; localId: string }) => {
            if (import.meta.env.DEV) {
                console.log('[Send] api.messages.send', { sessionId, localId: vars.localId, textLen: vars.text.length })
            }
            return api.messages.send(sessionId, vars.text, vars.localId)
        },
        onMutate: async (vars: { text: string; localId: string }) => {
            // 取消在途查询，避免乐观更新被分页回填覆盖
            await qc.cancelQueries({ queryKey: queryKeys.messages(sessionId) })

            // 乐观气泡：content 信封与 hub messageService.sendMessage 保持一致
            const optimistic: DecryptedMessage = {
                id: vars.localId,
                seq: null,
                localId: vars.localId,
                submittedAt: null,
                content: {
                    role: 'user',
                    content: { type: 'text', text: vars.text, attachments: undefined },
                    meta: { sentFrom: 'webapp' },
                },
                createdAt: Date.now(),
                status: isRunning ? 'queued' : 'sending',
            }

            qc.setQueryData<InfiniteData<MessagesResponse>>(queryKeys.messages(sessionId), (old) => {
                if (!old) return old
                const firstPage = old.pages[0]
                if (!firstPage) return old
                // 最新页内部按 seq 升序，乐观消息追加到末尾（最新）
                const newFirst = { ...firstPage, messages: [...firstPage.messages, optimistic] }
                return { ...old, pages: [newFirst, ...old.pages.slice(1)] }
            })

            return { localId: vars.localId }
        },
        onSuccess: () => {
            if (import.meta.env.DEV) console.log('[Send] 发送请求成功')
        },
        onError: (error) => {
            console.error('[Send] 发送消息失败:', error)
            // 失败时 invalidate，让缓存重新拉取（服务端无此消息 → 乐观气泡被丢弃）
            qc.invalidateQueries({ queryKey: queryKeys.messages(sessionId) })
        },
    })

    // 对外暴露统一的 mutate(text)/mutateAsync(text) 接口（内部生成 localId，
    // 保证 onMutate 与 mutationFn 用同一个）。必须同时覆盖两者——只覆盖 mutate 会让
    // 展开的 mutateAsync 仍按 {text,localId} 签名工作，调用方传 text 会丢 localId，
    // 导致服务端 echo 无法按 localId 去重乐观气泡 → 重复消息。
    const send = (text: string): { text: string; localId: string } => ({
        text,
        localId: makeClientSideId('local'),
    })
    return {
        ...mutation,
        mutate: (text: string) => mutation.mutate(send(text)),
        mutateAsync: (text: string) => mutation.mutateAsync(send(text)),
    }
}
