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

import { useQuery } from '@tanstack/react-query'
import { useMobiApi } from '@/core/data/api/client'
import { queryKeys } from '@/core/lib/queryKeys'

/**
 * 本机 mobi worktree 列表（设置页管理区 + 会话吊顶 worktree 弹层共用）。
 * 扫描会跑 git（脏判定），staleTime 压到 5s：同一页面内的多处消费共享一次请求，
 * 用户动作（合回/丢弃）后由 mutation 主动失效，不靠轮询。
 */
export function useWorktrees(options: { enabled?: boolean } = {}) {
    const api = useMobiApi()
    return useQuery({
        queryKey: queryKeys.worktrees,
        queryFn: async () => (await api.worktrees.list()).data.worktrees,
        staleTime: 5_000,
        refetchOnWindowFocus: true,
        retry: false,
        enabled: options.enabled ?? true
    })
}
