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
import { useGroupSessions } from '@/core/data/hooks/queries/useGroupSessions'
import { useSessions } from '@/core/data/hooks/queries/useSessions'
import { compareSessionsForList } from '@/core/utils/sessionStatus'
import type { Session } from '@/core/data/api/types'

/** 默认展示的会话数；每次点「展开更多」递增的数量 */
const VISIBLE_PAGE_SIZE = 5

/**
 * 项目分组会话列表的统一逻辑层
 *
 * 收口 PC（SidebarProjects）与移动端（MobileProjectList）共用：
 * - 从全局缓存组装该分组的 Session 列表（排序）
 * - visibleCount 前端分页 + 触底后端分页（fetchNextPage）
 * - 首次加载骨架判定、加载更多 loading 判定
 * - 展开/收起容器状态（含含活跃会话时自动展开）
 * - 完整项目路径提取（供「新建会话」cwd）
 *
 * 列表底部链接的显隐由 showCollapse / canShowMore / remainingCount / isLoadingMore 表达，
 * 文案与样式留组件层组合。
 */
export interface UseProjectGroupSessionsResult {
    /** 该分组排序后的完整会话列表（仅含已加载部分） */
    sessions: Session[]
    /** 当前可见（前端 slice 后）的会话列表 */
    visibleSessions: Session[]
    /** 完整项目路径（从 session.metadata.path 提取，无则回退 groupKey） */
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

export function useProjectGroupSessions(
    groupKey: string,
    activeSessionId?: string,
): UseProjectGroupSessionsResult {
    const [visibleCount, setVisibleCount] = useState(VISIBLE_PAGE_SIZE)

    // 获取该分组下的会话 ID 列表（始终请求，避免折叠时无数据判断激活态）
    const {
        data: groupSessionsPages,
        isLoading,
        hasNextPage,
        isFetchingNextPage,
        fetchNextPage,
    } = useGroupSessions(groupKey)
    // 从全局会话缓存获取完整 Session 数据
    const { data: allSessions } = useSessions()

    // 从全局缓存中查找当前分组的会话
    const sessions = useMemo<Session[]>(() => {
        if (!groupSessionsPages?.pages || !allSessions) return []

        const sessionIdSet = new Set<string>()
        for (const page of groupSessionsPages.pages) {
            for (const id of page.sessionIds) {
                sessionIdSet.add(id)
            }
        }

        return allSessions
            .filter(s => sessionIdSet.has(s.id))
            .sort(compareSessionsForList)
    }, [groupSessionsPages?.pages, allSessions])

    // 判断当前分组是否包含活跃会话 → 决定默认展开
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

    const fullProjectPath = useMemo(() => {
        for (const s of sessions) {
            const path = (s.metadata as { path?: string } | undefined)?.path
            if (path) return path
        }
        // 无 session 时 fallback 到 groupKey（截断路径，不保证正确）
        return groupKey
    }, [sessions, groupKey])

    const visibleSessions = useMemo(() => sessions.slice(0, visibleCount), [sessions, visibleCount])
    const loadedCount = sessions.length

    // 分组会话总数（后端 COUNT，不受本地已加载量影响）。
    // 取最后一页 total —— 同一分组各页 total 一致，最后一页是最新 fetch。
    // total 未就绪（首屏骨架）时回退 loadedCount，避免 remainingCount 暂时低估。
    const total = useMemo<number | undefined>(() => {
        const pages = groupSessionsPages?.pages
        if (!pages || pages.length === 0) return undefined
        return pages[pages.length - 1].total
    }, [groupSessionsPages?.pages])
    const realTotal = total ?? loadedCount
    const remainingCount = Math.max(realTotal - visibleCount, 0)

    const toggleExpanded = useCallback(() => {
        setExpanded(prev => !prev)
    }, [])

    const showMore = useCallback(() => {
        setVisibleCount(prev => {
            const next = prev + VISIBLE_PAGE_SIZE
            // 下一档将超出本地已加载数据、且后端还有 → 触底拉取下一页
            // （顺带修复分组会话 >20 条时原代码展不动的 gap：useGroupSessions 单页 20 条）
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
