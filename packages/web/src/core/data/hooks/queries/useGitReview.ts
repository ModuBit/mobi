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

import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
    ReviewActionResultSchema,
    ReviewCommitsResultSchema,
    ReviewContentsResultSchema,
    ReviewFilesResultSchema,
    ReviewOverviewSchema,
    ReviewPatchResultSchema,
    type DiffTarget,
    type ReviewCommitsResult,
    type ReviewContentsResult,
    type ReviewFilesResult,
    type ReviewOverview,
    type ReviewPatchResult,
} from '@mobi/shared'
import { useMobiApi, type MobiApi } from '@/core/data/api/client'
import { queryKeys } from '@/core/lib/query-keys'

// ── 审查 v2（DiffTarget 统一模型，六 hooks）：数据链 = overview → files →
//  patch/contents（pierre hydration 懒拉）。陈旧性：overview 的 targetGeneration
//  作 files/patch 的缓存键 version——总览刷新 → 新一代键 → 下层数据自动重查 ──

/** RPC 查询的缓存载荷（{data}|{error} 包装，不抛错走 retry；可选属性合成让消费方
 *  .data/.error 直接可访问，无需 in 收窄） */
type ReviewQueryPayload<T> = { data: T; error?: undefined } | { error: string; data?: undefined }

/** zod schema 的最小结构面（web 不直依赖 zod，结构类型承接 safeParse） */
interface SafeParseable<T> {
    safeParse(data: unknown): { success: true; data: T } | { success: false }
}

/** RPC 响应收窄单源：schema 通过给 {data}，否则取业务 error 兜底 fallback。
 *  ⚠️ 同一 query key 的所有观察者必须共用同一 queryFn（工厂见下）——形状分叉会让
 *  后挂载方拿到对方的包装对象却按自己的形状读，静默落到空分支 */
function reviewQueryPayload<T>(schema: SafeParseable<T>, raw: unknown, fallback: string): ReviewQueryPayload<T> {
    const parsed = schema.safeParse(raw)
    if (parsed.success) return { data: parsed.data }
    const err = (raw as { error?: string } | undefined)?.error
    return { error: err ?? fallback }
}

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
            return reviewQueryPayload(ReviewOverviewSchema, res.data, 'Failed to load review overview')
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
            return reviewQueryPayload(ReviewFilesResultSchema, res.data, 'Failed to load review files')
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

/** patch 查询的缓存载荷（{data}|{error} 包装，不抛错走 retry） */
export type ReviewPatchQueryPayload = ReviewQueryPayload<ReviewPatchResult> | null

/** 共享 queryFn 工厂：hook 与 DiffViewer 同键同形（见 reviewQueryPayload 警告） */
export function makeReviewPatchQueryFn(api: MobiApi, sessionId: string, target: DiffTarget | null, path: string | null) {
    return async (): Promise<ReviewPatchQueryPayload> => {
        if (!target || !path) return null
        const res = await api.sessions.gitReviewDiff(sessionId, target, path)
        return reviewQueryPayload(ReviewPatchResultSchema, res.data, 'Failed to load diff')
    }
}

/** 单文件 patch v2（pierre PatchDiff 主输入）；path 为 null 不拉（未展开） */
export function useReviewPatch(sessionId: string, target: DiffTarget | null, path: string | null, version: number | string = ''): ReviewPatchQueryResult {
    const api = useMobiApi()
    const q = useQuery({
        queryKey: queryKeys.gitReviewPatch(sessionId, target ?? { kind: 'turn' }, path ?? '', version),
        queryFn: makeReviewPatchQueryFn(api, sessionId, target, path),
        enabled: !!sessionId && !!target && !!path,
    })
    return {
        data: q.data && 'data' in q.data ? q.data.data : undefined,
        error: (q.data && 'error' in q.data ? q.data.error : null) ?? (q.error ? String(q.error) : null),
        isLoading: !!target && !!path && q.isLoading,
    }
}

export interface ReviewContentsQueryResult {
    data: ReviewContentsResult | undefined
    error: string | null
    isLoading: boolean
}

/** contents 查询的缓存载荷 */
export type ReviewContentsQueryPayload = ReviewQueryPayload<ReviewContentsResult> | null

/** 共享 queryFn 工厂：hook 与 DiffViewer 同键同形（同 patch——原 contents 侧曾各写一份，
 *  同键异形是静默空分支的事故形态） */
export function makeReviewContentsQueryFn(api: MobiApi, sessionId: string, target: DiffTarget | null, path: string | null) {
    return async (): Promise<ReviewContentsQueryPayload> => {
        if (!target || !path) return null
        const res = await api.sessions.gitReviewContents(sessionId, target, path)
        return reviewQueryPayload(ReviewContentsResultSchema, res.data, 'Failed to load contents')
    }
}

/** 全文对 v2（pierre hydration 懒拉）：enabled 由调用方控制（首次展开上下文才触发）；
 *  version = 总览 targetGeneration（与 patch 同代——staleTime 窗口内不得读到旧代全文） */
export function useReviewContents(sessionId: string, target: DiffTarget | null, path: string | null, enabled: boolean, version: number | string = ''): ReviewContentsQueryResult {
    const api = useMobiApi()
    const q = useQuery({
        queryKey: queryKeys.gitReviewContents(sessionId, target ?? { kind: 'turn' }, path ?? '', version),
        queryFn: makeReviewContentsQueryFn(api, sessionId, target, path),
        enabled: !!sessionId && !!target && !!path && enabled,
    })
    return {
        data: q.data?.data ?? undefined,
        error: q.data?.error ?? (q.error ? String(q.error) : null),
        isLoading: !!target && !!path && enabled && q.isLoading,
    }
}

export interface ReviewInitResult {
    init: () => void
    isPending: boolean
    /** 失败文案（业务错误或网络错误）；组件侧 message.error 呈现 */
    error: string | null
    /** 成功时刻（dataUpdatedAt，0=未成功过）：组件侧成功 toast 的信号源 */
    succeededAt: number
}

/** 一键初始化 git 仓库（审查重写票06）：成功后失效总览缓存（五档即刻上线） */
export function useReviewInit(sessionId: string): ReviewInitResult {
    const api = useMobiApi()
    const queryClient = useQueryClient()
    const mutation = useMutation({
        mutationFn: async () => {
            const res = await api.sessions.gitReviewInit(sessionId)
            const parsed = ReviewActionResultSchema.safeParse(res.data)
            if (parsed.success) return parsed.data
            const err = (res.data as { error?: string } | undefined)?.error
            throw new Error(err ?? 'Failed to init git repository')
        },
        onSuccess: () => {
            void queryClient.invalidateQueries({ queryKey: queryKeys.gitReviewOverview(sessionId) })
        },
    })
    return {
        init: () => void mutation.mutate(),
        isPending: mutation.isPending,
        error: mutation.error ? String(mutation.error.message ?? mutation.error) : null,
        // 成功时刻：提交时间无法从 mutation 直读，用提交成功后总览失效前的本地时点——
        // 简化为「isSuccess 翻转时取当下」，组件按变化沿 toast 一次
        succeededAt: mutation.isSuccess ? mutation.submittedAt : 0,
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
            return reviewQueryPayload(ReviewCommitsResultSchema, res.data, 'Failed to load commits')
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
