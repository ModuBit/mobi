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
        terminal: { write: vi.fn(), clear: vi.fn(), dispose: vi.fn(), focus: vi.fn() },
        fitAddon: { fit: vi.fn(), dispose: vi.fn() },
        domNode: document.createElement('div'),
        status,
        subscribe: vi.fn(() => () => {
            /* 真实 cleanup 只移除 listener，不回调 */
        }),
        reconnect: vi.fn(),
        showBanner: vi.fn(),
        setTheme: vi.fn(),
        send: vi.fn(),
        setActive: vi.fn(),
        dispose: vi.fn(),
    })
    const mockCreate = vi.fn(() => makeInstance())
    return { makeInstance, mockCreate }
})
vi.mock('@/components/terminal/cachedTerminal', () => ({
    createCachedTerminal: mockCreate,
    disposeCachedTerminal: vi.fn(),
}))

// mock useSession：banner 依赖 session.metadata（version/path/gitBranch）
const useSessionMock = vi.hoisted(() => vi.fn())
vi.mock('@/core/data/hooks/queries/useSession', () => ({
    useSession: (id: string) => useSessionMock(id),
}))

// mock useIsDark：终端主题跟随 web
const useIsDarkMock = vi.hoisted(() => vi.fn())
vi.mock('@/core/data/hooks/useIsDark', () => ({
    useIsDark: () => useIsDarkMock(),
}))

// mock useIsMobile：移动端虚拟键条
const useIsMobileMock = vi.hoisted(() => vi.fn())
vi.mock('@/core/data/hooks/useMediaQuery', () => ({
    useIsMobile: () => useIsMobileMock(),
}))

// jsdom 没有 ResizeObserver（TerminalView fit 监听用）
beforeEach(() => {
    vi.stubGlobal('ResizeObserver', class {
        observe() {}
        unobserve() {}
        disconnect() {}
    })
    // 每个用例重置 mock：清调用记录 + once 队列，重设默认返回（connected）
    mockCreate.mockReset()
    mockCreate.mockReturnValue(makeInstance())
    useSessionMock.mockReset()
    useSessionMock.mockReturnValue({ data: null })
    useIsDarkMock.mockReset()
    useIsDarkMock.mockReturnValue(true)
    useIsMobileMock.mockReset()
    useIsMobileMock.mockReturnValue(false)
})
afterEach(() => {
    vi.unstubAllGlobals()
    // 清除 useCachedInstance 模块级缓存，避免用例间实例复用导致 status 错位
    clearAllInstances()
    cleanup()
})

