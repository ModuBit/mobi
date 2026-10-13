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
import { InspectorPane } from '@/pages/session/InspectorPane'
import { useWorkspaceStore } from '@/core/data/stores/workspaceStore'
import { clearCachedInstance } from '@/core/hooks/useCachedInstance'
import { getEditorApi } from '@/features/files/editorRegistry'

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
vi.mock('@/features/terminal/TerminalView', () => ({
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
vi.mock('@/features/files/FileContentView', () => ({
    default: () => <div data-testid="mock-fc" />,
}))
// mock EditorRegistry：getEditorApi 返回可控的 isDirty/saveNow（验证关 tab 保存逻辑）
vi.mock('@/features/files/editorRegistry', () => ({
    getEditorApi: vi.fn(),
    registerEditor: vi.fn(),
    unregisterEditor: vi.fn(),
}))

// jsdom 没有 ResizeObserver（dropdown-menu 的 TriggerLabel 依赖）
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

    it('空态：渲染 文件/终端/审查 三个按钮且全部可用，点审查打开审查 tab', () => {
        useWorkspaceStore.getState().setExpanded('s1', true)
        renderWithClient(<InspectorPane sessionId="s1" />)
        expect(screen.getByRole('button', { name: 'session.inspector.openFile' })).toBeEnabled()
        // terminal 在空态启用（无 tab → terminalDisabled=false），点击可新建终端
        expect(screen.getByRole('button', { name: 'session.inspector.terminal' })).toBeEnabled()
        // 审查重写后审查视图全量可用（空态按钮曾是置灰占位，票09 E2E 发现后接线）
        const review = screen.getByRole('button', { name: 'session.inspector.review' })
        expect(review).toBeEnabled()
        fireEvent.click(review)
        const s = useWorkspaceStore.getState().getSession('s1')
        expect(s.tabs.filter((t) => t.mode === 'review')).toHaveLength(1)
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

    it('休眠空态：空态按钮照常显示，无恢复 mask（文件树 machine 化冷可用）', () => {
        useWorkspaceStore.getState().setExpanded('s1', true)
        renderWithClient(<InspectorPane sessionId="s1" active={false} />)
        expect(screen.getByRole('button', { name: 'session.inspector.openFile' })).toBeInTheDocument()
        expect(document.querySelector('.activate-cover-mask')).toBeNull()
    })

    it('休眠 + 终端 tab：不叠恢复层（TerminalView 自带重连遮罩 + session_waking 自动唤醒）', async () => {
        useWorkspaceStore.getState().setExpanded('s1', true)
        useWorkspaceStore.getState().openTerminalTab('s1')
        renderWithClient(<InspectorPane sessionId="s1" active={false} />)
        expect(await screen.findByTestId('mock-terminal-view')).toBeInTheDocument()
        // ActivateCover 已从 inspector 移除——恢复引导由 TerminalView 的重连遮罩承担
        expect(document.querySelector('.activate-cover-mask')).toBeNull()
    })

    it('关闭 terminal tab：清理缓存终端实例（发 terminal:close 杀 PTY + 断 socket）', () => {
        vi.mocked(clearCachedInstance).mockClear()
        useWorkspaceStore.getState().setExpanded('s1', true)
        useWorkspaceStore.getState().openTerminalTab('s1')
        renderWithClient(<InspectorPane sessionId="s1" />)
        const terminalId = useWorkspaceStore
            .getState()
            .getSession('s1').tabs.find((t) => t.mode === 'terminal')!.terminalId
        // 点 terminal tab 的关闭 ×（TabStripTab 的 onClose）触发清理
        fireEvent.click(document.querySelector('[data-tab-close]') as HTMLElement)
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

    it('「+」与右侧 chrome 同处页签条行内，且在 tablist 之外', () => {
        useWorkspaceStore.getState().setExpanded('s1', true)
        useWorkspaceStore.getState().openFileTreeTab('s1')
        renderWithClient(<InspectorPane sessionId="s1" />)
        const list = screen.getByRole('tablist')
        const addBtn = screen.getByRole('button', { name: 'session.inspector.addTab' })
        // extra 槽与页签条同处一行（tablist 被滚动视口包着，故找共同的那一行）：
        // 既与页签同排，又不会被 tab 的键盘/焦点链路牵动
        const row = list.closest('[data-tab-strip-row]')
        expect(row).not.toBeNull()
        expect(list.contains(addBtn)).toBe(false)
        expect(row?.contains(addBtn)).toBe(true)
    })

    it('「+」是页签条附属动作（不在 role=tab 内）：打开菜单后不被 tab 抢焦点而立即关闭', () => {
        useWorkspaceStore.getState().setExpanded('s1', true)
        useWorkspaceStore.getState().openFileTreeTab('s1')
        renderWithClient(<InspectorPane sessionId="s1" />)
        const addBtn = screen.getByRole('button', { name: 'session.inspector.addTab' })
        // 落进 role=tab 就会复发：焦点在 tab 内重开时，portal 的 focusin 沿 React 树冒泡到 tab，
        // 自建件的 tab 把它当自身焦点处理并 focus() 抢回 → Radix 判 focus-outside → 菜单开完即关
        expect(addBtn.closest('[role="tab"]')).toBeNull()
        fireEvent.pointerDown(addBtn, { button: 0 })
        expect(screen.getByText('session.inspector.terminal')).toBeInTheDocument()
    })

    it('关闭非活动 tab：选中不动（× 的点击不冒泡成一次切换）', () => {
        useWorkspaceStore.getState().setExpanded('s1', true)
        useWorkspaceStore.getState().openFileTreeTab('s1')
        useWorkspaceStore.getState().openTerminalTab('s1') // 终端激活
        renderWithClient(<InspectorPane sessionId="s1" />)

        const treeTab = useWorkspaceStore.getState().getSession('s1').tabs.find((t) => t.mode === 'tree')!
        fireEvent.click(screen.getByRole('tab', { name: 'session.inspector.openFile' })) // 切回文件树

        // 页签顺序 [tree, terminal]：第二个 × 是终端的（非活动）
        fireEvent.click(screen.getAllByRole('button', { name: 'session.inspector.closeTab' })[1])

        const s = useWorkspaceStore.getState().getSession('s1')
        expect(s.tabs.some((t) => t.mode === 'terminal')).toBe(false)
        expect(s.activeTabId).toBe(treeTab.id)
    })

    it('keepalive：切走再切回，终端面板是同一个 DOM 节点；切走时被 display:none 隐藏', async () => {
        useWorkspaceStore.getState().setExpanded('s1', true)
        useWorkspaceStore.getState().openFileTreeTab('s1')
        useWorkspaceStore.getState().openTerminalTab('s1')
        renderWithClient(<InspectorPane sessionId="s1" />)

        const tv = await screen.findByTestId('mock-terminal-view')
        fireEvent.click(screen.getByRole('tab', { name: 'session.inspector.openFile' }))
        // 切走不卸载（同一节点），只是藏起来
        expect(screen.getByTestId('mock-terminal-view')).toBe(tv)
        expect(tv.closest('[role="tabpanel"]')).toHaveStyle({ display: 'none' })

        fireEvent.click(screen.getByRole('tab', { name: 'session.inspector.terminalName' }))
        expect(screen.getByTestId('mock-terminal-view')).toBe(tv)
        expect(tv.closest('[role="tabpanel"]')).not.toHaveStyle({ display: 'none' })
    })

    it('关闭最后一个 tab → 收起 inspector', () => {
        useWorkspaceStore.getState().setExpanded('s1', true)
        useWorkspaceStore.getState().openFileTreeTab('s1')
        const { container } = renderWithClient(<InspectorPane sessionId="s1" />)
        // TabStripTab 给出 onClose 即渲染关闭 ×
        const remove = container.querySelector('[data-tab-close]') as HTMLElement
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
        fireEvent.pointerDown(screen.getByRole('button', { name: 'session.inspector.addTab' }), { button: 0 })
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
        fireEvent.pointerDown(screen.getByRole('button', { name: 'session.inspector.addTab' }), { button: 0 })
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
        fireEvent.click(document.querySelector('[data-tab-close]') as HTMLElement)
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
        fireEvent.click(document.querySelector('[data-tab-close]') as HTMLElement)
        const saveBtn = await screen.findByText('files.saveAndClose')
        await fireEvent.click(saveBtn)
        // 成功 → tab 关闭
        await waitFor(() => expect(useWorkspaceStore.getState().getSession('s1').tabs).toHaveLength(0))
    })
})
