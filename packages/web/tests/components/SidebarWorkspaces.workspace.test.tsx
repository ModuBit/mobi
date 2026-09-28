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

import { describe, it, expect, vi, beforeEach, afterEach, beforeAll } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup, within } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ConfigProvider, App as AntdApp } from 'antd'
import type { ReactNode } from 'react'

// jsdom 没有 ResizeObserver（antd Modal/Select 等组件依赖）
beforeAll(() => {
    vi.stubGlobal('ResizeObserver', class {
        observe() {}
        unobserve() {}
        disconnect() {}
    })
})

// ============ useMobiApi mock（必须返回稳定引用，否则 effect 无限循环 OOM——工作区已知坑） ============

const sessionsList = vi.hoisted(() => vi.fn())
const sessionsArchive = vi.hoisted(() => vi.fn())
const sessionsResume = vi.hoisted(() => vi.fn())
const sessionsDelete = vi.hoisted(() => vi.fn())
const workspacesList = vi.hoisted(() => vi.fn())
const workspacesRemove = vi.hoisted(() => vi.fn())
const workspaceSessions = vi.hoisted(() => vi.fn())
const unboundSessions = vi.hoisted(() => vi.fn())
const assignSession = vi.hoisted(() => vi.fn())
const pinnedSessions = vi.hoisted(() => vi.fn())
const mockApi = {
    sessions: {
        list: sessionsList,
        archive: sessionsArchive,
        resume: sessionsResume,
        delete: sessionsDelete,
        pinnedSessions: pinnedSessions,
    },
    workspaces: {
        list: workspacesList,
        remove: workspacesRemove,
        sessions: workspaceSessions,
        unboundSessions: unboundSessions,
        assignSession: assignSession,
    },
    visibility: { report: vi.fn().mockResolvedValue(undefined) },
}
vi.mock('@/core/data/api/client', () => ({
    useMobiApi: () => mockApi,
}))

// 锁定桌面分支：jsdom matchMedia mock 恒 matches:false → useIsMobile 恒 true，
// 会把 AssignWorkspaceModal 推进 mobile 分支（MobileDrawer），此处显式断言 PC 形态
vi.mock('@/core/data/hooks/useMediaQuery', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@/core/data/hooks/useMediaQuery')>()
    return { ...actual, useIsMobile: () => false }
})

const navigateSpy = vi.hoisted(() => vi.fn())
vi.mock('@tanstack/react-router', () => ({
    useNavigate: () => navigateSpy,
    useParams: () => ({}),
    useSearch: () => ({}),
}))

vi.mock('react-i18next', async (orig) => {
    const actual = await orig()
    return {
        ...actual,
        useTranslation: () => ({ t: (k: string) => k }),
    }
})

import { SidebarWorkspaces } from '@/components/layout/SidebarWorkspaces'
import type { Session, Workspace } from '@/core/data/api/types'

function makeSession(id: string, name: string, overrides: Partial<Session> = {}): Session {
    return {
        id,
        namespace: 'ns',
        seq: 1,
        createdAt: 1,
        updatedAt: 1,
        active: false,
        activeAt: 1,
        metadata: { path: '/home/u/x', host: 'h', name },
        metadataVersion: 1,
        agentState: null,
        agentStateVersion: 1,
        running: false,
        runningAt: 1,
        ...overrides,
    } as Session
}

