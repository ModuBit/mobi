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
 * useProjectGroupSessions 单元测试
 * 覆盖：首次加载骨架判定、visibleCount 分页、收起、触底 fetchNextPage、自动展开活跃会话
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import type { Session } from '@/core/data/api/types'

// 隔离 TanStack Query：mock 两个子 query hook
vi.mock('@/core/data/hooks/queries/useGroupSessions', () => ({
    useGroupSessions: vi.fn(),
}))
vi.mock('@/core/data/hooks/queries/useSessions', () => ({
    useSessions: vi.fn(),
}))

import { useProjectGroupSessions } from '@/core/data/hooks/useProjectGroupSessions'
import { useGroupSessions } from '@/core/data/hooks/queries/useGroupSessions'
import { useSessions } from '@/core/data/hooks/queries/useSessions'

const mockUseGroupSessions = useGroupSessions as unknown as ReturnType<typeof vi.fn>
const mockUseSessions = useSessions as unknown as ReturnType<typeof vi.fn>

/** 构造最小 Session（compareSessionsForList 仅用 active + updatedAt） */
function makeSession(id: string, updatedAt = 0, active = false): Session {
    return {
        id, updatedAt, active,
        metadata: { path: `/proj/${id}` },
    } as unknown as Session
}

interface MockQueryOpts {
    sessionIds?: string[]
    sessions?: Session[]
    isLoading?: boolean
    hasNextPage?: boolean
    isFetchingNextPage?: boolean
}

function mockQuery(opts: MockQueryOpts = {}) {
    const fetchNextPage = vi.fn()
    mockUseGroupSessions.mockReturnValue({
        data: {
            pages: [{
                sessionIds: opts.sessionIds ?? [],
                groupKey: 'g1',
                nextCursor: null,
                hasMore: !!opts.hasNextPage,
            }],
        },
        isLoading: opts.isLoading ?? false,
        hasNextPage: opts.hasNextPage ?? false,
        isFetchingNextPage: opts.isFetchingNextPage ?? false,
        fetchNextPage,
    })
    mockUseSessions.mockReturnValue({ data: opts.sessions ?? [] })
    return { fetchNextPage }
}

beforeEach(() => {
    vi.clearAllMocks()
})

