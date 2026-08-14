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

import { useState, useMemo, useCallback, useEffect, useRef } from 'react'
import { useSessions } from '@/core/data/hooks/queries/useSessions'
import { compareSessionsForList } from '@/core/utils/sessionStatus'
import type { Session, ProjectSessionsPage } from '@/core/data/api/types'

/** 默认展示的会话数；每次点「展开更多」递增的数量 */
const VISIBLE_PAGE_SIZE = 5

/** usePagedSessionList 需要的无限查询状态（由调用方的 useInfiniteQuery 结果贡献） */
export interface PagedSessionListQueryState {
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
export function usePagedSessionList(
    query: PagedSessionListQueryState,
    activeSessionId?: string,
    /** 分区级折叠语义：有内容默认展开、空分区默认收起（「最近」等平级分区） */
    expandWithContent = false,
) {
    const { data: pages, isLoading, hasNextPage, isFetchingNextPage, fetchNextPage } = query
    const [visibleCount, setVisibleCount] = useState(VISIBLE_PAGE_SIZE)

    // 从全局会话缓存获取完整 Session 数据
    const { data: allSessions } = useSessions()

    // SSE tick 级重算防御：['sessions'] 数组容器在 patchSessionCache/mergeSessions 中常被换代，
    // 但未涉及的 session 元素引用保持稳定（patchSessionCache 值不变时直接返回旧数组，变更时
    // 也只替换目标元素）。利用这一点做两层短路：
    // 1. 输入短路——容器换代但元素逐引用全等时，直接复用上次结果，跳过 Set 构建+过滤+排序；
    // 2. 输出稳定——本分组成员未被波及（过滤+排序结果与上次逐引用全等）时，保持结果引用
    //    不变，切断下游 visibleSessions/行组件在他人会话高频心跳期间的连锁重渲染。
    const sessionsCacheRef = useRef<{ all: Session[] | undefined; result: Session[] }>({
        all: undefined,
        result: [],
    })

    // 按 sessionIds 组装列表（活跃优先 → updatedAt）
    const sessions = useMemo<Session[]>(() => {
        if (!pages?.pages || !allSessions) return []

        const prev = sessionsCacheRef.current
        if (
            prev.all !== undefined &&
            prev.all.length === allSessions.length &&
            prev.all.every((s, i) => s === allSessions[i])
        ) {
            return prev.result
        }

        const sessionIdSet = new Set<string>()
        for (const page of pages.pages) {
            for (const id of page.sessionIds) {
                sessionIdSet.add(id)
            }
        }

        const next = allSessions
            .filter(s => sessionIdSet.has(s.id))
            .sort(compareSessionsForList)
        const unchanged =
            prev.result.length === next.length && prev.result.every((s, i) => s === next[i])
        const result = unchanged ? prev.result : next
        sessionsCacheRef.current = { all: allSessions, result }
        return result
    }, [pages?.pages, allSessions])

    // 判断列表是否包含活跃会话 → 决定默认展开
    const containsActive = useMemo(() => {
        return !!activeSessionId && sessions.some(s => s.id === activeSessionId)
    }, [activeSessionId, sessions])

    // 展开状态三态优先级：用户显式 toggle > 包含活跃会话的自动展开 > 依据内容的默认值。
    // - expandWithContent 分区（「最近」）：有会话默认展开、空分区默认收起——数据异步到达
    //   后自动展开，无需等用户操作；普通分组（项目组）静态默认收起
    // - 用户 toggle 后以用户选择为准，不再随后续数据翻动翻转（收起的分区来新会话不会强行弹开）
    const [override, setOverride] = useState<boolean | null>(null)
    const baseExpanded = expandWithContent ? sessions.length > 0 : false
    const expanded = override ?? baseExpanded
    // 当数据加载后发现包含活跃会话，自动展开（仅首次触发）
    const [autoExpanded, setAutoExpanded] = useState(false)
    useEffect(() => {
        if (containsActive && !autoExpanded) {
            setOverride(true)
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
        setOverride(!(override ?? baseExpanded))
    }, [override, baseExpanded])

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
        /** 后端真实总数（首屏未就绪时为 undefined，调用方按需回退） */
        total,
        showMore,
        collapse,
    }
}
