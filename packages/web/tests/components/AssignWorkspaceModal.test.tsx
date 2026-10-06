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
 * AssignWorkspaceModal 组件测试
 * 验证端别自适应：PC 居中 Modal + Radio（现状保留）；mobile MobileDrawer 点行即提交
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, cleanup, fireEvent, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { App as AntdApp } from 'antd'
import type { ReactNode } from 'react'
import type { Session } from '@/core/data/api/types'

// useIsMobile 按用例切换（mockIsMobile.value）
const mockIsMobile = vi.hoisted(() => ({ value: false }))
vi.mock('@/core/data/hooks/useMediaQuery', () => ({
    useIsMobile: () => mockIsMobile.value,
}))

const assignMock = vi.hoisted(() => vi.fn())
vi.mock('@/core/data/hooks/mutations/useWorkspaceMutations', () => ({
    useAssignSessionWorkspace: () => ({ mutateAsync: assignMock, isPending: false }),
}))

// 工作区 fixtures（vi.mock 工厂被提升，须经 hoisted 引用；list 可按用例替换，afterEach 还原）
const defaultWorkspaces = [
    { id: 'proj-1', name: '工作区一', folders: [{ path: '/home/u/proj1', primary: true }], createdAt: 1, updatedAt: 1 },
    { id: 'proj-2', name: '工作区二', folders: [{ path: '/x', primary: true }], createdAt: 2, updatedAt: 2 },
]
const fixtures = vi.hoisted(() => ({
    workspaces: [] as Array<Record<string, unknown>>,
}))
vi.mock('@/core/data/hooks/queries/useWorkspaces', () => ({
    useWorkspaces: () => ({ data: fixtures.workspaces }),
}))

// MobileDrawer 桩：绕开 framer-motion jsdom spring 发散（既有惯例，见 MobileMenu.test）
vi.mock('@/components/ui/MobileDrawer', () => ({
    MobileDrawer: ({ open, title, children }: { open: boolean; title?: string; children: ReactNode }) =>
        open ? (
            <div data-testid="mobile-drawer">
                <div data-testid="drawer-title">{title}</div>
                {children}
            </div>
        ) : null,
}))

vi.mock('react-i18next', () => ({
    useTranslation: () => ({ t: (k: string) => k }),
}))

import { AssignWorkspaceModal } from '@/components/workspace/AssignWorkspaceModal'

const session = {
    id: 'sess-1',
    metadata: { path: '/home/u/proj1' },
} as unknown as Session

function renderModal(open = true) {
    return render(
        <AntdApp>
            <AssignWorkspaceModal session={session} open={open} onClose={() => {}} />
        </AntdApp>,
    )
}

describe('AssignWorkspaceModal', () => {
    beforeEach(() => {
        mockIsMobile.value = false
        assignMock.mockReset()
        fixtures.workspaces = defaultWorkspaces.map((w) => ({ ...w }))
    })

    afterEach(cleanup)

    it('PC：渲染居中 Modal + Radio 列表（单机：全量工作区可选）', () => {
        const { getByText } = renderModal()
        expect(getByText('workspace.assignTitle')).toBeInTheDocument()
        expect(getByText('工作区一')).toBeInTheDocument()
        expect(getByText('工作区二')).toBeInTheDocument()
    })

    it('mobile：渲染 MobileDrawer + 工作区行，点行即提交', async () => {
        mockIsMobile.value = true
        const { getByTestId, getByText } = renderModal()

        expect(getByTestId('mobile-drawer')).toBeInTheDocument()
        expect(getByTestId('drawer-title').textContent).toBe('workspace.assignTitle')
        expect(getByText('工作区一')).toBeInTheDocument()

        fireEvent.click(getByText('工作区一'))
        await waitFor(() => expect(assignMock).toHaveBeenCalledTimes(1))
        expect(assignMock).toHaveBeenCalledWith({ sessionId: 'sess-1', workspaceId: 'proj-1' })
    })

    it('mobile：无工作区时展示空态文案，无列表行', () => {
        mockIsMobile.value = true
        fixtures.workspaces = []
        const { getByText, queryByText } = render(
            <AntdApp>
                <AssignWorkspaceModal session={null} open onClose={() => {}} />
            </AntdApp>,
        )
        expect(getByText('workspace.assignEmpty')).toBeInTheDocument()
        expect(queryByText('工作区一')).toBeNull()
    })

    it('open=false 时不渲染', () => {
        mockIsMobile.value = true
        const { queryByTestId } = renderModal(false)
        expect(queryByTestId('mobile-drawer')).toBeNull()
    })
})
