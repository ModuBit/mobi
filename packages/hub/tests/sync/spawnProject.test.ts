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

import { describe, test, expect } from 'bun:test'
import { SyncEngine } from '../../src/sync/syncEngine'
import { RpcGateway } from '../../src/sync/rpcGateway'
import { Store } from '../../src/store'
import type { RpcRegistry } from '../../src/socket/rpcRegistry'

/**
 * spawn 链路透传 projectId 单测：
 * Web → engine.spawnSession → rpcGateway.spawnSession → runner 的 spawn-mobi-session RPC body。
 * projectId 是最后一个位置参数，未传时 body 中不出现有效值。
 */

/** 捕获 emitWithAck 的 rpc-request 信封 */
interface EmitCapture {
    emitCalls: { method: string; params: unknown }[]
}

/** 构造 fake socket.io Server：单个 socket，emitWithAck 返回 spawn 成功信封 */
function makeSpawnIo(capture: EmitCapture) {
    const fakeSocket = {
        timeout() { return this },
        async emitWithAck(_event: string, payload: { method: string; params: unknown }) {
            capture.emitCalls.push(payload)
            return { type: 'success', sessionId: 'spawned-1' }
        },
    }
    const sockets = new Map<string, unknown>([['sock-1', fakeSocket]])
    return {
        of() { return { sockets } },
    } as unknown as import('socket.io').Server
}

/** 构造 fake rpcRegistry：machine 的 spawn-mobi-session 方法路由到 sock-1 */
function makeSpawnRegistry(machineId: string): RpcRegistry {
    return {
        getSocketIdForMethod(method: string) {
            return method === `${machineId}:spawn-mobi-session` ? 'sock-1' : null
        },
    } as unknown as RpcRegistry
}

describe('spawn 链路透传 projectId', () => {
    test('engine.spawnSession 收到 projectId 后原样出现在 RPC body', async () => {
        const capture: EmitCapture = { emitCalls: [] }
        const io = makeSpawnIo(capture)
        const registry = makeSpawnRegistry('machine-p1')
        const sseManager = { broadcast: () => {} } as unknown as import('../../src/sse/sseManager').SSEManager
        const store = new Store(':memory:')
        const engine = new SyncEngine(store, io, registry, sseManager)
        try {
            const result = await engine.spawnSession(
                'machine-p1',
                '/tmp/proj',
                'claude',
                undefined,
                undefined,
                undefined,
                undefined,
                undefined,
                undefined,
                'project-42'
            )
            expect(result).toEqual({ type: 'success', sessionId: 'spawned-1' })
            expect(capture.emitCalls).toHaveLength(1)
            expect(capture.emitCalls[0].method).toBe('machine-p1:spawn-mobi-session')
            expect(capture.emitCalls[0].params).toMatchObject({
                directory: '/tmp/proj',
                projectId: 'project-42',
            })
        } finally {
            engine.stop()
            store.close()
        }
    })

    test('engine.spawnSession 未传 projectId 时 RPC body 中 projectId 为 undefined', async () => {
        const capture: EmitCapture = { emitCalls: [] }
        const io = makeSpawnIo(capture)
        const registry = makeSpawnRegistry('machine-p2')
        const sseManager = { broadcast: () => {} } as unknown as import('../../src/sse/sseManager').SSEManager
        const store = new Store(':memory:')
        const engine = new SyncEngine(store, io, registry, sseManager)
        try {
            const result = await engine.spawnSession('machine-p2', '/tmp/proj')
            expect(result).toEqual({ type: 'success', sessionId: 'spawned-1' })
            expect(capture.emitCalls).toHaveLength(1)
            expect(capture.emitCalls[0].params).toMatchObject({ directory: '/tmp/proj' })
            expect((capture.emitCalls[0].params as Record<string, unknown>).projectId).toBeUndefined()
        } finally {
            engine.stop()
            store.close()
        }
    })

    test('rpcGateway.spawnSession 直接调用时 projectId 进入 RPC body', async () => {
        const capture: EmitCapture = { emitCalls: [] }
        const io = makeSpawnIo(capture)
        const gateway = new RpcGateway(io, makeSpawnRegistry('machine-p3'))

        const result = await gateway.spawnSession(
            'machine-p3',
            '/tmp/proj',
            'claude',
            undefined,
            undefined,
            undefined,
            undefined,
            undefined,
            undefined,
            'project-99'
        )
        expect(result).toEqual({ type: 'success', sessionId: 'spawned-1' })
        expect(capture.emitCalls).toHaveLength(1)
        expect(capture.emitCalls[0].params).toMatchObject({
            directory: '/tmp/proj',
            projectId: 'project-99',
        })
    })
})
