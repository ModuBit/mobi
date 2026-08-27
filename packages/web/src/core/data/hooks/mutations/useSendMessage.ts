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
import type { UserContentBlock } from '@mobi/shared'
import { useMobiApi } from '@/core/data/api/client'
import { makeClientSideId } from '@/core/lib/messages'
import { serializeSegments, type ComposerSegments } from '@/domain/chat/composerSegments'
import { appendOptimisticMessage, fetchLatestMessages } from '@/core/data/stores/messageWindowStore'
import { useRewindStore } from '@/core/data/stores/rewindStore'
import type { DecryptedMessage } from '@/core/data/api/types'

/**
 * 发送消息 Mutation Hook
 *
 * 入参为 Composer 分段（text + 附件双桶 + 引用），内部 serializeSegments 转
 * UserContentBlock[] 后以 { content: blocks } 新格式直传 hub——不再拼接 @path 文本。
 *
 * 发送时立即在 store 追加一条乐观气泡：
 * - 会话运行中 → status='queued'（悬浮条展示，等待 agent 消费）
 * - 会话未运行 → status='sending'（服务端收到即入库回显）
 *
 * 关键：乐观 localId 必须与服务端发送 localId 一致，否则服务端 echo
 * 无法通过 mergeMessages 的 localId 去重替换乐观气泡。
 * 因此在 mutate(segments) 时生成一次 localId，与 blocks 一起传入。
 */
export function useSendMessage(sessionId: string, isRunning: boolean) {
    const api = useMobiApi()

    const mutation = useMutation({
        mutationFn: (vars: { blocks: UserContentBlock[]; localId: string }) => {
            if (import.meta.env.DEV) {
                console.log('[Send] api.messages.send', { sessionId, localId: vars.localId, blocksLen: vars.blocks.length })
            }
            return api.messages.send(sessionId, vars.blocks, vars.localId)
        },
        onMutate: async (vars: { blocks: UserContentBlock[]; localId: string }) => {
            // 乐观气泡：content 信封持 blocks 数组，与 hub messageService.sendMessage 落库形态同构。
            // positionAt / createdAt 共用同一发送时刻；lifecycleAt 仅排队轨道携带
            //（= createdAt，对齐 hub「queued 时 lifecycle_at = created_at」契约），
            // 非排队轨道恒 null——否则服务端 echo 被 mergeMessages 第 (1) 步无条件
            // 继承乐观 lifecycleAt，永久携带 lifecycle=null + 伪时间戳的非法组合
            const now = Date.now()
            const optimistic: DecryptedMessage = {
                id: vars.localId,
                seq: null,
                localId: vars.localId,
                lifecycleAt: isRunning ? now : null,
                // running 中发送 → 进排队轨道（lifecycle='queued'，悬浮展示）；
                // 否则 sending（在途开新 turn，不进悬浮条）
                lifecycle: isRunning ? 'queued' as const : null,
                positionAt: now,
                content: {
                    role: 'user',
                    content: vars.blocks,
                    meta: { sentFrom: 'webapp' },
                },
                createdAt: now,
                status: isRunning ? 'queued' : 'sending',
            }
            appendOptimisticMessage(sessionId, optimistic)
            // 用户发新消息 = 新对话开始，清除 rewind 终态快照（「已回退至此」分隔线随之消失）
            useRewindStore.getState().clearCompletion(sessionId)
            return { localId: vars.localId }
        },
        onSuccess: () => {
            if (import.meta.env.DEV) console.log('[Send] 发送请求成功')
        },
        onError: (error) => {
            console.error('[Send] 发送消息失败:', error)
            // 失败时 fetchLatest 让 store 与服务端一致（服务端无此消息 → 乐观气泡被 merge 丢弃）
            if (api) void fetchLatestMessages(api, sessionId)
        },
    })

    // 对外暴露统一的 mutate(segments)/mutateAsync(segments) 接口（内部生成 localId 并把
    // 分段序列化为 blocks，保证 onMutate 与 mutationFn 用同一份产物）。必须同时覆盖两者——
    // 只覆盖 mutate 会让展开的 mutateAsync 仍按旧签名工作，调用方传参错位会丢 localId，
    // 导致服务端 echo 无法按 localId 去重乐观气泡 → 重复消息。
    const send = (segments: ComposerSegments): { blocks: UserContentBlock[]; localId: string } => ({
        blocks: serializeSegments(segments),
        localId: makeClientSideId('local'),
    })
    return {
        ...mutation,
        mutate: (segments: ComposerSegments) => mutation.mutate(send(segments)),
        mutateAsync: (segments: ComposerSegments) => mutation.mutateAsync(send(segments)),
    }
}