describe('useProjectGroupSessions', () => {
    it('首次加载（数据未就绪）时：sessions 空、isLoadingInitial=true', () => {
        mockQuery({ isLoading: true })
        const { result } = renderHook(() => useProjectGroupSessions('g1'))

        expect(result.current.sessions).toEqual([])
        expect(result.current.visibleSessions).toEqual([])
        expect(result.current.isLoadingInitial).toBe(true)
        expect(result.current.canShowMore).toBe(false)
        expect(result.current.showCollapse).toBe(false)
    })

    it('数据就绪且超过初始 5 条：visibleSessions 截断为 5、remainingCount 正确、canShowMore=true、showCollapse=false', () => {
        const sessions = Array.from({ length: 7 }, (_, i) => makeSession(`s${i}`, i))
        mockQuery({ sessionIds: sessions.map(s => s.id), sessions })

        const { result } = renderHook(() => useProjectGroupSessions('g1'))

        expect(result.current.visibleSessions).toHaveLength(5)
        expect(result.current.remainingCount).toBe(2)
        expect(result.current.canShowMore).toBe(true)
        // 初始档未超过 5，不显示收起
        expect(result.current.showCollapse).toBe(false)
    })

    it('showMore() 展开更多后：visibleSessions 增长、showCollapse 变 true', () => {
        const sessions = Array.from({ length: 7 }, (_, i) => makeSession(`s${i}`, i))
        mockQuery({ sessionIds: sessions.map(s => s.id), sessions })

        const { result } = renderHook(() => useProjectGroupSessions('g1'))
        act(() => result.current.showMore())

        expect(result.current.visibleSessions).toHaveLength(7)
        expect(result.current.remainingCount).toBe(0)
        expect(result.current.canShowMore).toBe(false)
        // 已展开超过初始档 → 可收起
        expect(result.current.showCollapse).toBe(true)
    })

    it('collapse() 将 visibleCount 重置回初始档、showCollapse 变 false', () => {
        const sessions = Array.from({ length: 7 }, (_, i) => makeSession(`s${i}`, i))
        mockQuery({ sessionIds: sessions.map(s => s.id), sessions })

        const { result } = renderHook(() => useProjectGroupSessions('g1'))
        act(() => result.current.showMore())
        expect(result.current.showCollapse).toBe(true)

        act(() => result.current.collapse())
        expect(result.current.visibleSessions).toHaveLength(5)
        expect(result.current.showCollapse).toBe(false)
        expect(result.current.canShowMore).toBe(true)
    })

    it('触底分页：下一档超出本地已加载数 且 hasNextPage → 调 fetchNextPage', () => {
        // 本地仅 5 条（模拟 useGroupSessions 单页 20，此处用 5 简化），后端还有
        const sessions = Array.from({ length: 5 }, (_, i) => makeSession(`s${i}`, i))
        const { fetchNextPage } = mockQuery({
            sessionIds: sessions.map(s => s.id),
            sessions,
            hasNextPage: true,
        })

        const { result } = renderHook(() => useProjectGroupSessions('g1'))
        // 下一档 visibleCount=10 > loadedCount=5，且 hasNextPage → 触底
        act(() => result.current.showMore())
        expect(fetchNextPage).toHaveBeenCalledTimes(1)
    })

    it('不触底：下一档未超出本地已加载数 → 不调 fetchNextPage', () => {
        const sessions = Array.from({ length: 12 }, (_, i) => makeSession(`s${i}`, i))
        const { fetchNextPage } = mockQuery({
            sessionIds: sessions.map(s => s.id),
            sessions,
            hasNextPage: true,
        })

        const { result } = renderHook(() => useProjectGroupSessions('g1'))
        // 下一档 visibleCount=10 <= loadedCount=12 → 不触底
        act(() => result.current.showMore())
        expect(fetchNextPage).not.toHaveBeenCalled()
    })

    it('本地耗尽但后端无更多 → 不调 fetchNextPage，canShowMore 最终为 false', () => {
        const sessions = Array.from({ length: 7 }, (_, i) => makeSession(`s${i}`, i))
        const { fetchNextPage } = mockQuery({
            sessionIds: sessions.map(s => s.id),
            sessions,
            hasNextPage: false,
        })

        const { result } = renderHook(() => useProjectGroupSessions('g1'))
        act(() => result.current.showMore())
        expect(fetchNextPage).not.toHaveBeenCalled()
        // 全部展示完，本地与后端都耗尽
        expect(result.current.canShowMore).toBe(false)
    })

    it('isFetchingNextPage 期间：isLoadingMore=true', () => {
        const sessions = Array.from({ length: 5 }, (_, i) => makeSession(`s${i}`, i))
        mockQuery({
            sessionIds: sessions.map(s => s.id),
            sessions,
            hasNextPage: true,
            isFetchingNextPage: true,
        })

        const { result } = renderHook(() => useProjectGroupSessions('g1'))
        expect(result.current.isLoadingMore).toBe(true)
    })

    it('包含活跃会话时：自动展开（expanded=true）', () => {
        const sessions = [
            makeSession('s1', 1, false),
            makeSession('s2', 2, true),
        ]
        mockQuery({ sessionIds: ['s1', 's2'], sessions })

        const { result } = renderHook(() => useProjectGroupSessions('g1', 's2'))
        // useEffect 在 render 后触发，需等待 act 收敛
        expect(result.current.expanded).toBe(true)
    })

    it('不包含活跃会话时：默认不展开', () => {
        const sessions = [makeSession('s1', 1, false)]
        mockQuery({ sessionIds: ['s1'], sessions })

        const { result } = renderHook(() => useProjectGroupSessions('g1', 'sX'))
        expect(result.current.expanded).toBe(false)
    })

    it('toggleExpanded 切换展开态', () => {
        const sessions = [makeSession('s1', 1, false)]
        mockQuery({ sessionIds: ['s1'], sessions })

        const { result } = renderHook(() => useProjectGroupSessions('g1'))
        expect(result.current.expanded).toBe(false)
        act(() => result.current.toggleExpanded())
        expect(result.current.expanded).toBe(true)
        act(() => result.current.toggleExpanded())
        expect(result.current.expanded).toBe(false)
    })

    it('fullProjectPath 从 session.metadata.path 提取，无 session 时回退 groupKey', () => {
        // 无 session
        mockQuery({ sessionIds: [], sessions: [] })
        const { result, rerender } = renderHook(() => useProjectGroupSessions('g1'))
        expect(result.current.fullProjectPath).toBe('g1')

        // 有 session
        const sessions = [makeSession('s1', 1)]
        mockQuery({ sessionIds: ['s1'], sessions })
        rerender()
        expect(result.current.fullProjectPath).toBe('/proj/s1')
    })
})
