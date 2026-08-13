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

import { useState, useMemo, useCallback, useEffect } from 'react'
import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query'
import { useMobiApi } from '@/core/data/api/client'
import { useSessions } from '@/core/data/hooks/queries/useSessions'
import { useProjects } from '@/core/data/hooks/queries/useProjects'
import { compareSessionsForList } from '@/core/utils/sessionStatus'
import { queryKeys } from '@/core/lib/query-keys'
import { mergeSessions } from '@/core/data/cache/sessionCache'
import type { Session, ProjectSessionsPage } from '@/core/data/api/types'

const PAGE_SIZE = 20

/** 默认展示的会话数；每次点「展开更多」递增的数量 */
const VISIBLE_PAGE_SIZE = 5

/**
 * 项目内会话列表的统一逻辑层（由 useProjectGroupSessions 改造：groupKey → projectId）
 *
 * 收口 PC（SidebarProjects）与移动端（MobileProjectList）共用：
 * - 项目内会话分页查询：拿到完整 Session 后 upsert 进全局 ['sessions'] 缓存，
 *   本查询只返回 sessionIds（单一数据源策略，与 useGroupSessions 一致）
 * - 从全局缓存组装该项目的 Session 列表（排序：活跃优先 → updatedAt，沿用 compareSessionsForList）
 * - visibleCount 前端分页 + 触底后端分页（fetchNextPage）
 * - 首次加载骨架判定、加载更多 loading 判定
 * - 展开/收起容器状态（含含活跃会话时自动展开）
 * - 完整项目路径提取（从 useProjects 缓存取该项目 primary folder path，供「新建会话」cwd）
 *
 * 列表底部链接的显隐由 showCollapse / canShowMore / remainingCount / isLoadingMore 表达，
 * 文案与样式留组件层组合。
 */
export interface UseProjectSessionsResult {
    /** 该项目排序后的完整会话列表（仅含已加载部分） */
    sessions: Session[]
    /** 当前可见（前端 slice 后）的会话列表 */
    visibleSessions: Session[]
    /** 完整项目路径（项目 primary folder path，无则回退空串） */
    fullProjectPath: string
    /** 用户展开态 */
    expanded: boolean
    toggleExpanded: () => void
    /** 首次加载未就绪（用于骨架占位）—— isLoading 语义：无缓存数据且在请求中 */
    isLoadingInitial: boolean
    /** 正在拉取下一页（触底分页） */
    isLoadingMore: boolean
    /** 是否展示「收起」入口 —— 当前可见数已超过初始档 */
    showCollapse: boolean
    /** 是否还能「展开更多」—— 后端真实总数还有剩余（hasNextPage 作防御兜底：极端情况下 total 失准时仍可触底拉取） */
    canShowMore: boolean
    /** 后端真实总数与已展示数的差额（用于"还剩 N"文案；基于 total 而非本地已加载量） */
    remainingCount: number
    /** 展开更多：前端递增 visibleCount；若下一档将超出本地已加载数据且后端还有，则触底拉取下一页 */
    showMore: () => void
    /** 收起：visibleCount 重置回初始档 */
    collapse: () => void
}

