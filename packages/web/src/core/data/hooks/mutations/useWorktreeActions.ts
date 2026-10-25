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
import type { MergeBackRequest } from '@mobi/shared'
import { useMobiApi } from '@/core/data/api/client'
import { queryKeys } from '@/core/lib/queryKeys'

/**
 * worktree 处置动作（合回主树 / 丢弃）。结果 union 原样返回——拒绝原因与冲突清单
 * 由呈现层映射文案，hook 不吞错。成功后失效 worktree 列表（工作区/会话缓存由
 * 消费方按需刷新：合并只动主仓库文件，不改会话行）。
 */
export function useWorktreeActions() {
    const api = useMobiApi()
    const queryClient = useQueryClient()
    const invalidate = () => queryClient.invalidateQueries({ queryKey: queryKeys.worktrees })

    const mergeMutation = useMutation({
        mutationFn: async (request: MergeBackRequest) => (await api.worktrees.mergeBack(request)).data,
        onSettled: () => invalidate()
    })
    const discardMutation = useMutation({
        mutationFn: async (worktreePath: string) => (await api.worktrees.discard(worktreePath)).data,
        onSettled: () => invalidate()
    })

    return {
        mergeBack: mergeMutation.mutateAsync,
        discard: discardMutation.mutateAsync,
        merging: mergeMutation.isPending,
        discarding: discardMutation.isPending
    }
}
