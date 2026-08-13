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
import { SyncEngine, checkProjectAssignable } from '../../src/sync/syncEngine'
import { Store } from '../../src/store'
import type { RpcRegistry } from '../../src/socket/rpcRegistry'
import type { SSEManager } from '../../src/sse/sseManager'

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

describe('checkProjectAssignable', () => {
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

    test('项目存在 + 同 namespace + machineId 匹配 → ok', () => {
        const project = engine.createProject('default', {
            machineId: 'm1', name: 'a', folders: [{ path: '/a', primary: true }],
        })
        expect(checkProjectAssignable(engine, project.id, 'default', 'm1')).toBe('ok')
    })

    test('项目不存在或跨 namespace → not_found', () => {
        expect(checkProjectAssignable(engine, 'nope', 'default')).toBe('not_found')

        const project = engine.createProject('default', {
            machineId: 'm1', name: 'a', folders: [{ path: '/a', primary: true }],
        })
        expect(checkProjectAssignable(engine, project.id, 'other', 'm1')).toBe('not_found')
    })

    test('machineId 已知且 ≠ 项目机器 → machine_mismatch', () => {
        const project = engine.createProject('default', {
            machineId: 'mA', name: 'a', folders: [{ path: '/a', primary: true }],
        })
        expect(checkProjectAssignable(engine, project.id, 'default', 'mB')).toBe('machine_mismatch')
    })

    test('machineId 未知/缺失（老数据）→ 放行 ok', () => {
        const project = engine.createProject('default', {
            machineId: 'mA', name: 'a', folders: [{ path: '/a', primary: true }],
        })
        expect(checkProjectAssignable(engine, project.id, 'default', undefined)).toBe('ok')
        expect(checkProjectAssignable(engine, project.id, 'default', null)).toBe('ok')
        // 非字符串形态（异常数据）同样按未知放行，与路由内联断言的历史语义一致
        expect(checkProjectAssignable(engine, project.id, 'default', 42 as unknown as string)).toBe('ok')
    })
})