export function useProjectSessions(
    projectId: string | null,
    activeSessionId?: string,
): UseProjectSessionsResult {
    const api = useMobiApi()
    const queryClient = useQueryClient()
    const [visibleCount, setVisibleCount] = useState(VISIBLE_PAGE_SIZE)

    // 获取该项目下的会话 ID 列表（始终请求，避免折叠时无数据判断激活态）
    const {
        data: projectSessionsPages,
        isLoading,
        hasNextPage,
        isFetchingNextPage,
        fetchNextPage,
    } = useInfiniteQuery<ProjectSessionsPage>({
        queryKey: queryKeys.projectSessions(projectId!),
        queryFn: async ({ pageParam }) => {
            const cursor = pageParam as number | undefined
            const res = await api.projects.sessions(projectId!, cursor, PAGE_SIZE)

            // 将完整 Session 数据 upsert 到全局 sessions 缓存（单一数据源）
            queryClient.setQueryData<Session[]>(queryKeys.sessions, (old) =>
                mergeSessions(old, res.data.sessions)
            )

            return {
                sessionIds: res.data.sessions.map(s => s.id),
                nextCursor: res.data.nextCursor,
                hasMore: res.data.hasMore,
                total: res.data.total,
            }
        },
        initialPageParam: undefined,
        getNextPageParam: (lastPage) => {
            if (!lastPage.hasMore || lastPage.nextCursor === null) {
                return undefined
            }
            return lastPage.nextCursor
        },
        enabled: !!projectId,
    })
    // 从全局会话缓存获取完整 Session 数据
    const { data: allSessions } = useSessions()
    // 项目列表（取 primary folder path；与侧边栏共享同一份缓存）
    const { data: projects } = useProjects()

    // 从全局缓存中查找该项目的会话
    const sessions = useMemo<Session[]>(() => {
        if (!projectSessionsPages?.pages || !allSessions) return []

        const sessionIdSet = new Set<string>()
        for (const page of projectSessionsPages.pages) {
            for (const id of page.sessionIds) {
                sessionIdSet.add(id)
            }
        }

        return allSessions
            .filter(s => sessionIdSet.has(s.id))
            .sort(compareSessionsForList)
    }, [projectSessionsPages?.pages, allSessions])

    // 判断该项目是否包含活跃会话 → 决定默认展开
    const containsActive = useMemo(() => {
        return !!activeSessionId && sessions.some(s => s.id === activeSessionId)
    }, [activeSessionId, sessions])

    // 展开状态：用户可自由折叠/展开
    const [expanded, setExpanded] = useState(false)
    // 当数据加载后发现包含活跃会话，自动展开（仅首次触发）
    const [autoExpanded, setAutoExpanded] = useState(false)
    useEffect(() => {
        if (containsActive && !autoExpanded) {
            setExpanded(true)
            setAutoExpanded(true)
        }
    }, [containsActive, autoExpanded])

    // 完整项目路径：项目实体 primary folder（即 CC 的 cwd），替代旧版从 session.metadata.path 猜测
    const fullProjectPath = useMemo(() => {
        if (!projectId) return ''
        return projects?.find(p => p.id === projectId)?.folders.find(f => f.primary)?.path ?? ''
    }, [projects, projectId])

    const visibleSessions = useMemo(() => sessions.slice(0, visibleCount), [sessions, visibleCount])
    const loadedCount = sessions.length

    // 项目会话总数（后端 COUNT，不受本地已加载量影响）。
    // 取最后一页 total —— 同一项目各页 total 一致，最后一页是最新 fetch。
    // total 未就绪（首屏骨架）时回退 loadedCount，避免 remainingCount 暂时低估。
    const total = useMemo<number | undefined>(() => {
        const pages = projectSessionsPages?.pages
        if (!pages || pages.length === 0) return undefined
        return pages[pages.length - 1].total
    }, [projectSessionsPages?.pages])
    const realTotal = total ?? loadedCount
    const remainingCount = Math.max(realTotal - visibleCount, 0)

    const toggleExpanded = useCallback(() => {
        setExpanded(prev => !prev)
    }, [])

    const showMore = useCallback(() => {
        setVisibleCount(prev => {
            const next = prev + VISIBLE_PAGE_SIZE
            // 下一档将超出本地已加载数据、且后端还有 → 触底拉取下一页
            if (next > loadedCount && hasNextPage && !isFetchingNextPage) {
                void fetchNextPage()
            }
            return next
        })
    }, [loadedCount, hasNextPage, isFetchingNextPage, fetchNextPage])

    const collapse = useCallback(() => {
        setVisibleCount(VISIBLE_PAGE_SIZE)
    }, [])

    return {
        sessions,
        visibleSessions,
        fullProjectPath,
        expanded,
        toggleExpanded,
        isLoadingInitial: isLoading,
        isLoadingMore: isFetchingNextPage,
        showCollapse: visibleCount > VISIBLE_PAGE_SIZE,
        // remainingCount > 0 覆盖正常路径；hasNextPage 兜底防 total 在极端并发下失准
        // 时按钮过早消失、剩余页不可达（最坏情况只是多点一次拉到空页）
        canShowMore: remainingCount > 0 || !!hasNextPage,
        remainingCount,
        showMore,
        collapse,
    }
}
