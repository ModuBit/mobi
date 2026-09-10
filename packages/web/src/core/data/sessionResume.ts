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
import { invalidateSessionViews } from '@/core/lib/invalidateProjectViews'

/**
 * 恢复会话并收敛所有以会话身份为索引的查询缓存。
 *
 * Hub 恢复后可能返回不同的权威会话 ID；调用方只需要消费返回值，
 * 无需分别维护旧详情、新详情、全局列表与项目视图的失效规则。
 */
export async function resumeSession(
    api: MobiApi,
    sourceSessionId: string,
    queryClient: QueryClient,
): Promise<string> {
    const response = await api.sessions.resume(sourceSessionId)
    const resumedSessionId = response.data.sessionId
    await invalidateSessionViews(queryClient, [sourceSessionId, resumedSessionId])
    return resumedSessionId
}
