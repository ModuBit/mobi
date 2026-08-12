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
import { Store } from '../../src/store'
import type { RpcRegistry } from '../../src/socket/rpcRegistry'

/**
 * renameSession 单测：验证 sessionCache 更新后 best-effort 同步 RPC 到 CLI。
 * rpcGateway 的细节由 rpcGateway.test.ts 覆盖，这里只验证组合行为。
 */

interface EngineHandle {
    engine: SyncEngine
    store: Store
    /** 捕获 emitWithAck 的 rpc-request 信封 */
    emitCalls: { method: string; params: unknown }[]
    cleanup: () => void
}

/** 构造真实 SyncEngine + 可控 fake io/registry/sse */
function makeEngine(opts: { renameOnline: boolean }): EngineHandle {
    const store = new Store(':memory:')
    const emitCalls: { method: string; params: unknown }[] = []

    const fakeSocket = {
        timeout() { return this },
        async emitWithAck(_event: string, payload: { method: string; params: unknown }) {
            emitCalls.push(payload)
            return { ok: true }
        },
    }
    const sockets = new Map<string, unknown>([['sock-1', fakeSocket]])
    const io = {
        of() { return { sockets } },
    } as unknown as import('socket.io').Server

    const registry = {
        getSocketIdForMethod(method: string) {
            if (method.endsWith(':rename-session')) {
                return opts.renameOnline ? 'sock-1' : null
            }
            return null
        },
    } as unknown as RpcRegistry

    const sseManager = { broadcast: () => {} } as unknown as import('../../src/sse/sseManager').SSEManager

    const engine = new SyncEngine(store, io, registry, sseManager)

    return {
        engine,
        store,
        emitCalls,
        cleanup: () => {
            engine.stop()
            store.close()
        },
    }
}

describe('SyncEngine.renameSession', () => {
    test('sessionCache 更新后 best-effort 同步 rename-session RPC 到 CLI', async () => {
        const h = makeEngine({ renameOnline: true })
        try {
            const session = h.engine.getOrCreateSession(
                'tag-rename-rpc-1',
                { path: '/tmp/proj', host: 'h-1' },
                null,
                'default'
            )

            await h.engine.renameSession(session.id, '新标题')

            // 1. Hub DB 已更新
            const after = h.engine.getSession(session.id)
            expect(after?.metadata?.name).toBe('新标题')

            // 2. RPC 已下发到 CLI
            expect(h.emitCalls).toHaveLength(1)
            expect(h.emitCalls[0].method).toBe(`${session.id}:rename-session`)
            expect(h.emitCalls[0].params).toEqual({ title: '新标题' })
        } finally {
            h.cleanup()
        }
    })

    test('RPC 失败（CLI 不在线）不阻断 renameSession —— best-effort', async () => {
        const h = makeEngine({ renameOnline: false })
        try {
            const session = h.engine.getOrCreateSession(
                'tag-rename-rpc-2',
                { path: '/tmp/proj', host: 'h-2' },
                null,
                'default'
            )

            // renameSession 应静默吞掉 RPC 错误，不 throw
            await expect(h.engine.renameSession(session.id, '离线标题')).resolves.toBeUndefined()

            // Hub DB 仍然更新成功（RPC 失败不影响本地一致性）
            const after = h.engine.getSession(session.id)
            expect(after?.metadata?.name).toBe('离线标题')

            // RPC 确实尝试过（registry 返回 null → rpcCall throw，emitWithAck 未被调用）
            expect(h.emitCalls).toHaveLength(0)
        } finally {
            h.cleanup()
        }
    })
})