function makeWorkspace(overrides: Partial<Workspace> = {}): Workspace {
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

/** 构造分页响应 */
function pageOf(sessions: Session[], total = sessions.length) {
    return { data: { sessions, nextCursor: null, hasMore: false, total } }
}

const P1 = makeWorkspace()
const P2 = makeWorkspace({ id: 'p2', machineId: 'm2', name: 'OtherMachine' })

function setup(opts: { workspaces?: Workspace[]; workspaceSessionsMap?: Record<string, Session[]>; recent?: Session[]; pinned?: Session[] } = {}) {
    const workspaces = opts.workspaces ?? [P1, P2]
    const map = opts.workspaceSessionsMap ?? {}
    workspacesList.mockImplementation(async (machineId?: string) => ({
        data: { workspaces: machineId ? workspaces.filter(p => p.machineId === machineId) : workspaces },
    }))
    workspaceSessions.mockImplementation(async (workspaceId: string) => pageOf(map[workspaceId] ?? []))
    unboundSessions.mockResolvedValue(pageOf(opts.recent ?? []))
    pinnedSessions.mockResolvedValue(pageOf(opts.pinned ?? []))

    // staleTime Infinity + 预置 ['sessions']：避免 useSessions 拉取与分组 upsert 竞争覆盖
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } })
    qc.setQueryData(['sessions'], [])
    render(
        <QueryClientProvider client={qc}>
            <ConfigProvider>
                <AntdApp>
                    <SidebarWorkspaces />
                </AntdApp>
            </ConfigProvider>
        </QueryClientProvider>
    )
    return { queryClient: qc }
}

// vitest 未开 globals：渲染型测试必须显式 cleanup，否则 DOM 累积致 getBy* 多元素报错——工作区已知坑
afterEach(() => cleanup())

