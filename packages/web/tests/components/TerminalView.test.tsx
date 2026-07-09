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

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import '@testing-library/jest-dom/vitest'
import { render, screen, cleanup } from '@testing-library/react'
import TerminalView from '@/components/terminal/TerminalView'
import { clearAllInstances } from '@/core/hooks/useCachedInstance'

// mock cachedTerminal：返回可控 status + subscribe
// vi.hoisted 确保 factory 引用的变量在 mock 提升后仍可访问（避免 TDZ）
const { mockCreate, makeInstance } = vi.hoisted(() => {
    const makeInstance = (status = 'connected') => ({
        terminal: { write: vi.fn(), clear: vi.fn(), dispose: vi.fn() },
        fitAddon: { fit: vi.fn(), dispose: vi.fn() },
        domNode: document.createElement('div'),
        status,
        subscribe: vi.fn(() => () => {
            /* 真实 cleanup 只移除 listener，不回调 */
        }),
        reconnect: vi.fn(),
        dispose: vi.fn(),
    })
    const mockCreate = vi.fn(() => makeInstance())
    return { makeInstance, mockCreate }
})
vi.mock('@/components/terminal/cachedTerminal', () => ({
    createCachedTerminal: mockCreate,
    disposeCachedTerminal: vi.fn(),
}))

// jsdom 没有 ResizeObserver（TerminalView fit 监听用）
beforeEach(() => {
    vi.stubGlobal('ResizeObserver', class {
        observe() {}
        unobserve() {}
        disconnect() {}
    })
})
afterEach(() => {
    vi.unstubAllGlobals()
    // 清除 useCachedInstance 模块级缓存，避免用例间实例复用导致 status 错位
    clearAllInstances()
    cleanup()
})

describe('TerminalView', () => {
    it('渲染 terminalId 对应标题（含 sessionId 片段）', () => {
        render(<TerminalView sessionId="s1abcdef" terminalId="t1" />)
        expect(screen.getByText(/s1abcdef/)).toBeInTheDocument()
        // 验证 terminalId 正确接线到 createCachedTerminal
        expect(mockCreate).toHaveBeenCalledWith({ sessionId: 's1abcdef', terminalId: 't1' })
    })

    it('status=error 显示断开提示', () => {
        mockCreate.mockReturnValueOnce(makeInstance('error') as never)
        render(<TerminalView sessionId="s1abcdef" terminalId="t1" />)
        expect(screen.getByText(/断开|Disconnected/i)).toBeInTheDocument()
    })

    it('onNewTerminal 显示「+」按钮；newTerminalDisabled 置灰', () => {
        const onNew = vi.fn()
        const { rerender } = render(
            <TerminalView sessionId="s1" terminalId="t1" onNewTerminal={onNew} />,
        )
        const buttons = screen.getAllByRole('button')
        // 第一个 button 是「+」新建，第二个是「重连」
        expect(buttons.length).toBeGreaterThanOrEqual(2)
        expect(buttons[0]).not.toBeDisabled()
        buttons[0].click()
        expect(onNew).toHaveBeenCalled()
        rerender(
            <TerminalView sessionId="s1" terminalId="t1" onNewTerminal={onNew} newTerminalDisabled />,
        )
        expect(screen.getAllByRole('button')[0]).toBeDisabled()
    })
})
