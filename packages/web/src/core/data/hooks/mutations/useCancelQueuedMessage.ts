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
import { requestComposerBackfill } from '@/core/data/stores/composerBackfillStore'
import type { ComposerSegments } from '@/domain/chat/composerSegments'

/**
 * 取消变量。localId 为取消目标；backfill 仅编辑取消时携带——
 * 取消成功后需把原分段回填 composer，而悬浮条（请求方）会因 onMutate 乐观移除
 * 在 mutation settle 前**卸载**，mutate 的 per-call 回调被 react-query 丢弃
 * （MutationObserver#notify 的 hasListeners 守卫）。故回填不在调用方回调里做：
 * 载荷随 variables 进 hook，钩子级 onSuccess 在 mutation 本体执行（卸载后仍运行），
 * 写入 composerBackfillStore 由长命的 ChatContainer 消费回填。
 */
export interface CancelQueuedMessageVariables {
    localId: string
    /** 编辑取消的回填载荷：segments 结构化还原（null → originalText 纯文本兜底） */
    backfill?: { segments: ComposerSegments | null; originalText: string | null }
}

/**
 * 取消排队消息 Mutation Hook
 *
 * onMutate 立即从 store 移除该 localId 的消息（乐观删除）。
 * - 成功且 status='cancelled'：消息确已删除，乐观删除即终态；编辑取消时经信箱回填 composer
 * - 成功且 status='submitted'：CLI 抢先提交，乐观已移除但服务端仍会处理 → fetchLatest 恢复一致；
 *   编辑取消时经信箱渲染 alreadySubmitted 提示
 * - 失败：fetchLatest 恢复被乐观删除的消息
 */
export function useCancelQueuedMessage(sessionId: string) {
    const api = useMobiApi()

    return useMutation({
        mutationFn: (vars: CancelQueuedMessageVariables) => api.messages.cancel(sessionId, vars.localId),
        onMutate: (vars: CancelQueuedMessageVariables) => {
            removeOptimisticMessage(sessionId, vars.localId)
        },
        onSuccess: (res, vars) => {
            if (res.data.status === 'cancelled') {
                // 编辑取消：回填载荷交长命组件消费（纯取消无载荷不写信箱）
                if (vars.backfill) {
                    requestComposerBackfill(sessionId, {
                        localId: vars.localId,
                        segments: vars.backfill.segments,
                        originalText: vars.backfill.originalText,
                    })
                }
                return
            }
            // 已被 agent 处理（CLI 抢先提交）→ fetchLatest 恢复一致；
            // 编辑语义下再经信箱渲染提示（无回填载荷）
            if (vars.backfill) {
                requestComposerBackfill(sessionId, {
                    localId: vars.localId,
                    segments: null,
                    originalText: null,
                    notice: 'alreadySubmitted',
                })
            }
            if (api) void fetchLatestMessages(api, sessionId)
        },
        onError: () => {
            if (api) void fetchLatestMessages(api, sessionId)
        },
    })
}
