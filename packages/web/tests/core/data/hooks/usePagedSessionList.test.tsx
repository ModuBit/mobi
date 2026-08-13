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

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, renderHook, waitFor, cleanup, act } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ConfigProvider, App as AntdApp } from 'antd'
import type { ReactNode } from 'react'

// ============ useMobiApi mock（必须返回稳定引用，否则 effect 无限循环 OOM——项目已知坑） ============

const sessionsList = vi.hoisted(() => vi.fn())
const projectsList = vi.hoisted(() => vi.fn())
const projectSessions = vi.hoisted(() => vi.fn())
const unboundSessions = vi.hoisted(() => vi.fn())
const mockApi = {
    sessions: { list: sessionsList },
    projects: {
        list: projectsList,
        sessions: projectSessions,
        unboundSessions: unboundSessions,
    },
    visibility: { report: vi.fn().mockResolvedValue(undefined) },
}
vi.mock('@/core/data/api/client', () => ({
    useMobiApi: () => mockApi,
}))

// ============ SSEProvider 依赖 mock（对照 useProjects.test.tsx 现成模式） ============

type SseHandler = (e: Record<string, unknown>) => void
const sseListener = vi.hoisted(() => ({ current: null as SseHandler | null }))
const authState = vi.hoisted(() => ({ authenticated: true as boolean }))

vi.mock('@/core/data/realtime/sseClient', () => ({
    SSEClient: vi.fn().mockImplementation(function (this: Record<string, unknown>) {
        this.subscribe = (cb: SseHandler) => {
            sseListener.current = cb
            return () => {}
        }
        this.connect = () => {}
        this.disconnect = () => {}
        this.reconnectIfStale = () => false
    }),
}))
vi.mock('@/core/data/stores/authStore', () => ({
    useAuthStore: () => ({ authenticated: authState.authenticated, logout: vi.fn() }),
}))
vi.mock('@tanstack/react-router', () => ({
    useNavigate: () => vi.fn(),
}))
vi.mock('@/core/data/hooks/useNotify', () => ({
    useNotify: () => ({ warning: vi.fn(), success: vi.fn(), info: vi.fn(), error: vi.fn(), destroy: vi.fn() }),
}))
vi.mock('@/components/NotificationPermissionGate', () => ({
    NotificationPermissionGate: () => null,
    resetPermissionPrompt: vi.fn(),
}))
vi.mock('react-i18next', () => ({
    useTranslation: () => ({ t: (k: string) => k }),
}))
vi.mock('antd', async (orig) => {
    const actual = await orig()
    return {
        ...actual,
        App: {
            ...actual.App,
            useApp: () => ({
                notification: { info: vi.fn(), destroy: vi.fn() },
                message: { error: vi.fn() },
            }),
        },
    }
})

import { useProjectSessions } from '@/core/data/hooks/queries/useProjectSessions'
import { useRecentSessions } from '@/core/data/hooks/queries/useRecentSessions'
import type { Session, Project, ProjectSessionsPage } from '@/core/data/api/types'

function makeSession(id: string, overrides: Partial<Session> = {}): Session {
    return {
        id,
        namespace: 'ns',
        seq: 1,
        createdAt: 1,
        updatedAt: 1,
        active: false,
        activeAt: 1,
        metadata: null,
        metadataVersion: 1,
        agentState: null,
        agentStateVersion: 1,
        running: false,
        runningAt: 1,
        ...overrides,
    } as Session
}

function makeProject(overrides: Partial<Project> = {}): Project {
    return {
        id: 'p1',
        namespace: 'ns',
        machineId: 'm1',
        name: 'Demo',
        folders: [{ path: '/home/u/demo', primary: true }],
        createdAt: 1,
        updatedAt: 1,
        seq: 1,
        ...overrides,
    }
}