describe('SidebarWorkspaces 工作区实体化', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        navigateSpy.mockReset()
    })

    it('渲染工作区组（workspace.name）与「最近」区，游离会话出现在「最近」且默认展开', async () => {
        const s1 = makeSession('s1', '工作区会话一')
        const r1 = makeSession('r1', '游离会话')
        setup({ workspaceSessionsMap: { p1: [s1] }, recent: [r1] })

        // 工作区组标题 = workspace.name（工作区实体化后不再从路径提取目录名）
        expect(await screen.findByText('Demo')).toBeInTheDocument()
        expect(screen.getByText('OtherMachine')).toBeInTheDocument()
        expect(screen.getByText('nav.recent')).toBeInTheDocument()

        // 工作区组会话（含活跃会话自动展开）
        await waitFor(() => expect(screen.getByText('工作区会话一')).toBeInTheDocument())
        // 游离会话在「最近」且默认展开（无需点击）
        expect(screen.getByText('游离会话')).toBeInTheDocument()
    })

    it('工作区组「新建会话」携带 workspaceId 跳转', async () => {
        setup({ workspaceSessionsMap: { p1: [makeSession('s1', 'x')] } })
        await screen.findByText('Demo')

        // header hover 按钮被 CSS 隐藏，但 fireEvent 不受 CSS 影响
        const newSessionBtn = document.querySelector('.new-session-btn') as HTMLButtonElement
        expect(newSessionBtn).toBeTruthy()
        fireEvent.click(newSessionBtn)

        expect(navigateSpy).toHaveBeenCalledWith({
            to: '/sessions/new',
            search: { workspaceId: 'p1' },
        })
    })

    it('工作区列表前端分页：默认 5 个，展开剩余 / 收起', async () => {
        // 7 个工作区：首屏 5 + 剩余 2
        const many = Array.from({ length: 7 }, (_, i) =>
            makeWorkspace({ id: `pp${i}`, name: `工作区${i}` }))
        setup({ workspaces: many })

        expect(await screen.findByText('工作区0')).toBeInTheDocument()
        // 首屏只渲染前 5 个工作区组
        expect(screen.getByText('工作区4')).toBeInTheDocument()
        expect(screen.queryByText('工作区5')).not.toBeInTheDocument()
        expect(screen.queryByText('工作区6')).not.toBeInTheDocument()
        // footer「展开剩余 N」可见
        expect(screen.getByText('nav.showMore')).toBeInTheDocument()

        // 展开剩余 → 7 个全渲染 + 出现「收起」
        fireEvent.click(screen.getByText('nav.showMore'))
        expect(screen.getByText('工作区5')).toBeInTheDocument()
        expect(screen.getByText('工作区6')).toBeInTheDocument()
        expect(screen.getByText('nav.collapse')).toBeInTheDocument()

        // 收起 → 回到 5 个
        fireEvent.click(screen.getByText('nav.collapse'))
        expect(screen.queryByText('工作区5')).not.toBeInTheDocument()
        expect(screen.getByText('工作区4')).toBeInTheDocument()
    })

    it('删除工作区：hover 菜单 → 二次确认 → 调 workspaces.remove', async () => {
        const s1 = makeSession('s1', '工作区会话一')
        const s2 = makeSession('s2', '工作区会话二')
        setup({ workspaceSessionsMap: { p1: [s1, s2] } })
        await screen.findByText('Demo')

        // 工作区组标题「更多」菜单（title = common.more）
        const moreBtn = document.querySelector('button[title="common.more"]') as HTMLButtonElement
        fireEvent.click(moreBtn)

        const deleteItem = await screen.findByText('workspace.delete')
        fireEvent.click(deleteItem)

        // 二次确认文案（t identity 返回 key）+ 确认。
        // antd ConfirmDialog 同一弹窗内会渲染 a11y 用 .ant-modal-title 与可见的 .ant-modal-confirm-title
        // 两份标题文本，故直接用可见标题选择器断言
        const confirmDialog = await waitFor(() => {
            const el = document.querySelector('.ant-modal-confirm') as HTMLElement | null
            expect(el).toBeTruthy()
            return el as HTMLElement
        })
        expect(confirmDialog.querySelector('.ant-modal-confirm-title')?.textContent).toBe('workspace.deleteConfirmTitle')
        fireEvent.click(within(confirmDialog).getByRole('button', { name: 'common.confirm' }))

        await waitFor(() => expect(workspacesRemove).toHaveBeenCalledWith('p1'))
    })

    it('工作区组会话「移至最近」→ assignSession(id, null)', async () => {
        const s1 = makeSession('s1', '工作区会话一')
        setup({ workspaceSessionsMap: { p1: [s1] } })
        await screen.findByText('工作区会话一')

        // 会话行「更多」下拉
        const rowMore = document.querySelector('.session-actions button[title="common.more"]') as HTMLButtonElement
        expect(rowMore).toBeTruthy()
        fireEvent.click(rowMore)

        fireEvent.click(await screen.findByText('workspace.toRecent'))
        await waitFor(() => expect(assignSession).toHaveBeenCalledWith('s1', null))
    })

    it('「归入工作区」只列与会话同机器的工作区', async () => {
        const r1 = makeSession('r1', '游离会话', {
            metadata: { path: '/home/u/x', host: 'h', name: '游离会话', machineId: 'm1' },
        })
        setup({ recent: [r1] })
        await screen.findByText('游离会话')

        // 「归入工作区」已收进行内「更多」dropdown：打开菜单 → 点归入工作区项
        const rowMore = document.querySelector('.session-actions button[title="common.more"]') as HTMLButtonElement
        expect(rowMore).toBeTruthy()
        fireEvent.click(rowMore)
        fireEvent.click(await screen.findByText('workspace.assignTo'))

        // 弹窗打开：同机器工作区可选，跨机器工作区不出现（查询限定在弹窗内，排除侧边栏同名分组；
        // Modal.confirm 静态弹窗跨测试残留，须从 assignTitle 反查所属弹窗）
        await waitFor(() => expect(screen.getByText('workspace.assignTitle')).toBeInTheDocument())
        const modal = screen.getByText('workspace.assignTitle').closest('.ant-modal') as HTMLElement
        expect(modal).toBeTruthy()
        expect(within(modal).getByText('Demo')).toBeInTheDocument()
        expect(within(modal).queryByText('OtherMachine')).not.toBeInTheDocument()

        // 选中后确认 → assignSession(sessionId, workspaceId)
        fireEvent.click(within(modal).getByText('Demo'))
        fireEvent.click(await within(modal).findByRole('button', { name: 'common.confirm' }))
        await waitFor(() => expect(assignSession).toHaveBeenCalledWith('r1', 'p1'))
    })
})
