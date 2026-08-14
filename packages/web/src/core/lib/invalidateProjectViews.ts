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
import { queryKeys } from '@/core/lib/query-keys'

/**
 * 统一失效「项目维度视图」缓存：
 * - ['projects']：项目列表本身
 * - ['recentSessions']：「最近」分组
 * - ['pinnedSessions']：「置顶」分组
 * - ['projectSessions', *]：所有项目的会话分组（根前缀匹配）
 *
 * 会话增删/归属变更/项目删除都会改变各分组视图的 sessionIds 成员，
 * 三键必须连带刷新，否则新会话不出现 / 删除会话残留。
 * 收口此前的散布硬编码（SSEProvider 批处理、项目 mutations、侧边栏/移动端列表）。
 */
export async function invalidateProjectViews(queryClient: QueryClient): Promise<void> {
    await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.projects }),
        queryClient.invalidateQueries({ queryKey: queryKeys.recentSessions }),
        queryClient.invalidateQueries({ queryKey: queryKeys.pinnedSessions }),
        queryClient.invalidateQueries({ queryKey: queryKeys.projectSessionsRoot }),
    ])
}
