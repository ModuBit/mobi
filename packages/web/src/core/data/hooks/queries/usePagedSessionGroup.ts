/*
 * Copyright Maner·Fan
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *         https://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { useState, useMemo, useCallback, useEffect } from 'react'
import { useSessions } from '@/core/data/hooks/queries/useSessions'
import { compareSessionsForList } from '@/core/utils/sessionStatus'
import type { Session, ProjectSessionsPage } from '@/core/data/api/types'

/** 默认展示的会话数；每次点「展开更多」递增的数量 */
const VISIBLE_PAGE_SIZE = 5

/** usePagedSessionGroup 需要的无限查询状态（由调用方的 useInfiniteQuery 结果贡献） */
export interface PagedSessionGroupQueryState {
    /** 无限查询聚合页（sessionIds 分页） */
    data: { pages: ProjectSessionsPage[] } | undefined
    isLoading: boolean
    hasNextPage: boolean
    isFetchingNextPage: boolean
    fetchNextPage: () => Promise<unknown>
}

/**
 * 分页会话分组的共享核心（useProjectSessions / useRecentSessions 复用）
 *
 * 调用方只贡献 queryKey + queryFn（以及 upsert 进 ['sessions'] 的副作用），
 * 本 hook 收口与数据来源无关的展示逻辑：
 * - 从全局 ['sessions'] 缓存按 sessionIds 组装列表（单一数据源策略）
 * - 排序：活跃优先 → updatedAt（compareSessionsForList）
 * - visibleCount 前端分页 + 触底后端分页（fetchNextPage）
 * - 展开/收起容器状态（含活跃会话时自动展开）
 * - total / remainingCount / 骨架与加载更多判定
 */
export function usePagedSessionGroup(
    query: PagedSessionGroupQueryState,
    activeSessionId?: string,
    defaultExpanded = false,
) {
    const { data: pages, isLoading, hasNextPage, isFetchingNextPage, fetchNextPage } = query
    const [visibleCount, setVisibleCount] = useState(VISIBLE_PAGE_SIZE)

    // 从全局会话缓存获取完整 Session 数据
    const { data: allSessions } = useSessions()

    // 按 sessionIds 组装列表（活跃优先 → updatedAt）
    const sessions = useMemo<Session[]>(() => {
        if (!pages?.pages || !allSessions) return []

        const sessionIdSet = new Set<string>()
        for (const page of pages.pages) {
            for (const id of page.sessionIds) {
                sessionIdSet.add(id)
            }
        }

        return allSessions
            .filter(s => sessionIdSet.has(s.id))
            .sort(compareSessionsForList)
    }, [pages?.pages, allSessions])

    // 判断列表是否包含活跃会话 → 决定默认展开
    const containsActive = useMemo(() => {
        return !!activeSessionId && sessions.some(s => s.id === activeSessionId)
    }, [activeSessionId, sessions])

    // 展开状态：用户可自由折叠/展开（defaultExpanded 供「最近」等默认展开的分组使用）
    const [expanded, setExpanded] = useState(defaultExpanded)
    // 当数据加载后发现包含活跃会话，自动展开（仅首次触发）
    const [autoExpanded, setAutoExpanded] = useState(false)
    useEffect(() => {
        if (containsActive && !autoExpanded) {
            setExpanded(true)
            setAutoExpanded(true)
        }
    }, [containsActive, autoExpanded])

    const visibleSessions = useMemo(() => sessions.slice(0, visibleCount), [sessions, visibleCount])
    const loadedCount = sessions.length

    // 会话总数（后端 COUNT，不受本地已加载量影响）。
    // 取最后一页 total —— 同一分组各页 total 一致，最后一页是最新 fetch。
    // total 未就绪（首屏骨架）时回退 loadedCount，避免 remainingCount 暂时低估。
    const total = useMemo<number | undefined>(() => {
        if (!pages?.pages || pages.pages.length === 0) return undefined
        return pages.pages[pages.pages.length - 1].total
    }, [pages?.pages])
    const realTotal = total ?? loadedCount
    const remainingCount = Math.max(realTotal - visibleCount, 0)

    const toggleExpanded = useCallback(() => {
        setExpanded(prev => !prev)
    }, [])

    // 展开更多：前端递增 visibleCount；下一档将超出本地已加载数据、且后端还有 → 触底拉取下一页。
    // 注意 fetchNextPage 在 setState updater 之外调用——StrictMode 下 updater 会双调用，
    // 副作用放 updater 里会重复触发网络请求
    const showMore = useCallback(() => {
        const next = visibleCount + VISIBLE_PAGE_SIZE
        setVisibleCount(next)
        if (next > loadedCount && hasNextPage && !isFetchingNextPage) {
            void fetchNextPage()
        }
    }, [visibleCount, loadedCount, hasNextPage, isFetchingNextPage, fetchNextPage])

    const collapse = useCallback(() => {
        setVisibleCount(VISIBLE_PAGE_SIZE)
    }, [])

    return {
        sessions,
        visibleSessions,
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
