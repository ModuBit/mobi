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
 * AssignProjectModal 组件测试
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
vi.mock('@/core/data/hooks/mutations/useProjectMutations', () => ({
    useAssignSessionProject: () => ({ mutateAsync: assignMock, isPending: false }),
}))

// 项目 fixtures（vi.mock 工厂被提升，须经 hoisted 引用）
const fixtures = vi.hoisted(() => ({
    projects: [
        { id: 'proj-1', machineId: 'm1', name: '项目一', folders: [{ path: '/home/u/proj1', primary: true }], createdAt: 1, updatedAt: 1 },
        { id: 'proj-2', machineId: 'other', name: '别的机器', folders: [{ path: '/x', primary: true }], createdAt: 2, updatedAt: 2 },
    ],
}))
vi.mock('@/core/data/hooks/queries/useProjects', () => ({
    useProjects: () => ({ data: fixtures.projects }),
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

import { AssignProjectModal } from '@/components/project/AssignProjectModal'

const session = {
    id: 'sess-1',
    metadata: { machineId: 'm1' },
} as unknown as Session

function renderModal(open = true) {
    return render(
        <AntdApp>
            <AssignProjectModal session={session} open={open} onClose={() => {}} />
        </AntdApp>,
    )
}

describe('AssignProjectModal', () => {
    beforeEach(() => {
        mockIsMobile.value = false
        assignMock.mockReset()
    })

    afterEach(cleanup)

    it('PC：渲染居中 Modal + Radio 列表（同机器过滤，现状保留）', () => {
        const { getByText, queryByText } = renderModal()
        expect(getByText('project.assignTitle')).toBeInTheDocument()
        expect(getByText('项目一')).toBeInTheDocument()
        // 只列同机器项目
        expect(queryByText('别的机器')).toBeNull()
    })

    it('mobile：渲染 MobileDrawer + 项目行，点行即提交（同机器过滤）', async () => {
        mockIsMobile.value = true
        const { getByTestId, getByText, queryByText } = renderModal()

        expect(getByTestId('mobile-drawer')).toBeInTheDocument()
        expect(getByTestId('drawer-title').textContent).toBe('project.assignTitle')
        expect(getByText('项目一')).toBeInTheDocument()
        // 只列同机器项目
        expect(queryByText('别的机器')).toBeNull()

        fireEvent.click(getByText('项目一'))
        await waitFor(() => expect(assignMock).toHaveBeenCalledTimes(1))
        expect(assignMock).toHaveBeenCalledWith({ sessionId: 'sess-1', projectId: 'proj-1' })
    })

    it('mobile：无同机器项目时展示空态文案，无列表行', () => {
        mockIsMobile.value = true
        const emptySession = { id: 'sess-2', metadata: { machineId: 'none' } } as unknown as Session
        const { getByText, queryByText } = render(
            <AntdApp>
                <AssignProjectModal session={emptySession} open onClose={() => {}} />
            </AntdApp>,
        )
        expect(getByText('project.assignEmpty')).toBeInTheDocument()
        expect(queryByText('项目一')).toBeNull()
    })

    it('open=false 时不渲染', () => {
        mockIsMobile.value = true
        const { queryByTestId } = renderModal(false)
        expect(queryByTestId('mobile-drawer')).toBeNull()
    })
})
