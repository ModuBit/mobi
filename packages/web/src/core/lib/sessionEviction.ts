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

import type { QueryClient } from '@tanstack/react-query'
import { queryKeys } from '@/core/lib/queryKeys'
import { invalidateWorkspaceViews } from '@/core/lib/invalidateViews'
import { clearMessageWindow } from '@/core/data/stores/messageWindowStore'
import { clearSessionResources } from '@/core/lib/sessionResources'
import { clearAttentionState } from '@/core/notifications/attentionFeedback'
import { usePromptSuggestionStore } from '@/core/data/stores/promptSuggestionStore'

/**
 * 单会话瞬态清理全集（架构审查候选 A 收口）：会话从客户端消失时要一并清掉的
 * 所有 per-session 瞬时状态——消息窗口、会话资源（检视面板 + 终端 PTY）、未读
 * 关注态、prompt 建议缓存。本地乐观路径（evictSession）与 SSE 推送路径
 * （session-removed）共用此清单，成员只维护这一处。
 */
export function clearSessionTransientState(sessionId: string): void {
    clearMessageWindow(sessionId)
    clearSessionResources(sessionId)
    clearAttentionState(sessionId)
    // 清理该 session 的瞬时建议, 避免删除会话后 bySession Map 残留
    usePromptSuggestionStore.getState().clearSession(sessionId)
}

/**
 * 会话离场清理（架构审查候选 A）：「会话从客户端消失」的编排单源——
 * 详情缓存移除 → 瞬态清理全集 → 视图失效收尾。
 *
 * 桌面单删 / 移动端删除 / 归档页批量删除 / 详情页动作删除共用此收口；
 * 此前四处各抄一遍且顺序漂移（有的漏失效分组视图靠 SSE 兜底）。顺序约定：
 * 资源清理依赖会话还在 store 里（terminalId 可读），故必须在 invalidate 之前完成。
 *
 * 失效只走列表维度（['sessions'] + 工作区视图）：详情键已在上面 remove——
 * 「缓存该删」与「缓存该重拉」分层（invalidateSessionViews 的详情失效语义是
 * 「会话仍存在但身份变更」，删除场景不适用）。
 */
export async function evictSession(
    queryClient: QueryClient,
    sessionIds: string | Iterable<string>,
): Promise<void> {
    const ids = typeof sessionIds === 'string' ? [sessionIds] : Array.from(new Set(sessionIds))
    for (const id of ids) {
        queryClient.removeQueries({ queryKey: queryKeys.session(id) })
        clearSessionTransientState(id)
    }
    await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.sessions }),
        invalidateWorkspaceViews(queryClient),
    ])
}
