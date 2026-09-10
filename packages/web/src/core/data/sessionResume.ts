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
import type { MobiApi } from '@/core/data/api/client'
import { invalidateSessionViews } from '@/core/lib/invalidateViews'

/**
 * 恢复会话并返回 Hub 确认的权威会话 ID。
 *
 * 调用方只消费返回值（路由替换 / 动作重放 / 反馈都以此为准），
 * 缓存收敛（旧详情、新详情、全局列表、项目视图）由 module 一并触发。
 */
export async function resumeSession(
    api: MobiApi,
    sourceSessionId: string,
    queryClient: QueryClient,
): Promise<string> {
    const response = await api.sessions.resume(sourceSessionId)
    // Hub 未回带 ID（CLI 不预生成 id 的 pre-SDK 窗口）时沿用原 ID——resume 本身已成功
    const resumedSessionId = response.data.sessionId || sourceSessionId
    // 收敛不阻塞也不参与结果语义：invalidated 标记在 invalidateQueries 的同步段即已落盘，
    // 挂载中的查询自会 refetch；refetch 失败不代表 resume 失败，不得翻转已成功的结果
    void invalidateSessionViews(queryClient, [sourceSessionId, resumedSessionId]).catch(() => undefined)
    return resumedSessionId
}
