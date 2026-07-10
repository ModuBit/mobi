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

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'

// 单例 mock socket：cachedTerminal 内部 io() 与测试 fire() 操作同一个 socket
type Handler = (...args: unknown[]) => void
function createMockSocket() {
    const handlers = new Map<string, Handler[]>()
    return {
        on: vi.fn((ev: string, h: Handler) => {
            const arr = handlers.get(ev) ?? []
            arr.push(h)
            handlers.set(ev, arr)
        }),
        emit: vi.fn(),
        connect: vi.fn(),
        disconnect: vi.fn(),
        removeAllListeners: vi.fn(),
        connected: false,
        _handlers: handlers,
    }
}
const mockSocket = createMockSocket()
const ioMock = vi.fn()
vi.mock('socket.io-client', () => ({
    io: (...args: unknown[]) => {
        ioMock(...args)
        return mockSocket // 单例：测试 fire 到 cachedTerminal 监听的同一 socket
    },
}))

import { Terminal } from '@xterm/xterm'
import { createCachedTerminal, buildBanner } from '@/components/terminal/cachedTerminal'

// helper：触发 cachedTerminal 内部 socket 的事件
function fire(ev: string, ...args: unknown[]) {
    mockSocket._handlers.get(ev)?.forEach((h) => h(...args))
}

describe('cachedTerminal（C-T3 cookie 闭环）', () => {
    beforeEach(() => {
        vi.stubGlobal('__MOBI_HUB_URL__', 'http://localhost:2222')
        ioMock.mockClear()
        mockSocket._handlers.clear()
        mockSocket.emit.mockClear()
        mockSocket.on.mockClear()
    })

    it('io() 不带 auth.token（同源 httpOnly cookie 自动携带）', () => {
        createCachedTerminal({ sessionId: 'test-session', terminalId: 'main' })

        expect(ioMock).toHaveBeenCalledTimes(1)
        const [, options] = ioMock.mock.calls[0] as [string, Record<string, unknown>]
        expect(options).toBeDefined()
        expect(options).not.toHaveProperty('auth')
        // 其余配置保留
        expect(options.transports).toEqual(['websocket'])
        expect(options.path).toBe('/socket.io')
    })

    it('io() 连接 dev 注入的 Hub /terminal namespace', () => {
        createCachedTerminal({ sessionId: 's1', terminalId: 't1' })
        const [url] = ioMock.mock.calls[0] as [string, unknown]
        expect(url).toBe('http://localhost:2222/terminal')
    })

    it('terminal:create 使用传入的 terminalId（非硬编码 main）', () => {
        createCachedTerminal({ sessionId: 's1', terminalId: 't-abc' })
        fire('connect') // 触发 cachedTerminal 内部 socket 的 connect handler
        const createCall = mockSocket.emit.mock.calls.find(([ev]: [string]) => ev === 'terminal:create')
        expect(createCall).toBeDefined()
        expect(createCall![1]).toMatchObject({ sessionId: 's1', terminalId: 't-abc' })
    })
})

describe('连接状态', () => {
    beforeEach(() => {
        vi.stubGlobal('__MOBI_HUB_URL__', 'http://localhost:2222')
        ioMock.mockClear()
        mockSocket._handlers.clear()
        mockSocket.emit.mockClear()
        mockSocket.on.mockClear()
    })

    it('初始 status 为 connecting；connect 后变 connected', () => {
        const inst = createCachedTerminal({ sessionId: 's1', terminalId: 't1' })
        expect(inst.status).toBe('connecting')
        fire('connect')
        expect(inst.status).toBe('connected')
    })

    it('subscribe 收到 status 变化通知', () => {
        const inst = createCachedTerminal({ sessionId: 's1', terminalId: 't1' })
        const listener = vi.fn()
        const unsub = inst.subscribe(listener)
        fire('connect') // connecting -> connected
        expect(listener).toHaveBeenLastCalledWith('connected')
        unsub()
        listener.mockClear()
        fire('disconnect', 'transport')
        expect(listener).not.toHaveBeenCalled() // 已取消订阅
    })

    it('terminal:error → status=error', () => {
        const inst = createCachedTerminal({ sessionId: 's1', terminalId: 't1' })
        fire('terminal:error', { sessionId: 's1', terminalId: 't1', message: 'boom' })
        expect(inst.status).toBe('error')
    })

    it('terminal:error 无 sessionId（hub 内部 emit）也能触发 error', () => {
        const inst = createCachedTerminal({ sessionId: 's1', terminalId: 't1' })
        fire('terminal:error', { terminalId: 't1', message: 'CLI disconnected.' }) // 无 sessionId
        expect(inst.status).toBe('error')
    })

    it('reconnect_attempt → status=reconnecting', () => {
        const inst = createCachedTerminal({ sessionId: 's1', terminalId: 't1' })
        fire('reconnect_attempt')
        expect(inst.status).toBe('reconnecting')
    })

    it('disconnect → status=reconnecting', () => {
        const inst = createCachedTerminal({ sessionId: 's1', terminalId: 't1' })
        fire('disconnect', 'transport')
        expect(inst.status).toBe('reconnecting')
    })

    it('connect_error → status=error', () => {
        const inst = createCachedTerminal({ sessionId: 's1', terminalId: 't1' })
        fire('connect_error', new Error('x'))
        expect(inst.status).toBe('error')
    })

    it('terminal:ready → status=connected（reconnect 重发 create 后靠 ready 恢复）', () => {
        const inst = createCachedTerminal({ sessionId: 's1', terminalId: 't1' })
        fire('terminal:error', { terminalId: 't1', message: 'CLI disconnected.' })
        expect(inst.status).toBe('error')
        fire('terminal:ready', { sessionId: 's1', terminalId: 't1' })
        expect(inst.status).toBe('connected')
    })
})

