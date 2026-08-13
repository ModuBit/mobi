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

// ============ useMobiApi mock（必须返回稳定引用，否则 effect 无限循环 OOM——项目已知坑） ============

const sessionsList = vi.hoisted(() => vi.fn())
const sessionsArchive = vi.hoisted(() => vi.fn())
const sessionsResume = vi.hoisted(() => vi.fn())
const sessionsDelete = vi.hoisted(() => vi.fn())
const projectsList = vi.hoisted(() => vi.fn())
const projectsRemove = vi.hoisted(() => vi.fn())
const projectSessions = vi.hoisted(() => vi.fn())
const unboundSessions = vi.hoisted(() => vi.fn())
const assignSession = vi.hoisted(() => vi.fn())
const mockApi = {
    sessions: {
        list: sessionsList,
        archive: sessionsArchive,
        resume: sessionsResume,
        delete: sessionsDelete,
    },
    projects: {
        list: projectsList,
        remove: projectsRemove,
        sessions: projectSessions,
        unboundSessions: unboundSessions,
        assignSession: assignSession,
    },
    visibility: { report: vi.fn().mockResolvedValue(undefined) },
}
vi.mock('@/core/data/api/client', () => ({
    useMobiApi: () => mockApi,
}))

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

import { SidebarProjects } from '@/components/layout/SidebarProjects'
import type { Session, Project } from '@/core/data/api/types'

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

/** 构造分页响应 */
function pageOf(sessions: Session[], total = sessions.length) {
    return { data: { sessions, nextCursor: null, hasMore: false, total } }
}

const P1 = makeProject()
const P2 = makeProject({ id: 'p2', machineId: 'm2', name: 'OtherMachine' })

function setup(opts: { projects?: Project[]; projectSessionsMap?: Record<string, Session[]>; recent?: Session[] } = {}) {
    const projects = opts.projects ?? [P1, P2]
    const map = opts.projectSessionsMap ?? {}
    projectsList.mockImplementation(async (machineId?: string) => ({
        data: { projects: machineId ? projects.filter(p => p.machineId === machineId) : projects },
    }))
    projectSessions.mockImplementation(async (projectId: string) => pageOf(map[projectId] ?? []))
    unboundSessions.mockResolvedValue(pageOf(opts.recent ?? []))

    // staleTime Infinity + 预置 ['sessions']：避免 useSessions 拉取与分组 upsert 竞争覆盖
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } })
    qc.setQueryData(['sessions'], [])
    render(
        <QueryClientProvider client={qc}>
            <ConfigProvider>
                <AntdApp>
                    <SidebarProjects />
                </AntdApp>
            </ConfigProvider>
        </QueryClientProvider>
    )
    return { queryClient: qc }
}

// vitest 未开 globals：渲染型测试必须显式 cleanup，否则 DOM 累积致 getBy* 多元素报错——项目已知坑
afterEach(() => cleanup())

