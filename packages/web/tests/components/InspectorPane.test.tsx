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

import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest'
import '@testing-library/jest-dom/vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { InspectorPane } from '@/components/session/InspectorPane'
import { useWorkspaceStore } from '@/core/data/stores/workspaceStore'

vi.mock('@/core/data/hooks/useMediaQuery', () => ({
    useIsMobile: () => false,
}))
vi.mock('@/core/data/hooks/queries/useFileTree', () => ({
    useFileTree: vi.fn(() => ({ data: [], isLoading: false })),
    useFileContent: vi.fn(() => ({ data: 'content', isLoading: false })),
}))
// mock i18next：t(key) => key；合并 actual 以保留 initReactI18next
// （FileContentView → CodeHighlight → uiStore 顶层 import i18n，i18n.init 需要 initReactI18next）
vi.mock('react-i18next', async (importOriginal) => {
    const actual = await importOriginal<typeof import('react-i18next')>()
    return {
        ...actual,
        useTranslation: () => ({ t: (key: string) => key }),
    }
})
const resumeSessionMock = vi.fn()
vi.mock('@/core/data/hooks/mutations/useSessionActions', () => ({
    useSessionActions: () => ({ resumeSession: resumeSessionMock, isResumePending: false }),
}))

// jsdom 没有 ResizeObserver（antd Tabs 依赖）
beforeAll(() => {
    vi.stubGlobal('ResizeObserver', class {
        observe() {}
        unobserve() {}
        disconnect() {}
    })
})

function renderWithClient(ui: React.ReactNode) {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>)
}

describe('InspectorPane', () => {
    beforeEach(() => {
        useWorkspaceStore.getState().clearAll()
        resumeSessionMock.mockReset()
    })
    afterEach(() => cleanup())

    it('空态：渲染 文件/终端/审查 三个按钮，终端审查 disabled', () => {
        useWorkspaceStore.getState().setExpanded('s1', true)
        renderWithClient(<InspectorPane sessionId="s1" />)
        expect(screen.getByRole('button', { name: 'session.inspector.openFile' })).toBeEnabled()
        expect(screen.getByRole('button', { name: 'session.inspector.terminal' })).toBeDisabled()
        expect(screen.getByRole('button', { name: 'session.inspector.review' })).toBeDisabled()
    })

    it('session 离线（active=false）：覆盖恢复层，点按钮调 resumeSession', () => {
        useWorkspaceStore.getState().setExpanded('s1', true)
        renderWithClient(<InspectorPane sessionId="s1" active={false} />)
        // 不渲染空态文件按钮
        expect(screen.queryByRole('button', { name: 'session.inspector.openFile' })).toBeNull()
        // 渲染恢复按钮
        const resumeBtn = screen.getByRole('button', { name: 'composer.activate' })
        fireEvent.click(resumeBtn)
        expect(resumeSessionMock).toHaveBeenCalled()
    })

    it('点「文件」→ 出现 tree tab', () => {
        useWorkspaceStore.getState().setExpanded('s1', true)
        renderWithClient(<InspectorPane sessionId="s1" />)
        fireEvent.click(screen.getByRole('button', { name: 'session.inspector.openFile' }))
        const s = useWorkspaceStore.getState().getSession('s1')
        expect(s.tabs).toHaveLength(1)
        expect(s.tabs[0].mode).toBe('tree')
    })

    it('tab 存在时尾部出现 + 按钮', () => {
        useWorkspaceStore.getState().setExpanded('s1', true)
        useWorkspaceStore.getState().openFileTreeTab('s1')
        renderWithClient(<InspectorPane sessionId="s1" />)
        expect(screen.getByRole('button', { name: 'session.inspector.addTab' })).toBeInTheDocument()
    })

    it('关闭最后一个 tab → 收起 inspector', () => {
        useWorkspaceStore.getState().setExpanded('s1', true)
        useWorkspaceStore.getState().openFileTreeTab('s1')
        const { container } = renderWithClient(<InspectorPane sessionId="s1" />)
        // antd Tabs closable 渲染 .ant-tabs-tab-remove
        const remove = container.querySelector('.ant-tabs-tab-remove') as HTMLElement
        expect(remove).toBeTruthy()
        fireEvent.click(remove)
        const s = useWorkspaceStore.getState().getSession('s1')
        expect(s.tabs).toHaveLength(0)
        expect(s.expanded).toBe(false)
    })
})
