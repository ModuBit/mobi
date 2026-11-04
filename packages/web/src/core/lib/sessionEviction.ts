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
import { invalidateSessionViews } from '@/core/lib/invalidateViews'
import { clearMessageWindow } from '@/core/data/stores/messageWindowStore'
import { clearSessionResources } from '@/core/lib/sessionResources'

/**
 * 会话离场清理（架构审查候选 A）：「会话从客户端消失」的编排单源——
 * 详情缓存移除 → 消息窗口清理 → 会话资源清理（检视面板 + 终端 PTY）→ 视图失效收尾。
 *
 * 桌面单删 / 移动端删除 / 归档页批量删除 / 详情页动作删除共用此收口；
 * 此前四处各抄一遍且顺序漂移（有的漏失效分组视图靠 SSE 兜底）。顺序约定：
 * 资源清理依赖会话还在 store 里（terminalId 可读），故必须在 invalidate 之前完成。
 */
export async function evictSession(
    queryClient: QueryClient,
    sessionIds: string | Iterable<string>,
): Promise<void> {
    const ids = typeof sessionIds === 'string' ? [sessionIds] : Array.from(new Set(sessionIds))
    for (const id of ids) {
        queryClient.removeQueries({ queryKey: queryKeys.session(id) })
        clearMessageWindow(id)
        clearSessionResources(id)
    }
    await invalidateSessionViews(queryClient, ids)
}