/** 构造项目/最近分页响应 */
function makePage(sessions: Session[], opts: Partial<ProjectSessionsPage> = {}): {
    data: { sessions: Session[]; nextCursor: number | null; hasMore: boolean; total: number }
} {
    return {
        data: {
            sessions,
            nextCursor: opts.nextCursor ?? null,
            hasMore: opts.hasMore ?? false,
            total: opts.total ?? sessions.length,
        },
    }
}

function makeQueryClient() {
    // staleTime Infinity：测试预置 ['sessions'] 缓存后 useSessions 不会重新拉取，
    // 避免其 queryFn 与分组 queryFn 的 setQueryData 竞争覆盖（生产环境两侧数据同源无此问题）
    return new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } })
}

function makeHookWrapper(qc: QueryClient) {
    return ({ children }: { children: ReactNode }) => (
        <QueryClientProvider client={qc}>{children}</QueryClientProvider>
    )
}

/** 渲染 SSEProvider（对照 useProjects.test.tsx 的 renderProvider） */
async function renderProvider() {
    const { SSEProvider } = await import('@/core/providers/SSEProvider')
    const qc = makeQueryClient()
    render(
        <QueryClientProvider client={qc}>
            <ConfigProvider>
                <AntdApp>
                    <SSEProvider><div /></SSEProvider>
                </AntdApp>
            </ConfigProvider>
        </QueryClientProvider>
    )
    return { queryClient: qc }
}

// vitest 未开 globals：渲染型测试必须显式 cleanup，否则 DOM 累积致 getBy* 多元素报错——项目已知坑
afterEach(() => cleanup())

