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

/**
 * apiSession 断开重连兜底与观测（2026-08-17 会话莫名退出调查结论的修复）：
 * - disconnect reason 落盘 WARN（debug 不落盘，hub 重启后会话退出曾因此无连接侧证据）
 * - connect_error 节流落盘（重连循环每 1-5s 一条，60s 窗口只记首条）
 * - 服务端主动断开（'io server disconnect'）socket.io v4 不自动重连 → 手动 connect() 兜底（指数退避）
 * - transport 层断开 / 客户端主动断开 → 不兜底（前者走内置重连，后者是退出路径）
 */

const warnMock = vi.hoisted(() => vi.fn())
const debugMock = vi.hoisted(() => vi.fn())
vi.mock('@/ui/logger', () => ({
    logger: { warn: warnMock, debug: debugMock, info: vi.fn(), error: vi.fn() },
}))

vi.mock('@/configuration', () => ({
    configuration: {
        apiUrl: 'http://127.0.0.1:2222',
        disconnectTimeoutMs: 600_000,
        idleTimeoutMs: 86_400_000,
        timeoutWarningMs: 300_000,
    },
}))

vi.mock('@/api/rpc/RpcHandlerManager', () => ({
    RpcHandlerManager: class {
        setOnRpcCalled = vi.fn()
        onSocketConnect = vi.fn()
        onSocketDisconnect = vi.fn()
        handleRequest = vi.fn(async () => ({}))
    },
}))

vi.mock('@/terminal/TerminalManager', () => ({
    TerminalManager: class {
        closeAll = vi.fn()
    },
}))

// socket.io-client mock：极简 emitter（vi.hoisted 先于 import 执行，不能用 node:events）+ connect/disconnect spy
const connectSpy = vi.hoisted(() => vi.fn())
const mockSocket = vi.hoisted(() => {
    const handlers: Record<string, Array<(payload: unknown) => void>> = {}
    return {
        connected: false,
        connect: connectSpy,
        disconnect: vi.fn(),
        emit: vi.fn(),
        on: (ev: string, fn: (payload: unknown) => void) => {
            ;(handlers[ev] ??= []).push(fn)
        },
        off: vi.fn(),
        removeAllListeners: () => {
            for (const key of Object.keys(handlers)) delete handlers[key]
        },
        // 测试侧触发服务端事件（disconnect / connect / connect_error）
        fire: (ev: string, ...args: unknown[]) => {
            for (const fn of handlers[ev] ?? []) fn(...args)
        },
    }
})
vi.mock('socket.io-client', () => ({ io: vi.fn(() => mockSocket) }))

import { ApiSessionClient } from '@/api/apiSession'

function makeClient(): ApiSessionClient {
    return new ApiSessionClient('token', {
        id: 'session-1',
        metadata: null,
        metadataVersion: 0,
        agentState: null,
        agentStateVersion: 0,
    } as never)
}

beforeEach(() => {
    vi.useFakeTimers()
    mockSocket.removeAllListeners()
    connectSpy.mockClear()
    warnMock.mockClear()
})

afterEach(() => {
    vi.useRealTimers()
})

describe('断开 reason 观测（落盘 WARN）', () => {
    it('disconnect 携带 reason 落盘 WARN——hub 重启后会话退出的定位证据', () => {
        makeClient()
        mockSocket.fire('disconnect', 'transport close')
        expect(warnMock).toHaveBeenCalled()
        const recorded = warnMock.mock.calls.map((c) => c.join(' ')).join('\n')
        expect(recorded).toContain('transport close')
    })

    it('connect_error 节流落盘：60s 窗口内只记首条，窗口过后再记', () => {
        makeClient()
        mockSocket.fire('connect_error', new Error('xhr poll error'))
        mockSocket.fire('connect_error', new Error('websocket error'))
        mockSocket.fire('connect_error', new Error('Invalid token'))
        expect(warnMock.mock.calls.filter((c) => String(c[0]).includes('connection error'))).toHaveLength(1)

        vi.advanceTimersByTime(61_000)
        mockSocket.fire('connect_error', new Error('Invalid token'))
        expect(warnMock.mock.calls.filter((c) => String(c[0]).includes('connection error'))).toHaveLength(2)
    })
})

describe('服务端主动断开的手动重连兜底', () => {
    it("'io server disconnect' → 初始退避 1s 后手动 connect（socket.io v4 对该 reason 不自动重连）", () => {
        makeClient()
        expect(connectSpy).toHaveBeenCalledTimes(1) // 构造尾部首次 connect

        mockSocket.fire('disconnect', 'io server disconnect')
        expect(connectSpy).toHaveBeenCalledTimes(1) // 未到退避时间，不立即连

        vi.advanceTimersByTime(1_000)
        expect(connectSpy).toHaveBeenCalledTimes(2) // 兜底重连
    })

    it('兜底重连指数退避：连续服务端断开翻倍（1s → 2s）', () => {
        makeClient()
        mockSocket.fire('disconnect', 'io server disconnect')
        vi.advanceTimersByTime(1_000)
        expect(connectSpy).toHaveBeenCalledTimes(2)

        // 第二次服务端断开：退避翻倍到 2s，1s 时不应重连
        mockSocket.fire('disconnect', 'io server disconnect')
        vi.advanceTimersByTime(1_000)
        expect(connectSpy).toHaveBeenCalledTimes(2)
        vi.advanceTimersByTime(1_000)
        expect(connectSpy).toHaveBeenCalledTimes(3)
    })

    it('connect 成功后退避复位（再次服务端断开回到 1s）并清兜底定时器', () => {
        makeClient()
        mockSocket.fire('disconnect', 'io server disconnect')
        vi.advanceTimersByTime(1_000)
        expect(connectSpy).toHaveBeenCalledTimes(2)

        // 兜底重连成功
        mockSocket.connected = true
        mockSocket.fire('connect')
        mockSocket.connected = false

        mockSocket.fire('disconnect', 'io server disconnect')
        vi.advanceTimersByTime(1_000)
        expect(connectSpy).toHaveBeenCalledTimes(3) // 1s 即触发（退避已复位）
    })

    it("'transport close' / 'transport error' → 不手动兜底（交给 socket.io 内置自动重连）", () => {
        makeClient()
        mockSocket.fire('disconnect', 'transport close')
        mockSocket.fire('disconnect', 'transport error')
        vi.advanceTimersByTime(60_000)
        expect(connectSpy).toHaveBeenCalledTimes(1)
    })

    it("'io client disconnect'（本进程主动断开，退出路径）→ 不兜底，进程可退出", () => {
        makeClient()
        mockSocket.fire('disconnect', 'io client disconnect')
        vi.advanceTimersByTime(60_000)
        expect(connectSpy).toHaveBeenCalledTimes(1)
    })
})

describe('断开计时器联动（现有行为回归锁）', () => {
    it('disconnect 触发 IdleTimer.onDisconnect；重连成功触发 onReconnect（清 10 分钟断开超时）', () => {
        makeClient()
        // disconnectTimeoutMs mock 为 600s：断开后 599s 不退出，connect 后计时器清除
        mockSocket.fire('disconnect', 'io server disconnect')

        // 先手动兜底连上（1s 退避）
        vi.advanceTimersByTime(1_000)
        mockSocket.connected = true
        mockSocket.fire('connect')
        // 连上后即使再过 10 分钟也不应触发 disconnect-timeout
        vi.advanceTimersByTime(600_000)
        const clientEvents = warnMock.mock.calls.map((c) => String(c[0]))
        expect(clientEvents).not.toContain('[API] Disconnect timeout, exiting')
    })
})
