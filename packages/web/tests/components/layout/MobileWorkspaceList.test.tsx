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
 * MobileWorkspaceList ActionSheet 测试
 * 验证按 session.workspaceId 动态显示归属操作（归入工作区 / 换工作区 + 移至最近）
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

vi.mock('@/core/data/hooks/queries/useWorkspaces', () => ({
    useWorkspaces: () => ({ data: [{ id: 'proj-1', name: 'P1', machineId: 'm1' }] }),
}))

const assignMock = vi.hoisted(() => vi.fn())
vi.mock('@/core/data/hooks/mutations/useWorkspaceMutations', () => ({
    useAssignSessionWorkspace: () => ({ mutateAsync: assignMock, isPending: false }),
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
vi.mock('@/components/layout/MobileWorkspaceGroup', () => ({
    MobileWorkspaceGroup: ({ onSessionAction }: { onSessionAction: (id: string) => void }) => (
        <button onClick={() => onSessionAction('sess-in-workspace')}>open-in-workspace</button>
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

vi.mock('@/components/workspace/WorkspaceFormModal', () => ({
    WorkspaceFormModal: () => null,
}))

// AssignWorkspaceModal 桩：断言 open 状态
vi.mock('@/components/workspace/AssignWorkspaceModal', () => ({
    AssignWorkspaceModal: ({ open }: { open: boolean }) =>
        open ? <div data-testid="assign-modal" /> : null,
}))

import { MobileWorkspaceList } from '@/components/layout/MobileWorkspaceList'

const inWorkspaceSession = {
    id: 'sess-in-workspace',
    workspaceId: 'proj-1',
    pinned: false,
    active: true,
    metadata: { name: '工作区内会话' },
} as unknown as Session

const freeSession = {
    id: 'sess-free',
    workspaceId: null,
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

describe('MobileWorkspaceList ActionSheet 归属操作', () => {
    beforeEach(() => {
        assignMock.mockReset()
    })

    afterEach(cleanup)

    it('游离会话：只显示「归入工作区」，无「换工作区/移至最近」', () => {
        fixtures.sessions = [freeSession]
        const { getByText, queryByText } = render(<MobileWorkspaceList />, { wrapper: makeWrapper() })

        fireEvent.click(getByText('open-free'))
        expect(getByText('workspace.assignTo')).toBeInTheDocument()
        expect(queryByText('workspace.changeWorkspace')).toBeNull()
        expect(queryByText('workspace.toRecent')).toBeNull()
    })

    it('工作区内会话：显示「换工作区 + 移至最近」，无「归入工作区」', () => {
        fixtures.sessions = [inWorkspaceSession]
        const { getByText, queryByText } = render(<MobileWorkspaceList />, { wrapper: makeWrapper() })

        fireEvent.click(getByText('open-in-workspace'))
        expect(getByText('workspace.changeWorkspace')).toBeInTheDocument()
        expect(getByText('workspace.toRecent')).toBeInTheDocument()
        expect(queryByText('workspace.assignTo')).toBeNull()
    })

    it('换工作区：关 ActionSheet 打开 AssignWorkspaceModal', () => {
        fixtures.sessions = [inWorkspaceSession]
        const { getByText, getByTestId, queryByText } = render(<MobileWorkspaceList />, { wrapper: makeWrapper() })

        fireEvent.click(getByText('open-in-workspace'))
        fireEvent.click(getByText('workspace.changeWorkspace'))
        expect(getByTestId('assign-modal')).toBeInTheDocument()
        expect(queryByText('workspace.changeWorkspace')).toBeNull() // ActionSheet 已关
    })

    it('移至最近：assign(workspaceId: null) + 关 ActionSheet', async () => {
        fixtures.sessions = [inWorkspaceSession]
        assignMock.mockResolvedValue(undefined)
        const { getByText, queryByText } = render(<MobileWorkspaceList />, { wrapper: makeWrapper() })

        fireEvent.click(getByText('open-in-workspace'))
        fireEvent.click(getByText('workspace.toRecent'))
        await waitFor(() => expect(assignMock).toHaveBeenCalledWith({ sessionId: 'sess-in-workspace', workspaceId: null }))
        await waitFor(() => expect(queryByText('workspace.toRecent')).toBeNull()) // ActionSheet 已关
    })
})
