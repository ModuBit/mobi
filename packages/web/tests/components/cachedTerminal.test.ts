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

import { describe, expect, it, vi, beforeEach } from 'vitest'

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

import { createCachedTerminal } from '@/components/terminal/cachedTerminal'

// helper：触发 cachedTerminal 内部 socket 的事件
function fire(ev: string, ...args: unknown[]) {
    mockSocket._handlers.get(ev)?.forEach((h) => h(...args))
}

describe('cachedTerminal（C-T3 cookie 闭环）', () => {
    beforeEach(() => {
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

    it('terminal:open 使用传入的 terminalId（非硬编码 main）', () => {
        createCachedTerminal({ sessionId: 's1', terminalId: 't-abc' })
        fire('connect') // 触发 cachedTerminal 内部 socket 的 connect handler
        const openCall = mockSocket.emit.mock.calls.find(([ev]: [string]) => ev === 'terminal:open')
        expect(openCall).toBeDefined()
        expect(openCall![1]).toMatchObject({ sessionId: 's1', terminalId: 't-abc' })
    })
})
