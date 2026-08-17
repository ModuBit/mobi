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
 * apiSession 消息 native_id 双写与绑定上报：
 * - sendClaudeSessionMessage 的 message 事件 payload 携带 nativeId（与 localId 同值，均为 SDK 消息 uuid）
 * - emitMessagesBound 上报用户消息的 localId→nativeId 绑定（空数组不 emit）
 */

vi.mock('@/ui/logger', () => ({
    logger: { warn: vi.fn(), debug: vi.fn(), info: vi.fn(), error: vi.fn() },
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

// socket.io-client mock：极简 emitter（vi.hoisted 先于 import 执行，不能用 node:events）+ emit spy
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

beforeEach(() => {
    mockSocket.emit.mockClear()
})

describe('sendClaudeSessionMessage 携带 nativeId', () => {
    it('body 带 uuid 时 message 事件 payload 的 nativeId 与 localId 同值', () => {
        const client = makeClient()
        client.sendClaudeSessionMessage({
            type: 'assistant',
            uuid: 'sdk-uuid-1',
            message: { content: [] },
        } as never)

        expect(mockSocket.emit).toHaveBeenCalledWith('message', expect.objectContaining({
            sid: 'session-1',
            localId: 'sdk-uuid-1',
            nativeId: 'sdk-uuid-1',
        }))
    })

    it('body 不带 uuid 时 message 事件 payload 的 nativeId 与 localId 均不带真值', () => {
        const client = makeClient()
        client.sendClaudeSessionMessage({
            type: 'assistant',
            message: {},
        } as never)

        expect(mockSocket.emit).toHaveBeenCalledWith('message', expect.objectContaining({
            sid: 'session-1',
            localId: undefined,
            nativeId: undefined,
        }))
    })
})

describe('emitMessagesBound 绑定上报', () => {
    it('空数组不 emit', () => {
        const client = makeClient()
        client.emitMessagesBound([])
        expect(mockSocket.emit).not.toHaveBeenCalled()
    })

    it('非空数组 emit messages-bound 事件，payload 带 sid 与 bindings', () => {
        const client = makeClient()
        const bindings = [
            { localId: 'local-1', nativeId: 'native-1' },
            { localId: 'local-2', nativeId: 'native-1' },
        ]
        client.emitMessagesBound(bindings)

        expect(mockSocket.emit).toHaveBeenCalledTimes(1)
        expect(mockSocket.emit).toHaveBeenCalledWith('messages-bound', {
            sid: 'session-1',
            bindings,
        })
    })
})