describe('TerminalView', () => {
    it('terminalId 正确接线到 createCachedTerminal', () => {
        render(<TerminalView sessionId="s1abcdef" terminalId="t1" />)
        expect(mockCreate).toHaveBeenCalledWith(expect.objectContaining({ sessionId: 's1abcdef', terminalId: 't1' }))
    })

    it('connected 不渲染重连遮罩（无按钮）', () => {
        render(<TerminalView sessionId="s1" terminalId="t1" />)
        expect(screen.queryByRole('button')).not.toBeInTheDocument()
    })

    it('status=error 渲染重连遮罩，点击调用 reconnect', () => {
        const inst = makeInstance('error')
        mockCreate.mockReturnValueOnce(inst)
        render(<TerminalView sessionId="s1" terminalId="t1" />)
        const btn = screen.getByRole('button')
        expect(btn).toBeInTheDocument()
        btn.click()
        expect(inst.reconnect).toHaveBeenCalled()
    })

    it('status=reconnecting 渲染重连遮罩', () => {
        mockCreate.mockReturnValueOnce(makeInstance('reconnecting'))
        render(<TerminalView sessionId="s1" terminalId="t1" />)
        expect(screen.getByRole('button')).toBeInTheDocument()
    })

    it('attach 后 focus 终端（新建即可直接输入）', () => {
        const inst = makeInstance()
        mockCreate.mockReturnValueOnce(inst)
        render(<TerminalView sessionId="s1" terminalId="t1" />)
        expect(inst.terminal.focus).toHaveBeenCalled()
    })

    it('metadata 就绪后调 showBanner（version=0.1.0 / cwd / gitBranch）', () => {
        const inst = makeInstance()
        mockCreate.mockReturnValueOnce(inst)
        // 用 mockReturnValue 稳定返回（useCachedInstance 异步建 instance 期间会多次 render → 多次调 useSession）
        useSessionMock.mockReturnValue({
            data: { metadata: { version: '0.1.0', path: '/home/me/proj', gitBranch: 'main' } },
        })
        render(<TerminalView sessionId="s1" terminalId="t1" />)
        expect(inst.showBanner).toHaveBeenCalledWith({
            version: '0.1.0',
            cwd: '/home/me/proj',
            gitBranch: 'main',
        })
    })

    it('metadata 未就绪（无 path）传 cwd=undefined', () => {
        const inst = makeInstance()
        mockCreate.mockReturnValueOnce(inst)
        useSessionMock.mockReturnValue({
            data: { metadata: { version: '0.1.0' } },
        })
        render(<TerminalView sessionId="s1" terminalId="t1" />)
        // showBanner 仍被调用，但 cwd=undefined；cachedTerminal 内部跳过等就绪
        expect(inst.showBanner).toHaveBeenCalledWith({
            version: '0.1.0',
            cwd: undefined,
            gitBranch: undefined,
        })
    })

    it('主题跟随 web：isDark=true → setTheme dark，false → light', () => {
        const inst = makeInstance()
        mockCreate.mockReturnValueOnce(inst)
        useIsDarkMock.mockReturnValue(true)
        const { rerender } = render(<TerminalView sessionId="s1" terminalId="t1" />)
        expect(inst.setTheme).toHaveBeenCalledWith('dark')

        useIsDarkMock.mockReturnValue(false)
        rerender(<TerminalView sessionId="s1" terminalId="t1" />)
        expect(inst.setTheme).toHaveBeenCalledWith('light')
    })

    it('移动端渲染虚拟键条，点击按键 → instance.send', () => {
        const inst = makeInstance()
        mockCreate.mockReturnValueOnce(inst)
        useIsMobileMock.mockReturnValue(true)
        render(<TerminalView sessionId="s1" terminalId="t1" />)
        // 默认预设含 Ctrl+C（\x03）
        screen.getByText('Ctrl+C').click()
        expect(inst.send).toHaveBeenCalledWith('\x03')
    })

    it('ResizeObserver 用 rAF 合并 fit（一帧内多次 resize 只 fit 一次）', () => {        const inst = makeInstance()
        mockCreate.mockReturnValueOnce(inst)
        // 可捕获 callback 的 RO + 记录型 rAF（不立即执行，手动 flush）
        let roCb: (() => void) | null = null
        let scheduled: (() => void) | null = null
        vi.stubGlobal('ResizeObserver', class {
            constructor(cb: () => void) {
                roCb = cb
            }
            observe() {}
            unobserve() {}
            disconnect() {}
        })
        vi.stubGlobal('requestAnimationFrame', (cb: () => void) => {
            scheduled = scheduled ?? cb
            return 1
        })
        vi.stubGlobal('cancelAnimationFrame', () => {})
        render(<TerminalView sessionId="s1" terminalId="t1" />)
        inst.fitAddon.fit.mockClear()
        // jsdom 无布局，stub 容器尺寸使宽度检查通过
        const container = inst.domNode.parentElement!
        Object.defineProperty(container, 'clientWidth', { get: () => 100, configurable: true })
        Object.defineProperty(container, 'clientHeight', { get: () => 100, configurable: true })
        // 同一帧内连续 3 次 resize → 只调度 1 个 rAF
        roCb!()
        roCb!()
        roCb!()
        expect(inst.fitAddon.fit).not.toHaveBeenCalled()
        // flush 该帧 → fit 一次
        scheduled!()
        expect(inst.fitAddon.fit).toHaveBeenCalledTimes(1)
    })

    it('session 离线（active=false）→ factory 传 initialActive=false + setActive(false)', () => {
        const inst = makeInstance()
        mockCreate.mockReturnValueOnce(inst)
        useSessionMock.mockReturnValue({ data: { active: false } })
        render(<TerminalView sessionId="s1" terminalId="t1" />)
        expect(mockCreate).toHaveBeenCalledWith(expect.objectContaining({ initialActive: false }))
        expect(inst.setActive).toHaveBeenCalledWith(false)
    })

    it('session 在线（active=true）→ initialActive=true + setActive(true)', () => {
        const inst = makeInstance()
        mockCreate.mockReturnValueOnce(inst)
        useSessionMock.mockReturnValue({ data: { active: true } })
        render(<TerminalView sessionId="s1" terminalId="t1" />)
        expect(mockCreate).toHaveBeenCalledWith(expect.objectContaining({ initialActive: true }))
        expect(inst.setActive).toHaveBeenCalledWith(true)
    })
})