describe('usePagedSessionList 共享核心（经 useProjectSessions 验证）', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        projectsList.mockResolvedValue({ data: { projects: [makeProject()] } })
    })

    it('queryFn 将完整 Session upsert 进 ["sessions"] 缓存并按 sessionIds 组装列表', async () => {
        const s1 = makeSession('s1', { active: true, updatedAt: 10 })
        const s2 = makeSession('s2', { updatedAt: 20 })
        projectSessions.mockResolvedValue(makePage([s1, s2]))

        const qc = makeQueryClient()
        qc.setQueryData(['sessions'], [])
        const { result } = renderHook(() => useProjectSessions('p1'), { wrapper: makeHookWrapper(qc) })

        await waitFor(() => expect(result.current.sessions.map(s => s.id)).toEqual(['s1', 's2']))
        // 单一数据源：完整 Session 进全局 ['sessions'] 缓存
        const cached = qc.getQueryData<Session[]>(['sessions']) ?? []
        expect(cached.map(s => s.id).sort()).toEqual(['s1', 's2'])
    })

    it('upsert 为增量合并：更新已有条目且保留缓存中无关会话', async () => {
        const existing = makeSession('s1', { active: true })
        const unrelated = makeSession('other')
        projectSessions.mockResolvedValue(makePage([makeSession('s1', { active: true, updatedAt: 99 })]))

        const qc = makeQueryClient()
        qc.setQueryData(['sessions'], [existing, unrelated])
        const { result } = renderHook(() => useProjectSessions('p1'), { wrapper: makeHookWrapper(qc) })

        await waitFor(() => expect(result.current.sessions).toHaveLength(1))
        const cached = qc.getQueryData<Session[]>(['sessions']) ?? []
        // 同 id 增量覆盖
        expect(cached.find(s => s.id === 's1')?.updatedAt).toBe(99)
        // 无关会话不被丢弃
        expect(cached.map(s => s.id)).toContain('other')
    })

    it('排序：活跃会话优先于更新时间更新的非活跃会话', async () => {
        const activeOld = makeSession('a', { active: true, updatedAt: 1 })
        const inactiveNew = makeSession('b', { active: false, updatedAt: 100 })
        projectSessions.mockResolvedValue(makePage([inactiveNew, activeOld]))

        const qc = makeQueryClient()
        qc.setQueryData(['sessions'], [])
        const { result } = renderHook(() => useProjectSessions('p1'), { wrapper: makeHookWrapper(qc) })

        await waitFor(() => expect(result.current.sessions.map(s => s.id)).toEqual(['a', 'b']))
    })

    it('showMore 触底：下一档超出本地已加载且后端还有 → fetchNextPage 携带 nextCursor', async () => {
        // 首页 2 条（loadedCount=2 < 下一档 5+5=10）且 hasMore
        projectSessions.mockResolvedValueOnce(makePage(
            [makeSession('s1'), makeSession('s2')],
            { hasMore: true, nextCursor: 2, total: 7 },
        ))
        projectSessions.mockResolvedValueOnce(makePage(
            [makeSession('s3')],
            { hasMore: false, nextCursor: null, total: 3 },
        ))

        const qc = makeQueryClient()
        const { result } = renderHook(() => useProjectSessions('p1'), { wrapper: makeHookWrapper(qc) })

        await waitFor(() => expect(result.current.sessions).toHaveLength(2))
        expect(result.current.remainingCount).toBe(2) // total 7 - visibleCount 5
        act(() => result.current.showMore())
        // 触底拉取：第二次调用以首页 nextCursor 为游标
        await waitFor(() => expect(projectSessions).toHaveBeenCalledWith('p1', 2, 20))
        await waitFor(() => expect(result.current.sessions).toHaveLength(3))
    })

    it('remainingCount 兜底：total 未就绪时按已加载数计算', async () => {
        // 后端 total 异常（0）但 hasMore=true：hasNextPage 兜底保证 canShowMore 仍可达
        projectSessions.mockResolvedValueOnce(makePage(
            [makeSession('s1'), makeSession('s2')],
            { hasMore: true, nextCursor: 2, total: 0 },
        ))

        const qc = makeQueryClient()
        qc.setQueryData(['sessions'], [])
        const { result } = renderHook(() => useProjectSessions('p1'), { wrapper: makeHookWrapper(qc) })

        await waitFor(() => expect(result.current.sessions).toHaveLength(2))
        expect(result.current.remainingCount).toBe(0)
        expect(result.current.canShowMore).toBe(true)
    })

    it('含活跃会话时自动展开；「最近」与项目组行为一致', async () => {
        projectSessions.mockResolvedValue(makePage([
            makeSession('s1'),
            makeSession('s2', { active: true }),
        ]))

        const qc = makeQueryClient()
        qc.setQueryData(['sessions'], [])
        const { result } = renderHook(() => useProjectSessions('p1', 's2'), { wrapper: makeHookWrapper(qc) })

        await waitFor(() => expect(result.current.sessions).toHaveLength(2))
        await waitFor(() => expect(result.current.expanded).toBe(true))
    })

    it('fullProjectPath 取项目 primary folder path', async () => {
        projectSessions.mockResolvedValue(makePage([]))

        const qc = makeQueryClient()
        qc.setQueryData(['sessions'], [])
        const { result } = renderHook(() => useProjectSessions('p1'), { wrapper: makeHookWrapper(qc) })

        await waitFor(() => expect(result.current.fullProjectPath).toBe('/home/u/demo'))
        expect(result.current.total).toBe(0)
    })
})

describe('useRecentSessions（共享核心经「最近」视图验证）', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        projectsList.mockResolvedValue({ data: { projects: [] } })
    })

    it('拉取未归入项目的会话并 upsert 进 ["sessions"]', async () => {
        const s1 = makeSession('r1', { updatedAt: 30 })
        unboundSessions.mockResolvedValue(makePage([s1]))

        const qc = makeQueryClient()
        qc.setQueryData(['sessions'], [])
        const { result } = renderHook(() => useRecentSessions(), { wrapper: makeHookWrapper(qc) })

        await waitFor(() => expect(result.current.sessions.map(s => s.id)).toEqual(['r1']))
        expect(qc.getQueryData<Session[]>(['sessions'])?.map(s => s.id)).toEqual(['r1'])
    })

    it('visibleSessions 前端分页 + collapse 重置', async () => {
        const sessions = Array.from({ length: 7 }, (_, i) => makeSession(`r${i}`, { updatedAt: i }))
        unboundSessions.mockResolvedValue(makePage(sessions))

        const qc = makeQueryClient()
        qc.setQueryData(['sessions'], [])
        const { result } = renderHook(() => useRecentSessions(), { wrapper: makeHookWrapper(qc) })

        await waitFor(() => expect(result.current.sessions).toHaveLength(7))
        expect(result.current.visibleSessions).toHaveLength(5)
        expect(result.current.remainingCount).toBe(2)
        expect(result.current.showCollapse).toBe(false)

        act(() => result.current.showMore())
        expect(result.current.visibleSessions).toHaveLength(7)
        expect(result.current.showCollapse).toBe(true)

        act(() => result.current.collapse())
        expect(result.current.visibleSessions).toHaveLength(5)
        expect(result.current.showCollapse).toBe(false)
    })
})