describe('reconnect 不 clear', () => {
    beforeEach(() => {
        vi.stubGlobal('__MOBI_HUB_URL__', 'http://localhost:2222')
        ioMock.mockClear()
        mockSocket._handlers.clear()
        mockSocket.emit.mockClear()
        mockSocket.on.mockClear()
        mockSocket.connected = false
        mockSocket.connect.mockClear?.()
    })

    it('reconnect() 断线态：不 clear、写分隔横幅、主动 socket.connect()', () => {
        const inst = createCachedTerminal({ sessionId: 's1', terminalId: 't1' })
        const clearSpy = vi.spyOn(inst.terminal, 'clear')
        const writeSpy = vi.spyOn(inst.terminal, 'write')
        fire('connect') // 先连上（isOpen=true）
        fire('disconnect', 'transport') // 断线 → reconnecting 态
        clearSpy.mockClear()
        writeSpy.mockClear()
        inst.reconnect()
        expect(clearSpy).not.toHaveBeenCalled()
        expect(writeSpy).toHaveBeenCalledWith(expect.stringContaining('reconnected'))
        expect(mockSocket.connect).toHaveBeenCalled()
    })

    it('reconnect() socket 连着但终端 error：重发 terminal:create 重新打开', () => {
        const inst = createCachedTerminal({ sessionId: 's1', terminalId: 't1' })
        const writeSpy = vi.spyOn(inst.terminal, 'write')
        fire('connect')
        mockSocket.connected = true // socket 连着（如 CLI 断开导致 error）
        mockSocket.emit.mockClear()
        writeSpy.mockClear()
        inst.reconnect()
        // 重发 create（hub 同 socket 重注册允许，CLI 复用旧 PTY）
        const createCall = mockSocket.emit.mock.calls.find(([ev]: [string]) => ev === 'terminal:create')
        expect(createCall).toBeDefined()
        expect(writeSpy).toHaveBeenCalledWith(expect.stringContaining('reconnected'))
        // socket 连着，不主动 socket.connect()
        expect(mockSocket.connect).not.toHaveBeenCalled()
    })
})

describe('欢迎横幅 banner', () => {
    beforeEach(() => {
        vi.stubGlobal('__MOBI_HUB_URL__', 'http://localhost:2222')
        ioMock.mockClear()
        mockSocket._handlers.clear()
        mockSocket.emit.mockClear()
    })

    it('buildBanner：含 ASCII art + version + cwd + git 分支', () => {
        const banner = buildBanner({ version: '0.1.0', cwd: '/proj', gitBranch: 'main' })
        expect(banner).toContain('╰─╯') // art
        expect(banner).toContain('0.1.0')
        expect(banner).toContain('/proj')
        expect(banner).toContain('(git:main)')
    })

    it('buildBanner：无 version 不含版本行；无 gitBranch 不含分支', () => {
        const banner = buildBanner({ cwd: '/proj' })
        expect(banner).toContain('/proj')
        expect(banner).not.toContain('MOBI -')
        expect(banner).not.toContain('git:')
    })

    it('showBanner：cwd 未就绪跳过 → 就绪后写一次 → 重复 no-op', () => {
        const writeSpy = vi.spyOn(Terminal.prototype, 'write')
        const inst = createCachedTerminal({ sessionId: 's1', terminalId: 't1' })
        writeSpy.mockClear()
        // cwd 未就绪 → 跳过（等 TerminalView 拿到 session.metadata）
        inst.showBanner({ version: '0.1.0' })
        expect(writeSpy).not.toHaveBeenCalled()
        // cwd 就绪 → 写入
        inst.showBanner({ version: '0.1.0', cwd: '/proj', gitBranch: 'main' })
        expect(writeSpy).toHaveBeenCalledWith(expect.stringContaining('/proj'))
        // 重复调用 → no-op（跨 tab 切换/重连不重复 banner）
        writeSpy.mockClear()
        inst.showBanner({ cwd: '/proj' })
        expect(writeSpy).not.toHaveBeenCalled()
        writeSpy.mockRestore()
    })
})

