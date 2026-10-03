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

import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import type { Server } from 'socket.io'
import { SyncEngine, checkWorkspaceAssignable } from '../../../src/sync/syncEngine'
import { Store } from '../../../src/store'
import type { RpcRegistry } from '../../../src/socket/rpcRegistry'
import type { SSEManager } from '../../../src/sse/sseManager'

/** 构造真实 SyncEngine（内存 Store + 空 socket/SSE） */
function makeEngine(): { engine: SyncEngine; cleanup: () => void } {
    const store = new Store(':memory:')
    const io = {
        of() { return { sockets: new Map() } },
    } as unknown as Server
    const registry = {
        getSocketIdForMethod() { return null },
    } as unknown as RpcRegistry
    const sseManager = { broadcast: () => {} } as unknown as SSEManager

    const engine = new SyncEngine(store, io, registry, sseManager)
    return {
        engine,
        cleanup: () => {
            engine.stop()
            store.close()
        },
    }
}

describe('checkWorkspaceAssignable', () => {
    let engine: SyncEngine
    let cleanup: () => void

    beforeEach(() => {
        const handle = makeEngine()
        engine = handle.engine
        cleanup = handle.cleanup
    })

    afterEach(() => {
        cleanup()
    })

    test('工作区存在 + 同 namespace → ok', () => {
        const workspace = engine.createWorkspace('default', {
            machineId: 'm1', name: 'a', folders: [{ path: '/a', primary: true }],
        })
        expect(checkWorkspaceAssignable(engine, workspace.id, 'default')).toBe('ok')
    })

    test('工作区不存在或跨 namespace → not_found', () => {
        expect(checkWorkspaceAssignable(engine, 'nope', 'default')).toBe('not_found')

        const workspace = engine.createWorkspace('default', {
            machineId: 'm1', name: 'a', folders: [{ path: '/a', primary: true }],
        })
        expect(checkWorkspaceAssignable(engine, workspace.id, 'other')).toBe('not_found')
    })
})
