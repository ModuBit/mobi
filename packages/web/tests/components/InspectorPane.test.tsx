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
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { App as AntdApp } from 'antd'
import { InspectorPane } from '@/components/session/InspectorPane'
import { useWorkspaceStore } from '@/core/data/stores/workspaceStore'
import { clearCachedInstance } from '@/core/hooks/useCachedInstance'
import { getEditorApi } from '@/components/files/EditorRegistry'

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
// mock TerminalView：真实组件依赖 xterm/cachedTerminal（jsdom 无 DOM 布局），
// 用 marker div 暴露 props，验证 terminal tab 渲染接线
vi.mock('@/components/terminal/TerminalView', () => ({
    default: ({ sessionId, terminalId }: { sessionId: string; terminalId: string }) => (
        <div
            data-testid="mock-terminal-view"
            data-session={sessionId}
            data-terminal={terminalId}
        />
    ),
}))
// mock clearCachedInstance：验证关闭 terminal tab 时触发清理（dispose 发 terminal:close 杀 PTY + 断 socket）
vi.mock('@/core/hooks/useCachedInstance', () => ({
    clearCachedInstance: vi.fn(),
}))
// mock FileContentView：真实组件拉 file meta/content（query hooks），dirty/关闭测试只需占位
vi.mock('@/components/files/FileContentView', () => ({
    default: () => <div data-testid="mock-fc" />,
}))
// mock EditorRegistry：getEditorApi 返回可控的 isDirty/saveNow（验证关 tab 保存逻辑）
vi.mock('@/components/files/EditorRegistry', () => ({
    getEditorApi: vi.fn(),
    registerEditor: vi.fn(),
    unregisterEditor: vi.fn(),
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
    // 包 antd App：InspectorPane 用 App.useApp() 取 modal/message，需 holder 上下文
    return render(
        <QueryClientProvider client={qc}>
            <AntdApp>{ui}</AntdApp>
        </QueryClientProvider>,
    )
}

describe('InspectorPane', () => {
    beforeEach(() => {
        useWorkspaceStore.getState().clearAll()
        resumeSessionMock.mockReset()
        vi.mocked(getEditorApi).mockReset()
    })
    afterEach(() => cleanup())

    it('空态：渲染 文件/终端/审查 三个按钮，终端/文件可用，审查 disabled', () => {
        useWorkspaceStore.getState().setExpanded('s1', true)
        renderWithClient(<InspectorPane sessionId="s1" />)
        expect(screen.getByRole('button', { name: 'session.inspector.openFile' })).toBeEnabled()
        // terminal 在空态启用（无 tab → terminalDisabled=false），点击可新建终端
        expect(screen.getByRole('button', { name: 'session.inspector.terminal' })).toBeEnabled()
        expect(screen.getByRole('button', { name: 'session.inspector.review' })).toBeDisabled()
    })

    it('空态：点「终端」→ 新建 terminal tab', () => {
        useWorkspaceStore.getState().setExpanded('s1', true)
        renderWithClient(<InspectorPane sessionId="s1" />)
        fireEvent.click(screen.getByRole('button', { name: 'session.inspector.terminal' }))
        const s = useWorkspaceStore.getState().getSession('s1')
        expect(s.tabs).toHaveLength(1)
        expect(s.tabs[0].mode).toBe('terminal')
        expect(s.activeTabId).toBe(s.tabs[0].id)
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

    it('离线 + 有 tab：保留 tab 内容作毛玻璃背景，叠加恢复层', async () => {
        useWorkspaceStore.getState().setExpanded('s1', true)
        useWorkspaceStore.getState().openTerminalTab('s1') // 关闭前已开 terminal tab
        renderWithClient(<InspectorPane sessionId="s1" active={false} />)
        // tab 内容（mock TerminalView）仍渲染 —— 作为毛玻璃背景，模糊可见关闭前的内容
        // TerminalView 已懒加载（React.lazy），断言需异步等待 chunk resolve
        expect(await screen.findByTestId('mock-terminal-view')).toBeInTheDocument()
        // 恢复层（activate-cover-mask 毛玻璃）覆盖其上
        expect(screen.getByRole('button', { name: 'composer.activate' })).toBeInTheDocument()
        expect(document.querySelector('.activate-cover-mask')).toBeInTheDocument()
    })

    it('关闭 terminal tab：清理缓存终端实例（发 terminal:close 杀 PTY + 断 socket）', () => {
        vi.mocked(clearCachedInstance).mockClear()
        useWorkspaceStore.getState().setExpanded('s1', true)
        useWorkspaceStore.getState().openTerminalTab('s1')
        renderWithClient(<InspectorPane sessionId="s1" />)
        const terminalId = useWorkspaceStore
            .getState()
            .getSession('s1').tabs.find((t) => t.mode === 'terminal')!.terminalId
        // 点 terminal tab 的关闭按钮（editable-card 的 remove）触发 onEdit
        fireEvent.click(document.querySelector('.ant-tabs-tab-remove') as HTMLElement)
        // 清理该 terminalId 的缓存实例 → dispose 发 terminal:close 杀 PTY + 断 socket
        expect(clearCachedInstance).toHaveBeenCalledWith(`terminal:s1:${terminalId}`)
        // store 里 tab 已移除
        expect(useWorkspaceStore.getState().getSession('s1').tabs).toHaveLength(0)
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

    it('openTerminalTab 后 terminal tab 激活并渲染 TerminalView', async () => {
        useWorkspaceStore.getState().setExpanded('s1', true)
        useWorkspaceStore.getState().openTerminalTab('s1')
        renderWithClient(<InspectorPane sessionId="s1" />)
        const st = useWorkspaceStore.getState().getSession('s1')
        const terminalTab = st.tabs.find((t) => t.mode === 'terminal')
        expect(terminalTab).toBeTruthy()
        expect(st.activeTabId).toBe(terminalTab!.id)
        // 渲染了终端视图（TerminalView 懒加载，需异步等待 chunk resolve）
        const tv = await screen.findByTestId('mock-terminal-view')
        expect(tv).toHaveAttribute('data-session', 's1')
        expect(tv.getAttribute('data-terminal')).toBe(terminalTab!.terminalId)
    })

    it('未达上限时「+」菜单 terminal 项可点，点击触发 openTerminalTab', () => {
        useWorkspaceStore.getState().setExpanded('s1', true)
        // 先开一个 tree tab 让「+」按钮出现（tabs.length > 0 才进入 tab 态）
        useWorkspaceStore.getState().openFileTreeTab('s1')
        renderWithClient(<InspectorPane sessionId="s1" />)
        fireEvent.click(screen.getByRole('button', { name: 'session.inspector.addTab' }))
        const terminalItem = screen.getByText('session.inspector.terminal').closest('[role="menuitem"]')
        expect(terminalItem).toBeTruthy()
        // action.disabled=false 且未达上限 → 菜单项可点
        expect(terminalItem?.getAttribute('aria-disabled')).not.toBe('true')
        fireEvent.click(terminalItem!)
        const s = useWorkspaceStore.getState().getSession('s1')
        const terminalTab = s.tabs.find((t) => t.mode === 'terminal')
        expect(terminalTab).toBeTruthy()
        expect(s.activeTabId).toBe(terminalTab!.id)
    })

    it('达上限（3 个终端）时「+」菜单 terminal 项 disabled', () => {
        useWorkspaceStore.getState().setExpanded('s1', true)
        useWorkspaceStore.getState().openTerminalTab('s1')
        useWorkspaceStore.getState().openTerminalTab('s1')
        useWorkspaceStore.getState().openTerminalTab('s1')
        renderWithClient(<InspectorPane sessionId="s1" />)
        // 「+」下拉菜单中 terminal 项 disabled。
        // Task 9 启用 terminal 后 action.disabled=false，disabled 完全由 terminalLimitReached 决定，
        // 此处真正验证上限叠加（覆盖 Task 8 当时 action.disabled=true 无法独立验证的缺口）
        fireEvent.click(screen.getByRole('button', { name: 'session.inspector.addTab' }))
        const terminalItem = screen.getByText('session.inspector.terminal').closest('[role="menuitem"]')
        expect(terminalItem).toBeTruthy()
        expect(terminalItem?.getAttribute('aria-disabled')).toBe('true')
    })

    it('dirty 文件「保存并关闭」：saveNow 失败 → 不关 tab（防静默丢数据）', async () => {
        const saveNow = vi.fn().mockResolvedValue({ ok: false })
        vi.mocked(getEditorApi).mockReturnValue({ isDirty: () => true, saveNow })

        useWorkspaceStore.getState().setExpanded('s1', true)
        useWorkspaceStore.getState().openFileTreeTab('s1')
        const treeTab = useWorkspaceStore.getState().getSession('s1').tabs[0]
        useWorkspaceStore.getState().openFileInTab('s1', treeTab.id, 'a.md', 'a.md')

        renderWithClient(<InspectorPane sessionId="s1" />)
        // 点 file tab 关闭 → 弹「未保存」确认框
        fireEvent.click(document.querySelector('.ant-tabs-tab-remove') as HTMLElement)
        // 点「保存并关闭」（i18n mock 返回 key 本身）
        const saveBtn = await screen.findByText('files.saveAndClose')
        await fireEvent.click(saveBtn)
        // saveNow 被调用且返回失败 → tab 必须保留（旧逻辑无条件关闭，静默丢弃编辑）
        await waitFor(() => expect(saveNow).toHaveBeenCalledTimes(1))
        expect(useWorkspaceStore.getState().getSession('s1').tabs).toHaveLength(1)
    })

    it('dirty 文件「保存并关闭」：saveNow 成功 → 关 tab', async () => {
        const saveNow = vi.fn().mockResolvedValue({ ok: true })
        vi.mocked(getEditorApi).mockReturnValue({ isDirty: () => true, saveNow })

        useWorkspaceStore.getState().setExpanded('s1', true)
        useWorkspaceStore.getState().openFileTreeTab('s1')
        const treeTab = useWorkspaceStore.getState().getSession('s1').tabs[0]
        useWorkspaceStore.getState().openFileInTab('s1', treeTab.id, 'a.md', 'a.md')

        renderWithClient(<InspectorPane sessionId="s1" />)
        fireEvent.click(document.querySelector('.ant-tabs-tab-remove') as HTMLElement)
        const saveBtn = await screen.findByText('files.saveAndClose')
        await fireEvent.click(saveBtn)
        // 成功 → tab 关闭
        await waitFor(() => expect(useWorkspaceStore.getState().getSession('s1').tabs).toHaveLength(0))
    })
})
