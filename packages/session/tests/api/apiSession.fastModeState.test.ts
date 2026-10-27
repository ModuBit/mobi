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
 * apiSession 快速模式执行态上报：
 * - reportFastModeState → socket `fast-mode-state`（result 帧路径）
 * - refreshFastModeState → 活 Query reinitialize 回读后上报（切换后路径）
 */

vi.mock('@mobi/node-core/logger', () => ({
    logger: { warn: vi.fn(), debug: vi.fn(), info: vi.fn(), error: vi.fn() },
}))

vi.mock('@mobi/node-core/configuration', () => ({
    configuration: {
        apiUrl: 'http://127.0.0.1:2222',
        disconnectTimeoutMs: 600_000,
        idleTimeoutMs: 86_400_000,
    },
}))

vi.mock('@mobi/node-core/rpc/RpcHandlerManager', () => ({
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

const mockSocket = vi.hoisted(() => {
    const handlers: Record<string, Array<(payload: unknown) => void>> = {}
    return {
        connected: false,
        connect: vi.fn(),
        disconnect: vi.fn(),
        emit: vi.fn(),
        on: (ev: string, fn: (payload: unknown) => void) => {
            ;(handlers[ev] ??= []).push(fn)
        },
        off: vi.fn(),
        removeAllListeners: () => {
            for (const key of Object.keys(handlers)) delete handlers[key]
        },
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

/** 活 Query 替身：只需能力源用到的方法 */
function makeSource(init: Record<string, unknown>, reinitialize?: () => Promise<unknown>) {
    return {
        initializationResult: vi.fn(async () => init),
        ...(reinitialize ? { reinitialize: vi.fn(reinitialize) } : {}),
        supportedModels: vi.fn(async () => []),
        supportedCommands: vi.fn(async () => []),
        supportedAgents: vi.fn(async () => []),
    }
}

beforeEach(() => {
    mockSocket.emit.mockClear()
})

describe('reportFastModeState', () => {
    it('上报 state + reason 到 fast-mode-state（sid 由通道补）', () => {
        makeClient().reportFastModeState('cooldown', 'extra_usage_disabled')

        expect(mockSocket.emit).toHaveBeenCalledWith('fast-mode-state', {
            sid: 'session-1',
            fastModeState: 'cooldown',
            fastModeDisabledReason: 'extra_usage_disabled',
        })
    })

    it('没有 reason 时不带该字段', () => {
        makeClient().reportFastModeState('on')

        expect(mockSocket.emit).toHaveBeenCalledWith('fast-mode-state', {
            sid: 'session-1',
            fastModeState: 'on',
            fastModeDisabledReason: undefined,
        })
    })
})

describe('refreshFastModeState', () => {
    it('切换后走 reinitialize 读新鲜值（不是 initializationResult 快照）并上报', async () => {
        const client = makeClient()
        const initializationResult = vi.fn(async () => ({ fast_mode_state: 'off' }))
        const reinitialize = vi.fn(async () => ({ fast_mode_state: 'on' }))
        client.installLiveCapabilitySource(() => ({ ...makeSource({}), initializationResult, reinitialize }) as never)

        await client.refreshFastModeState()

        expect(reinitialize).toHaveBeenCalledTimes(1)
        expect(initializationResult).not.toHaveBeenCalled()
        expect(mockSocket.emit).toHaveBeenCalledWith('fast-mode-state', expect.objectContaining({ fastModeState: 'on' }))
    })

    it('没有活 Query 时静默（不抛错、不上报）', async () => {
        await expect(makeClient().refreshFastModeState()).resolves.toBeUndefined()
        expect(mockSocket.emit).not.toHaveBeenCalled()
    })

    it('SDK 未给状态字段 → 不上报（保持上一次权威值）', async () => {
        const client = makeClient()
        client.installLiveCapabilitySource(() => makeSource({}, async () => ({})) as never)

        await client.refreshFastModeState()

        expect(mockSocket.emit).not.toHaveBeenCalled()
    })

    it('reinitialize 失败时吞掉（下一轮 result 会补上）', async () => {
        const client = makeClient()
        client.installLiveCapabilitySource(() => makeSource({}, async () => { throw new Error('query closed') }) as never)

        await expect(client.refreshFastModeState()).resolves.toBeUndefined()
        expect(mockSocket.emit).not.toHaveBeenCalled()
    })
})