describe('P1：session-* SSE 事件失效项目视图', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        sseListener.current = null
        authState.authenticated = true
    })

    async function assertProjectViewsInvalidated(event: Record<string, unknown>) {
        const { queryClient: qc } = await renderProvider()
        expect(sseListener.current).toBeTruthy()
        const invalidateSpy = vi.spyOn(qc, 'invalidateQueries')

        sseListener.current!(event)

        // 批处理窗口 16ms 后统一失效
        await waitFor(() => {
            expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['projects'] })
        })
        const keys = invalidateSpy.mock.calls.map(c => (c[0] as { queryKey?: unknown }).queryKey)
        expect(keys.some(k => Array.isArray(k) && k[0] === 'recentSessions')).toBe(true)
        expect(keys.some(k => Array.isArray(k) && k[0] === 'projectSessions')).toBe(true)
        invalidateSpy.mockRestore()
    }

    it('session-added → projectViews 批量失效', async () => {
        await assertProjectViewsInvalidated({ type: 'session-added', sessionId: 's1' })
    })

    it('session-removed → projectViews 批量失效', async () => {
        await assertProjectViewsInvalidated({ type: 'session-removed', sessionId: 's1' })
    })

    it('session-updated 完整 session 载荷（归属变更）→ projectViews 批量失效', async () => {
        await assertProjectViewsInvalidated({ type: 'session-updated', sessionId: 's1', data: { id: 's1', projectId: 'p1' } })
    })

    it('session-updated 无 data 载荷（删除项目解绑）→ projectViews 批量失效', async () => {
        await assertProjectViewsInvalidated({ type: 'session-updated', sessionId: 's1' })
    })

    it('session-updated 轻载荷（心跳/指标/重命名）→ 不失效项目视图（V2：防 refetch 风暴）', async () => {
        const { queryClient: qc } = await renderProvider()
        expect(sseListener.current).toBeTruthy()
        const invalidateSpy = vi.spyOn(qc, 'invalidateQueries')

        // 活跃会话流式期间的典型载荷：心跳 / contextUsage / metadata 重命名
        sseListener.current!({ type: 'session-updated', sessionId: 's1', data: { active: true, running: true } })
        sseListener.current!({ type: 'session-updated', sessionId: 's1', data: { sid: 's1', runtimeState: { contextUsage: {} } } })
        sseListener.current!({ type: 'session-updated', sessionId: 's1', data: { sid: 's1', metadata: { name: '改名' } } })

        // 等过批处理窗口（16ms + 余量）
        await new Promise(r => setTimeout(r, 120))
        const keys = invalidateSpy.mock.calls.map(c => (c[0] as { queryKey?: unknown }).queryKey)
        expect(keys.some(k => Array.isArray(k) && k[0] === 'projects')).toBe(false)
        expect(keys.some(k => Array.isArray(k) && k[0] === 'projectSessions')).toBe(false)
        invalidateSpy.mockRestore()
    })

    it('project-removed → 折叠进 projectViews 批处理', async () => {
        await assertProjectViewsInvalidated({ type: 'project-removed', projectId: 'p1', namespace: 'ns' })
    })
})
