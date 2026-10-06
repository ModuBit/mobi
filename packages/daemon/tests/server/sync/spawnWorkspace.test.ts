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
import { SyncEngine } from '../../../src/sync/syncEngine'
import { LocalMachineHost } from '../../../src/executor/localExecutor'
import type { RunnerSessionBridge } from '../../../src/executor/lifecycle'
import type { SpawnSessionOptions, SpawnSessionResult } from '@mobi/shared/hostProtocol'
import { Store } from '../../../src/store'
import type { RpcRegistry } from '../../../src/socket/rpcRegistry'

/**
 * spawn 链路透传 workspaceId 单测（ticket-20 起 socket 通道删除，观测点改为
 * runner bridge 的 spawn 入参）：
 * Web → engine.spawnSession → LocalMachineHost → RunnerSessionBridge.spawnSession。
 * workspaceId 是最后一个位置参数，未传时入参中不出现有效值。
 */

/** 捕获 bridge.spawnSession 的入参 */
interface BridgeCapture {
    spawnCalls: SpawnSessionOptions[]
}

function makeEngine(capture: BridgeCapture): SyncEngine {
    const io = { of: () => ({ sockets: new Map() }), emit: () => {} } as unknown as import('socket.io').Server
    const registry = { getSocketIdForMethod: () => null } as unknown as RpcRegistry
    const sseManager = { broadcast: () => {} } as unknown as import('../../../src/sse/sseManager').SSEManager
    const store = new Store(':memory:')
    const bridge: RunnerSessionBridge = {
        spawnSession: async (options) => {
            capture.spawnCalls.push(options)
            return { type: 'success', sessionId: 'spawned-1' } satisfies SpawnSessionResult
        },
        stopSession: () => true,
        registerSessionTracking: () => {},
    }
    const engine = new SyncEngine(store, io, registry, sseManager, undefined, new LocalMachineHost(() => bridge))
    return engine
}

describe('spawn 链路透传 workspaceId（bridge 直调）', () => {
    test('engine.spawnSession 收到 workspaceId 后原样出现在 bridge 入参', async () => {
        const capture: BridgeCapture = { spawnCalls: [] }
        const engine = makeEngine(capture)
        try {
            const result = await engine.spawnSession('machine-p1', '/tmp/proj', { workspaceId: 'workspace-42' })
            expect(result).toEqual({ type: 'success', sessionId: 'spawned-1' })
            expect(capture.spawnCalls).toHaveLength(1)
            expect(capture.spawnCalls[0]).toMatchObject({
                directory: '/tmp/proj',
                workspaceId: 'workspace-42',
            })
        } finally {
            engine.stop()
        }
    })

    test('engine.spawnSession 未传 workspaceId 时 bridge 入参中不出现有效值', async () => {
        const capture: BridgeCapture = { spawnCalls: [] }
        const engine = makeEngine(capture)
        try {
            const result = await engine.spawnSession('machine-p1', '/tmp/proj')
            expect(result).toEqual({ type: 'success', sessionId: 'spawned-1' })
            expect(capture.spawnCalls).toHaveLength(1)
            expect((capture.spawnCalls[0] as unknown as Record<string, unknown>).workspaceId).toBeUndefined()
        } finally {
            engine.stop()
        }
    })
})
