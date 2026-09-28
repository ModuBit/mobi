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

/**
 * git 审查数据 hooks（turn-diff 审查视图，票05）：总览 + 单文件 diff。
 * 响应可能是业务错误形状（{success:false,error}）——这里统一收窄成
 * { data | error }，组件不碰原始形状。
 */

import { useQuery } from '@tanstack/react-query'
import { GitReviewDataSchema, GitReviewFileDiffSchema, type GitReviewData, type GitReviewFileDiff, type GitReviewFileQuery } from '@mobi/shared'
import { useMobiApi } from '@/core/data/api/client'
import { queryKeys } from '@/core/lib/query-keys'

export interface ReviewDataResult {
    data: GitReviewData | undefined
    error: string | null
    isLoading: boolean
    /** 总览拉取时间（ms）——单文件 diff 缓存的失效版本源：总览每次刷新，展开行 diff 全部重查 */
    updatedAt: number
    refetch: () => void
}

/** 审查总览（四档一次拉；会话休眠也能拉到——machine 通道，与 CLI 侧实现解耦） */
export function useGitReviewData(sessionId: string): ReviewDataResult {
    const api = useMobiApi()
    const query = useQuery({
        queryKey: queryKeys.gitReview(sessionId),
        queryFn: async ({ signal }) => {
            const res = await api.sessions.gitReview(sessionId, { signal })
            const parsed = GitReviewDataSchema.safeParse(res.data)
            if (parsed.success) return { data: parsed.data } as const
            // 业务错误形状（{success:false,error}）：转文案，不进 data
            const err = (res.data as { error?: string } | undefined)?.error
            return { error: err ?? 'Failed to load git review' } as const
        },
        enabled: !!sessionId,
    })

    return {
        data: query.data?.data,
        error: query.data?.error ?? (query.error ? String(query.error) : null),
        isLoading: query.isLoading,
        updatedAt: query.dataUpdatedAt,
        refetch: () => void query.refetch(),
    }
}

export interface ReviewFileDiffResult {
    data: GitReviewFileDiff | undefined
    error: string | null
    isLoading: boolean
}

/** 单文件 diff 三件套；query 为 null 时不拉（未选文件）。
 *  version = 审查总览的拉取时间——协议只发 {scope, path}，指针已收口到 CLI；
 *  总览刷新（新一轮完成/手动 refetch）→ version 变 → 展开行 diff 缓存自动失效重查 */
export function useGitReviewFileDiff(sessionId: string, query: GitReviewFileQuery | null, version: number): ReviewFileDiffResult {
    const api = useMobiApi()
    const q = useQuery({
        queryKey: queryKeys.gitReviewFile(sessionId, query?.scope ?? '', query?.path ?? '', String(version)),
        queryFn: async () => {
            if (!query) return null
            const res = await api.sessions.gitReviewFile(sessionId, query)
            const parsed = GitReviewFileDiffSchema.safeParse(res.data)
            if (parsed.success) return { data: parsed.data } as const
            const err = (res.data as { error?: string } | undefined)?.error
            return { error: err ?? 'Failed to load diff' } as const
        },
        enabled: !!sessionId && !!query,
    })

    return {
        data: q.data?.data ?? undefined,
        error: q.data?.error ?? (q.error ? String(q.error) : null),
        isLoading: !!query && q.isLoading,
    }
}