describe('SidebarProjects 项目实体化', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        navigateSpy.mockReset()
    })

    it('渲染项目组（project.name）与「最近」区，游离会话出现在「最近」且默认展开', async () => {
        const s1 = makeSession('s1', '项目会话一')
        const r1 = makeSession('r1', '游离会话')
        setup({ projectSessionsMap: { p1: [s1] }, recent: [r1] })

        // 项目组标题 = project.name（项目实体化后不再从路径提取目录名）
        expect(await screen.findByText('Demo')).toBeInTheDocument()
        expect(screen.getByText('OtherMachine')).toBeInTheDocument()
        expect(screen.getByText('nav.recent')).toBeInTheDocument()

        // 项目组会话（含活跃会话自动展开）
        await waitFor(() => expect(screen.getByText('项目会话一')).toBeInTheDocument())
        // 游离会话在「最近」且默认展开（无需点击）
        expect(screen.getByText('游离会话')).toBeInTheDocument()
    })

    it('项目组「新建会话」携带 projectId 跳转', async () => {
        setup({ projectSessionsMap: { p1: [makeSession('s1', 'x')] } })
        await screen.findByText('Demo')

        // header hover 按钮被 CSS 隐藏，但 fireEvent 不受 CSS 影响
        const newSessionBtn = document.querySelector('.new-session-btn') as HTMLButtonElement
        expect(newSessionBtn).toBeTruthy()
        fireEvent.click(newSessionBtn)

        expect(navigateSpy).toHaveBeenCalledWith({
            to: '/sessions/new',
            search: { cwd: '/home/u/demo', projectId: 'p1' },
        })
    })

    it('删除项目：hover 菜单 → 二次确认 → 调 projects.remove', async () => {
        const s1 = makeSession('s1', '项目会话一')
        const s2 = makeSession('s2', '项目会话二')
        setup({ projectSessionsMap: { p1: [s1, s2] } })
        await screen.findByText('Demo')

        // 项目组标题「更多」菜单（title = common.more）
        const moreBtn = document.querySelector('button[title="common.more"]') as HTMLButtonElement
        fireEvent.click(moreBtn)

        const deleteItem = await screen.findByText('project.delete')
        fireEvent.click(deleteItem)

        // 二次确认文案（t identity 返回 key）+ 确认。
        // antd ConfirmDialog 同一弹窗内会渲染 a11y 用 .ant-modal-title 与可见的 .ant-modal-confirm-title
        // 两份标题文本，故直接用可见标题选择器断言
        const confirmDialog = await waitFor(() => {
            const el = document.querySelector('.ant-modal-confirm') as HTMLElement | null
            expect(el).toBeTruthy()
            return el as HTMLElement
        })
        expect(confirmDialog.querySelector('.ant-modal-confirm-title')?.textContent).toBe('project.deleteConfirmTitle')
        fireEvent.click(within(confirmDialog).getByRole('button', { name: 'common.confirm' }))

        await waitFor(() => expect(projectsRemove).toHaveBeenCalledWith('p1'))
    })

    it('项目组会话「移至最近」→ assignSession(id, null)', async () => {
        const s1 = makeSession('s1', '项目会话一')
        setup({ projectSessionsMap: { p1: [s1] } })
        await screen.findByText('项目会话一')

        // 会话行「更多」下拉
        const rowMore = document.querySelector('.session-actions button[title="common.more"]') as HTMLButtonElement
        expect(rowMore).toBeTruthy()
        fireEvent.click(rowMore)

        fireEvent.click(await screen.findByText('project.toRecent'))
        await waitFor(() => expect(assignSession).toHaveBeenCalledWith('s1', null))
    })

    it('「归入项目」只列与会话同机器的项目', async () => {
        const r1 = makeSession('r1', '游离会话', {
            metadata: { path: '/home/u/x', host: 'h', name: '游离会话', machineId: 'm1' },
        })
        setup({ recent: [r1] })
        await screen.findByText('游离会话')

        // 「最近」行的「归入项目」按钮（title = project.assignTo）
        const assignBtn = document.querySelector('.session-actions button[title="project.assignTo"]') as HTMLButtonElement
        expect(assignBtn).toBeTruthy()
        fireEvent.click(assignBtn)

        // 弹窗打开：同机器项目可选，跨机器项目不出现（查询限定在弹窗内，排除侧边栏同名分组；
        // Modal.confirm 静态弹窗跨测试残留，须从 assignTitle 反查所属弹窗）
        await waitFor(() => expect(screen.getByText('project.assignTitle')).toBeInTheDocument())
        const modal = screen.getByText('project.assignTitle').closest('.ant-modal') as HTMLElement
        expect(modal).toBeTruthy()
        expect(within(modal).getByText('Demo')).toBeInTheDocument()
        expect(within(modal).queryByText('OtherMachine')).not.toBeInTheDocument()

        // 选中后确认 → assignSession(sessionId, projectId)
        fireEvent.click(within(modal).getByText('Demo'))
        fireEvent.click(await within(modal).findByRole('button', { name: 'common.confirm' }))
        await waitFor(() => expect(assignSession).toHaveBeenCalledWith('r1', 'p1'))
    })
})
