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

import { useMemo } from 'react'
import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query'
import { useMobiApi } from '@/core/data/api/client'
import { useProjects } from '@/core/data/hooks/queries/useProjects'
import { usePagedSessionGroup } from '@/core/data/hooks/queries/usePagedSessionGroup'
import { queryKeys } from '@/core/lib/query-keys'
import { mergeSessions } from '@/core/data/cache/sessionCache'
import type { Session, ProjectSessionsPage } from '@/core/data/api/types'

const PAGE_SIZE = 20

/**
 * 项目内会话列表的统一逻辑层（由 useProjectGroupSessions 改造：groupKey → projectId）
 *
 * 收口 PC（SidebarProjects）与移动端（MobileProjectList）共用：
 * - 项目内会话分页查询：拿到完整 Session 后 upsert 进全局 ['sessions'] 缓存，
 *   本查询只返回 sessionIds（单一数据源策略）
 * - 分页/展开/剩余数等展示逻辑由 usePagedSessionGroup 共享核心承担
 * - 完整项目路径提取（从 useProjects 缓存取该项目 primary folder path，供「新建会话」cwd）
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
    /** 是否还能「展开更多」—— 后端真实总数还有剩余（hasNextPage 作防御兜底） */
    canShowMore: boolean
    /** 后端真实总数与已展示数的差额（用于"还剩 N"文案；基于 total 而非本地已加载量） */
    remainingCount: number
    /** 展开更多：前端递增 visibleCount；若下一档将超出本地已加载数据且后端还有，则触底拉取下一页 */
    showMore: () => void
    /** 收起：visibleCount 重置回初始档 */
    collapse: () => void
    /** 后端真实总数（删除项目确认文案需要；首屏未就绪时为 undefined） */
    total: number | undefined
}

export function useProjectSessions(
    projectId: string | null,
    activeSessionId?: string,
): UseProjectSessionsResult {
    const api = useMobiApi()
    const queryClient = useQueryClient()

    // 获取该项目下的会话 ID 列表（始终请求，避免折叠时无数据判断激活态）
    const query = useInfiniteQuery<ProjectSessionsPage>({
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

    // 分页/展开/剩余数等展示逻辑：共享核心
    const paged = usePagedSessionGroup(query, activeSessionId)

    // 项目列表（取 primary folder path；与侧边栏共享同一份缓存）
    const { data: projects } = useProjects()

    // 完整项目路径：项目实体 primary folder（即 CC 的 cwd），替代旧版从 session.metadata.path 猜测
    const fullProjectPath = useMemo(() => {
        if (!projectId) return ''
        return projects?.find(p => p.id === projectId)?.folders.find(f => f.primary)?.path ?? ''
    }, [projects, projectId])

    // 后端真实总数（删除项目二次确认文案「名下 N 个会话将移至最近」）
    const pages = query.data?.pages
    const total = pages && pages.length > 0 ? pages[pages.length - 1].total : undefined

    return {
        ...paged,
        fullProjectPath,
        total,
    }
}
