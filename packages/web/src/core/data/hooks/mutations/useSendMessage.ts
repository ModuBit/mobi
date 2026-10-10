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
 * UserContentBlock[] 后以 { content: blocks } 新格式直传 daemon——不再拼接 @path 文本。
 *
 * 发送时立即在 store 追加一条乐观气泡：
 * - 会话运行中 → status='queued'（悬浮条展示，等待 agent 消费）
 * - 会话未运行 → status='sending'（服务端收到即入库回显）
 *
 * 关键：乐观 localId 必须与服务端发送 localId 一致，否则服务端 echo
 * 无法通过 mergeMessages 的 localId 去重替换乐观气泡。
 * 因此在 mutate(segments) 时生成一次 localId，与 blocks 一起传入。
 *
 * 来源标记（generative-ui 票 03）：sentFrom 诊断标记（'openui' = 交互 UI 回路②
 * 发出），存储/展示与手打消息无差别；乐观气泡 meta 与之一致，避免 echo 合并后翻转。
 */

/** 发送来源：手打缺省 'webapp'；'openui' = fenced openui 块回灌（票 03）；
 *  'app' = 沙箱 app bridge MobiApp.issueNewTurn 回灌（票 06） */
export type SendSource = 'openui' | 'app'

/** 发送变量（mutation 内部词汇）：blocks + localId + 可选来源与档③锚点 */
type SendVars = { blocks: UserContentBlock[]; localId: string; sentFrom?: SendSource; sourceBlock?: string }

export function useSendMessage(sessionId: string, isRunning: boolean) {
    const api = useMobiApi()

    const mutation = useMutation({
        mutationFn: (vars: SendVars) => {
            if (import.meta.env.DEV) {
                console.log('[Send] api.messages.send', { sessionId, localId: vars.localId, blocksLen: vars.blocks.length })
            }
            return api.messages.send(sessionId, vars.blocks, vars.localId, vars.sentFrom, vars.sourceBlock)
        },
        onMutate: async (vars: SendVars) => {
            // 乐观气泡：content 信封持 blocks 数组，与 daemon messageService.sendMessage 落库形态同构。
            // positionAt / createdAt 共用同一发送时刻；lifecycleAt 仅排队轨道携带
            //（= createdAt，对齐 daemon「queued 时 lifecycle_at = created_at」契约），
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
                    // 档③锚点同步进乐观气泡（票 04）：echo 合并不会回填 meta，若只在
                    // 服务端行携带，扫描在运行期读不到锚点、终态翻转要等刷新才发生
                    meta: {
                        sentFrom: vars.sentFrom ?? 'webapp',
                        ...(vars.sentFrom === 'openui' && vars.sourceBlock ? { openuiAnchor: vars.sourceBlock } : {}),
                    },
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
    const send = (segments: ComposerSegments, opts?: { sentFrom?: SendSource; sourceBlock?: string }): SendVars => ({
        blocks: serializeSegments(segments),
        localId: makeClientSideId('local'),
        ...(opts?.sentFrom ? { sentFrom: opts.sentFrom } : {}),
        ...(opts?.sourceBlock ? { sourceBlock: opts.sourceBlock } : {}),
    })
    return {
        ...mutation,
        mutate: (segments: ComposerSegments, opts?: { sentFrom?: SendSource; sourceBlock?: string }) => mutation.mutate(send(segments, opts)),
        mutateAsync: (segments: ComposerSegments, opts?: { sentFrom?: SendSource; sourceBlock?: string }) => mutation.mutateAsync(send(segments, opts)),
    }
}
