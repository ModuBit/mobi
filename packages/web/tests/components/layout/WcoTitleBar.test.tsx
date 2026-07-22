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

import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { ConfigProvider } from 'antd'

// 可控 uiStore mock state —— 直接修改对象即可驱动组件重渲（配合 key 强制 remount）
const mockState = {
    theme: 'light' as 'light' | 'dark' | 'system',
    sidebarExpanded: true,
    toggleSidebar: vi.fn(),
}

vi.mock('@/core/data/stores/uiStore', () => ({
    useUiStore: (selector: (s: typeof mockState) => unknown) => selector(mockState),
    // resolveTheme: 'system' 解析为亮色（测试默认亮色场景）
    resolveTheme: (t: string) => (t === 'system' ? 'light' : t),
}))

// router navigate mock（Logo 点击跳转会触发 useNavigate）
const mockNavigate = vi.fn()
vi.mock('@tanstack/react-router', () => ({
    useNavigate: () => mockNavigate,
}))

import { WcoTitleBar } from '@/components/layout/WcoTitleBar'

function renderFresh(side: 'mac' | 'win') {
    // 用 key 强制每次全新挂载，读取最新 mockState
    return render(
        <ConfigProvider>
            <WcoTitleBar key={Math.random()} side={side} />
        </ConfigProvider>,
    )
}

describe('WcoTitleBar', () => {
    afterEach(() => {
        cleanup()
        mockState.sidebarExpanded = true
        vi.clearAllMocks()
    })

    it('渲染 Logo + 收起按钮', () => {
        renderFresh('mac')
        expect(screen.getByRole('button', { name: 'Mobi' })).toBeInTheDocument()
        expect(screen.getByRole('button', { name: '收起侧边栏' })).toBeInTheDocument()
    })

    it('展开态 → 收起按钮 aria-label 为"收起侧边栏"', () => {
        mockState.sidebarExpanded = true
        renderFresh('mac')
        expect(screen.getByRole('button', { name: '收起侧边栏' })).toBeInTheDocument()
    })

    it('收起态 → 按钮切换为"展开侧边栏"', () => {
        mockState.sidebarExpanded = false
        renderFresh('mac')
        expect(screen.getByRole('button', { name: '展开侧边栏' })).toBeInTheDocument()
    })

    it('点击收起按钮 → 调用 toggleSidebar', () => {
        mockState.sidebarExpanded = true
        renderFresh('mac')
        fireEvent.click(screen.getByRole('button', { name: '收起侧边栏' }))
        expect(mockState.toggleSidebar).toHaveBeenCalledOnce()
    })

    it('点击 Logo → navigate 到新会话', () => {
        renderFresh('mac')
        fireEvent.click(screen.getByRole('button', { name: 'Mobi' }))
        expect(mockNavigate).toHaveBeenCalledWith({
            to: '/sessions/new',
            search: { cwd: undefined },
        })
    })

    it('side=mac → 根元素含 mac class', () => {
        const { container } = renderFresh('mac')
        expect(container.firstChild).toHaveClass('wco-titlebar-mac')
    })

    it('side=win → 根元素含 win class', () => {
        const { container } = renderFresh('win')
        expect(container.firstChild).toHaveClass('wco-titlebar-win')
    })
})
