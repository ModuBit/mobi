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

import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * SessionTransport（深化候选③票①）的测试面 = 它自己的接口：连接生命周期回调、
 * 兜底重连退避、ack 发送咽喉、心跳。socket.io-client 全 mock——传输语义不需要真连接。
 */

const warnMock = vi.hoisted(() => vi.fn())
vi.mock('@mobi/node-core/logger', () => ({
    logger: { warn: warnMock, debug: vi.fn(), info: vi.fn(), error: vi.fn() },
}))

vi.mock('@mobi/node-core/configuration', () => ({
    configuration: { apiUrl: 'http://127.0.0.1:2222' },
}))

const connectSpy = vi.hoisted(() => vi.fn())
const mockSocket = vi.hoisted(() => {
    const handlers: Record<string, Array<(payload: unknown) => void>> = {}
    return {
        connected: false,
        connect: connectSpy,
        disconnect: vi.fn(),
        emit: vi.fn(),
        volatile: { emit: vi.fn() },
        timeout: vi.fn(() => ({
            emitWithAck: vi.fn(async () => 'ack'),
            emit: vi.fn(),
        })),
        on: (ev: string, fn: (payload: unknown) => void) => {
            ;(handlers[ev] ??= []).push(fn)
        },
        off: vi.fn(),
        fire: (ev: string, ...args: unknown[]) => {
            for (const fn of handlers[ev] ?? []) fn(...args)
        },
        removeAllListeners: () => {
            for (const key of Object.keys(handlers)) delete handlers[key]
        },
    }
})
vi.mock('socket.io-client', () => ({ io: vi.fn(() => mockSocket) }))

import { SessionTransport } from '@/api/sessionTransport'

type Callbacks = Parameters<typeof SessionTransport.prototype.constructor>[2]

function makeTransport(overrides: Partial<Callbacks> = {}) {
    const callbacks: Callbacks = {
        onConnected: vi.fn(),
        onDisconnected: vi.fn(),
        onRpcRequest: vi.fn(async () => ({ ok: true })),
        onSessionUpdate: vi.fn(),
        ...overrides,
    }
    return { transport: new SessionTransport('token', 'session-1', callbacks), callbacks }
}

beforeEach(() => {
    vi.useFakeTimers()
    mockSocket.removeAllListeners()
    connectSpy.mockClear()
    warnMock.mockClear()
})

describe('SessionTransport：连接生命周期', () => {
    it('connect 回调携带 first 标记（首连 true，重连 false）', () => {
        const { callbacks } = makeTransport()
        expect(connectSpy).toHaveBeenCalledTimes(1) // 构造尾部主动建连

        mockSocket.fire('connect')
        expect(callbacks.onConnected).toHaveBeenCalledWith({ first: true })

        mockSocket.fire('connect')
        expect(callbacks.onConnected).toHaveBeenLastCalledWith({ first: false })
    })

    it('disconnect / connect_error 均通知协议层（传输层已自理重连）', () => {
        const { callbacks } = makeTransport()
        mockSocket.fire('disconnect', 'transport close')
        expect(callbacks.onDisconnected).toHaveBeenCalledWith('transport close')

        mockSocket.fire('connect_error', new Error('xhr poll error'))
        expect(callbacks.onDisconnected).toHaveBeenCalledWith('connect_error')
    })

    it('rpc-request：回调返回值作为回执送回', async () => {
        const { callbacks } = makeTransport()
        const ack = vi.fn()
        mockSocket.fire('rpc-request', { method: 'refreshMetadata', params: { cwd: '/p' } }, ack)
        await vi.waitFor(() => expect(ack).toHaveBeenCalledWith({ ok: true }))
        expect(callbacks.onRpcRequest).toHaveBeenCalledWith({ method: 'refreshMetadata', params: { cwd: '/p' } })
    })
})

describe('SessionTransport：服务端主动断开的兜底重连（loopback 收紧口径 0.5s 起步）', () => {
    it("'io server disconnect' → 0.5s 后手动 connect", () => {
        makeTransport()
        mockSocket.fire('disconnect', 'io server disconnect')
        expect(connectSpy).toHaveBeenCalledTimes(1)

        vi.advanceTimersByTime(500)
        expect(connectSpy).toHaveBeenCalledTimes(2)
    })

    it('退避封顶 5s（连续服务端断开 0.5 → 1 → 2 → 4 → 5）', () => {
        makeTransport()
        const fireAndAdvance = (ms: number) => {
            mockSocket.fire('disconnect', 'io server disconnect')
            vi.advanceTimersByTime(ms)
        }
        fireAndAdvance(500)  // 第 1 次 0.5s
        fireAndAdvance(1_000) // 第 2 次 1s
        fireAndAdvance(2_000) // 第 3 次 2s
        fireAndAdvance(4_000) // 第 4 次 4s
        expect(connectSpy).toHaveBeenCalledTimes(5)

        fireAndAdvance(5_000) // 第 5 次封顶 5s，不再是 8s
        expect(connectSpy).toHaveBeenCalledTimes(6)
    })

    it("'io client disconnect'（退出路径）不兜底", () => {
        makeTransport()
        mockSocket.fire('disconnect', 'io client disconnect')
        vi.advanceTimersByTime(60_000)
        expect(connectSpy).toHaveBeenCalledTimes(1)
    })

    it('disconnect() 清兜底定时器（close 后定时器不再触发 connect）', () => {
        const { transport } = makeTransport()
        mockSocket.fire('disconnect', 'io server disconnect')
        transport.disconnect()
        vi.advanceTimersByTime(60_000)
        expect(connectSpy).toHaveBeenCalledTimes(1)
    })
})

describe('SessionTransport：发送与保活', () => {
    it('keepAlive 走 volatile emit 并携带 runtime 字段', () => {
        const { transport } = makeTransport()
        transport.keepAlive('session-1', true, 'local', { permissionMode: 'bypassPermissions' })
        expect(mockSocket.volatile.emit).toHaveBeenCalledWith(
            'session-alive',
            expect.objectContaining({ sid: 'session-1', running: true, mode: 'local', permissionMode: 'bypassPermissions' }),
        )
    })

    it('emitWithAck 走统一超时咽喉', async () => {
        const { transport } = makeTransport()
        await expect(transport.emitWithAck('ping', {}, 1_000)).resolves.toBe('ack')
        expect(mockSocket.timeout).toHaveBeenCalledWith(1_000)
    })

    it('ping 超时返回 false 不抛', async () => {
        const { transport } = makeTransport()
        mockSocket.timeout.mockImplementationOnce(() => ({
            emitWithAck: vi.fn(async () => { throw new Error('timeout') }),
        }))
        await expect(transport.ping(1_000)).resolves.toBe(false)
    })
})