describe('主题切换 setTheme', () => {
    beforeEach(() => {
        vi.stubGlobal('__MOBI_HUB_URL__', 'http://localhost:2222')
        ioMock.mockClear()
        mockSocket._handlers.clear()
        mockSocket.emit.mockClear()
    })

    it('setTheme(light)：terminal.options.theme + domNode 背景同步为亮色', () => {
        const inst = createCachedTerminal({ sessionId: 's1', terminalId: 't1' })
        inst.setTheme('light')
        expect(inst.terminal.options.theme).toMatchObject({ background: '#faf9f5', foreground: '#141413' })
        // jsdom 把 hex 转成 rgb
        expect(inst.domNode.style.background).toBe('rgb(250, 249, 245)')
    })

    it('setTheme(dark)：恢复暗色调色板', () => {
        const inst = createCachedTerminal({ sessionId: 's1', terminalId: 't1' })
        inst.setTheme('light')
        inst.setTheme('dark')
        expect(inst.terminal.options.theme).toMatchObject({ background: '#1e1e1e', foreground: '#d4d4d4' })
        expect(inst.domNode.style.background).toBe('rgb(30, 30, 30)')
    })
})

describe('移动端触屏滚动', () => {
    beforeEach(() => {
        vi.stubGlobal('__MOBI_HUB_URL__', 'http://localhost:2222')
        ioMock.mockClear()
        mockSocket._handlers.clear()
        mockSocket.emit.mockClear()
    })
    afterEach(() => {
        vi.unstubAllGlobals()
    })

    /** 构造 touch 事件（用 Event + touches 属性，绕过 jsdom 无 Touch 构造） */
    function touch(type: string, y: number): Event {
        const ev = new Event(type, { bubbles: true, cancelable: true })
        Object.defineProperty(ev, 'touches', {
            value: [{ clientY: y, identifier: 0 }],
            configurable: true,
        })
        return ev
    }

    it('上滑累积到一行高度 → scrollLines（正值，看更新内容）', () => {
        const inst = createCachedTerminal({ sessionId: 's1', terminalId: 't1' })
        Object.defineProperty(inst.terminal.buffer.active, 'length', { get: () => 100, configurable: true })
        const scrollSpy = vi.spyOn(inst.terminal, 'scrollLines')
        // touchstart 设起点 Y=200
        inst.domNode.dispatchEvent(touch('touchstart', 200))
        // 上滑 36px = 2 行（ROW_PX=18）
        inst.domNode.dispatchEvent(touch('touchmove', 164))
        expect(scrollSpy).toHaveBeenCalledWith(2)
    })

    it('位移不足一行不滚动；后续累积达一行再滚', () => {
        const inst = createCachedTerminal({ sessionId: 's1', terminalId: 't1' })
        Object.defineProperty(inst.terminal.buffer.active, 'length', { get: () => 100, configurable: true })
        const scrollSpy = vi.spyOn(inst.terminal, 'scrollLines')
        inst.domNode.dispatchEvent(touch('touchstart', 200))
        inst.domNode.dispatchEvent(touch('touchmove', 190)) // 仅 10px < 18 → 不滚
        expect(scrollSpy).not.toHaveBeenCalled()
        inst.domNode.dispatchEvent(touch('touchmove', 172)) // 累计 28px → 1 行（余 10）
        expect(scrollSpy).toHaveBeenCalledWith(1)
    })

    it('下滑为负值（看更早历史）', () => {
        const inst = createCachedTerminal({ sessionId: 's1', terminalId: 't1' })
        Object.defineProperty(inst.terminal.buffer.active, 'length', { get: () => 100, configurable: true })
        const scrollSpy = vi.spyOn(inst.terminal, 'scrollLines')
        inst.domNode.dispatchEvent(touch('touchstart', 100))
        inst.domNode.dispatchEvent(touch('touchmove', 136)) // 下滑 36px → -2
        expect(scrollSpy).toHaveBeenCalledWith(-2)
    })
})

describe('send（虚拟按键发送字节）', () => {
    beforeEach(() => {
        vi.stubGlobal('__MOBI_HUB_URL__', 'http://localhost:2222')
        ioMock.mockClear()
        mockSocket._handlers.clear()
        mockSocket.emit.mockClear()
        mockSocket.connected = false
    })

    it('未连接（isOpen=false）不 emit', () => {
        const inst = createCachedTerminal({ sessionId: 's1', terminalId: 't1' })
        inst.send('\x03')
        expect(mockSocket.emit).not.toHaveBeenCalled()
    })

    it('连接后 send → emit terminal:write 带原始字节', () => {
        const inst = createCachedTerminal({ sessionId: 's1', terminalId: 't1' })
        mockSocket.connected = true // mock connect 不自动置 connected
        fire('connect') // isOpen=true
        mockSocket.emit.mockClear()
        inst.send('\x03')
        expect(mockSocket.emit).toHaveBeenCalledWith('terminal:write', {
            sessionId: 's1',
            terminalId: 't1',
            data: '\x03',
        })
    })
})
