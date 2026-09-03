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
 * MobileProjectList ActionSheet 测试
 * 验证按 session.projectId 动态显示归属操作（归入项目 / 换项目 + 移至最近）
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, cleanup, fireEvent, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { App as AntdApp } from 'antd'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import type { Session } from '@/core/data/api/types'

vi.mock('react-i18next', async (importOriginal) => {
    const actual = await importOriginal<typeof import('react-i18next')>()
    return { ...actual, useTranslation: () => ({ t: (k: string) => k }) }
})

vi.mock('@tanstack/react-router', () => ({
    useNavigate: () => vi.fn(),
    useParams: () => ({}),
}))

// 会话 fixture：按用例切换 allSessions（vi.mock 工厂被提升，须经 hoisted 引用）
const fixtures = vi.hoisted(() => ({
    sessions: [] as unknown[],
}))

vi.mock('@/core/data/hooks/queries/useSessions', () => ({
    useSessions: () => ({ data: fixtures.sessions }),
}))

vi.mock('@/core/data/hooks/queries/useProjects', () => ({
    useProjects: () => ({ data: [{ id: 'proj-1', name: 'P1', machineId: 'm1' }] }),
}))

const assignMock = vi.hoisted(() => vi.fn())
vi.mock('@/core/data/hooks/mutations/useProjectMutations', () => ({
    useAssignSessionProject: () => ({ mutateAsync: assignMock, isPending: false }),
}))

vi.mock('@/core/data/hooks/mutations/useSessionPinned', () => ({
    useSetSessionPinned: () => ({ mutateAsync: vi.fn() }),
}))

vi.mock('@/core/data/hooks/mutations/useSessionActions', () => ({
    useSessionActions: () => ({ renameSession: vi.fn(), isPending: false }),
}))

vi.mock('@/core/data/api/client', () => ({
    useMobiApi: () => ({ sessions: { archive: vi.fn(), resume: vi.fn(), delete: vi.fn() } }),
}))

// 三个分区组件桩：渲染触发按钮调用 onSessionAction，隔离 ActionSheet 逻辑
vi.mock('@/components/layout/MobileProjectGroup', () => ({
    MobileProjectGroup: ({ onSessionAction }: { onSessionAction: (id: string) => void }) => (
        <button onClick={() => onSessionAction('sess-in-project')}>open-in-project</button>
    ),
}))
vi.mock('@/components/layout/MobileRecentGroup', () => ({
    MobileRecentGroup: ({ onSessionAction }: { onSessionAction: (id: string) => void }) => (
        <button onClick={() => onSessionAction('sess-free')}>open-free</button>
    ),
}))
vi.mock('@/components/layout/MobilePinnedGroup', () => ({
    MobilePinnedGroup: () => null,
}))

vi.mock('@/components/project/ProjectFormModal', () => ({
    ProjectFormModal: () => null,
}))

// AssignProjectModal 桩：断言 open 状态
vi.mock('@/components/project/AssignProjectModal', () => ({
    AssignProjectModal: ({ open }: { open: boolean }) =>
        open ? <div data-testid="assign-modal" /> : null,
}))

import { MobileProjectList } from '@/components/layout/MobileProjectList'

const inProjectSession = {
    id: 'sess-in-project',
    projectId: 'proj-1',
    pinned: false,
    active: true,
    metadata: { name: '项目内会话' },
} as unknown as Session

const freeSession = {
    id: 'sess-free',
    projectId: null,
    pinned: false,
    active: true,
    metadata: { name: '游离会话' },
} as unknown as Session

function makeWrapper() {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    return function Wrapper({ children }: { children: ReactNode }) {
        return (
            <AntdApp>
                <QueryClientProvider client={qc}>{children}</QueryClientProvider>
            </AntdApp>
        )
    }
}

describe('MobileProjectList ActionSheet 归属操作', () => {
    beforeEach(() => {
        assignMock.mockReset()
    })

    afterEach(cleanup)

    it('游离会话：只显示「归入项目」，无「换项目/移至最近」', () => {
        fixtures.sessions = [freeSession]
        const { getByText, queryByText } = render(<MobileProjectList />, { wrapper: makeWrapper() })

        fireEvent.click(getByText('open-free'))
        expect(getByText('project.assignTo')).toBeInTheDocument()
        expect(queryByText('project.changeProject')).toBeNull()
        expect(queryByText('project.toRecent')).toBeNull()
    })

    it('项目内会话：显示「换项目 + 移至最近」，无「归入项目」', () => {
        fixtures.sessions = [inProjectSession]
        const { getByText, queryByText } = render(<MobileProjectList />, { wrapper: makeWrapper() })

        fireEvent.click(getByText('open-in-project'))
        expect(getByText('project.changeProject')).toBeInTheDocument()
        expect(getByText('project.toRecent')).toBeInTheDocument()
        expect(queryByText('project.assignTo')).toBeNull()
    })

    it('换项目：关 ActionSheet 打开 AssignProjectModal', () => {
        fixtures.sessions = [inProjectSession]
        const { getByText, getByTestId, queryByText } = render(<MobileProjectList />, { wrapper: makeWrapper() })

        fireEvent.click(getByText('open-in-project'))
        fireEvent.click(getByText('project.changeProject'))
        expect(getByTestId('assign-modal')).toBeInTheDocument()
        expect(queryByText('project.changeProject')).toBeNull() // ActionSheet 已关
    })

    it('移至最近：assign(projectId: null) + 关 ActionSheet', async () => {
        fixtures.sessions = [inProjectSession]
        assignMock.mockResolvedValue(undefined)
        const { getByText, queryByText } = render(<MobileProjectList />, { wrapper: makeWrapper() })

        fireEvent.click(getByText('open-in-project'))
        fireEvent.click(getByText('project.toRecent'))
        await waitFor(() => expect(assignMock).toHaveBeenCalledWith({ sessionId: 'sess-in-project', projectId: null }))
        await waitFor(() => expect(queryByText('project.toRecent')).toBeNull()) // ActionSheet 已关
    })
})
