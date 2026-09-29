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

import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import {
    GitReviewDataSchema,
    GitReviewFileDiffSchema,
    ReviewCommitsResultSchema,
    ReviewContentsResultSchema,
    ReviewFilesResultSchema,
    ReviewOverviewSchema,
    ReviewPatchResultSchema,
    type DiffTarget,
    type GitReviewData,
    type GitReviewFileDiff,
    type GitReviewFileQuery,
    type ReviewCommitsResult,
    type ReviewContentsResult,
    type ReviewFilesResult,
    type ReviewOverview,
    type ReviewPatchResult,
} from '@mobi/shared'
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

// ── 审查重写 v2（DiffTarget 统一模型，五 hooks）：数据链 = overview → files →
//  patch/contents（pierre hydration 懒拉）。陈旧性：overview 的 targetGeneration
//  作 files/patch 的缓存键 version——总览刷新 → 新一代键 → 下层数据自动重查 ──

export interface ReviewOverviewResult {
    data: ReviewOverview | undefined
    error: string | null
    isLoading: boolean
    refetch: () => void
}

/** 审查总览 v2（逐档可用性 + 各档统计 + 数据版本；会话休眠也能拉——machine 通道） */
export function useReviewOverview(sessionId: string): ReviewOverviewResult {
    const api = useMobiApi()
    const query = useQuery({
        queryKey: queryKeys.gitReviewOverview(sessionId),
        queryFn: async ({ signal }) => {
            const res = await api.sessions.gitReviewOverview(sessionId, { signal })
            const parsed = ReviewOverviewSchema.safeParse(res.data)
            if (parsed.success) return { data: parsed.data } as const
            const err = (res.data as { error?: string } | undefined)?.error
            return { error: err ?? 'Failed to load review overview' } as const
        },
        enabled: !!sessionId,
    })
    return {
        data: query.data?.data,
        error: query.data?.error ?? (query.error ? String(query.error) : null),
        isLoading: query.isLoading,
        refetch: () => void query.refetch(),
    }
}

export interface ReviewFilesQueryResult {
    data: ReviewFilesResult | undefined
    error: string | null
    isLoading: boolean
}

/** 文件明细 v2：target 为 null 不拉（档位不可用/未定）；version = 总览 targetGeneration */
export function useReviewFiles(sessionId: string, target: DiffTarget | null, version: number | string = ''): ReviewFilesQueryResult {
    const api = useMobiApi()
    const q = useQuery({
        queryKey: queryKeys.gitReviewFiles(sessionId, target ?? { kind: 'turn' }, version),
        queryFn: async () => {
            if (!target) return null
            const res = await api.sessions.gitReviewFiles(sessionId, target)
            const parsed = ReviewFilesResultSchema.safeParse(res.data)
            if (parsed.success) return { data: parsed.data } as const
            const err = (res.data as { error?: string } | undefined)?.error
            return { error: err ?? 'Failed to load review files' } as const
        },
        enabled: !!sessionId && !!target,
    })
    return {
        data: q.data?.data ?? undefined,
        error: q.data?.error ?? (q.error ? String(q.error) : null),
        isLoading: !!target && q.isLoading,
    }
}

export interface ReviewPatchQueryResult {
    data: ReviewPatchResult | undefined
    error: string | null
    isLoading: boolean
}

/** 单文件 patch v2（pierre PatchDiff 主输入）；path 为 null 不拉（未展开） */
export function useReviewPatch(sessionId: string, target: DiffTarget | null, path: string | null, version: number | string = ''): ReviewPatchQueryResult {
    const api = useMobiApi()
    const q = useQuery({
        queryKey: queryKeys.gitReviewPatch(sessionId, target ?? { kind: 'turn' }, path ?? '', version),
        queryFn: async () => {
            if (!target || !path) return null
            const res = await api.sessions.gitReviewDiff(sessionId, target, path)
            const parsed = ReviewPatchResultSchema.safeParse(res.data)
            if (parsed.success) return { data: parsed.data } as const
            const err = (res.data as { error?: string } | undefined)?.error
            return { error: err ?? 'Failed to load diff' } as const
        },
        enabled: !!sessionId && !!target && !!path,
    })
    return {
        data: q.data?.data ?? undefined,
        error: q.data?.error ?? (q.error ? String(q.error) : null),
        isLoading: !!target && !!path && q.isLoading,
    }
}

export interface ReviewContentsQueryResult {
    data: ReviewContentsResult | undefined
    error: string | null
    isLoading: boolean
}

/** 全文对 v2（pierre hydration 懒拉）：enabled 由调用方控制（首次展开上下文才触发） */
export function useReviewContents(sessionId: string, target: DiffTarget | null, path: string | null, enabled: boolean): ReviewContentsQueryResult {
    const api = useMobiApi()
    const q = useQuery({
        queryKey: queryKeys.gitReviewContents(sessionId, target ?? { kind: 'turn' }, path ?? ''),
        queryFn: async () => {
            if (!target || !path) return null
            const res = await api.sessions.gitReviewContents(sessionId, target, path)
            const parsed = ReviewContentsResultSchema.safeParse(res.data)
            if (parsed.success) return { data: parsed.data } as const
            const err = (res.data as { error?: string } | undefined)?.error
            return { error: err ?? 'Failed to load contents' } as const
        },
        enabled: !!sessionId && !!target && !!path && enabled,
    })
    return {
        data: q.data?.data ?? undefined,
        error: q.data?.error ?? (q.error ? String(q.error) : null),
        isLoading: !!target && !!path && enabled && q.isLoading,
    }
}

export interface ReviewCommitsQueryResult {
    /** 已累积的提交列表（翻页追加，按时间倒序） */
    data: ReviewCommitsResult['commits']
    error: string | null
    isLoading: boolean
    /** 底部「加载更多」：hasNext = 还有下一页 */
    loadMore: () => void
    hasNextPage: boolean
    isLoadingMore: boolean
}

/** 历史提交 v2：内部翻页累积（nextCursor = 偏移量，getNextPageParam 直传） */
export function useReviewCommits(sessionId: string): ReviewCommitsQueryResult {
    const api = useMobiApi()
    const q = useInfiniteQuery({
        queryKey: queryKeys.gitReviewCommits(sessionId),
        queryFn: async ({ pageParam }: { pageParam: string | undefined }) => {
            const res = await api.sessions.gitReviewCommits(sessionId, pageParam)
            const parsed = ReviewCommitsResultSchema.safeParse(res.data)
            if (parsed.success) return { data: parsed.data } as const
            const err = (res.data as { error?: string } | undefined)?.error
            return { error: err ?? 'Failed to load commits' } as const
        },
        initialPageParam: undefined as string | undefined,
        getNextPageParam: (last) => last.data?.nextCursor ?? undefined,
        enabled: !!sessionId,
    })
    const pages = q.data?.pages ?? []
    const commits = pages.flatMap((p) => p.data?.commits ?? [])
    return {
        data: commits,
        error: pages.find((p) => p.error)?.error ?? (q.error ? String(q.error) : null),
        isLoading: q.isLoading,
        loadMore: () => void q.fetchNextPage(),
        hasNextPage: q.hasNextPage,
        isLoadingMore: q.isFetchingNextPage,
    }
}
