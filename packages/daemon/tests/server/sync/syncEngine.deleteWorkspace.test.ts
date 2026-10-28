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
import type { Session, SyncEvent } from '@mobi/shared/types'
import { SyncEngine } from '../../../src/sync/syncEngine'
import { Store } from '../../../src/store'
import type { RpcRegistry } from '../../../src/socket/rpcRegistry'
import type { SSEManager } from '../../../src/sse/sseManager'

/**
 * 删除工作区后的解绑广播。
 *
 * 解绑会话此刻才落库（workspace_id → NULL），所以完整 session 的广播必须由
 * syncEngine 在刷新 sessionCache 之后发；web 端不本地失效分组视图，只认这条广播。
 * 载荷若为空或仍是旧 workspaceId，web 会停在「会话还挂在已删除工作区下」。
 */
function makeEngine(): { engine: SyncEngine; store: Store; events: SyncEvent[]; cleanup: () => void } {
    const store = new Store(':memory:')
    const events: SyncEvent[] = []
    const sseManager = {
        broadcast: (event: SyncEvent) => { events.push(event) },
    } as unknown as SSEManager
    const registry = { getSocketIdForMethod: () => null } as unknown as RpcRegistry
    const io = { of() { return { sockets: new Map() } } } as unknown as import('socket.io').Server

    const engine = new SyncEngine(store, io, registry, sseManager)
    return {
        engine,
        store,
        events,
        cleanup: () => {
            engine.stop()
            store.close()
        },
    }
}

describe('SyncEngine.deleteWorkspace', () => {
    test('解绑会话广播**刷新后**的完整 session + affects:membership', () => {
        const h = makeEngine()
        try {
            const workspace = h.engine.createWorkspace('default', {
                name: 'w', folders: [{ path: '/tmp/w', primary: true }],
            })
            const bound = h.engine.getOrCreateSession(
                'tag-dw-1', { path: '/tmp/w' }, null, 'default', 'local', undefined, workspace.id,
            )
            const free = h.engine.getOrCreateSession(
                'tag-dw-2', { path: '/tmp/other' }, null, 'default',
            )
            h.events.length = 0

            expect(h.engine.deleteWorkspace(workspace.id, 'default')).toBe(true)

            const updates = h.events.filter(e => e.type === 'session-updated')
            expect(updates).toHaveLength(1)

            const update = updates[0] as { sessionId: string; data: Session; affects?: string }
            expect(update.sessionId).toBe(bound.id)
            expect(update.affects).toBe('membership')
            // 载荷是刷新后的行：workspaceId 已置空（不是解绑前的旧值）
            expect(update.data).toMatchObject({ id: bound.id, workspaceId: null })
            // 未绑定该工作区的会话不涉及
            expect(updates.some(e => (e as { sessionId: string }).sessionId === free.id)).toBe(false)
        } finally {
            h.cleanup()
        }
    })

    test('工作区不存在 / 跨 namespace → false 且不发广播', () => {
        const h = makeEngine()
        try {
            const workspace = h.engine.createWorkspace('default', {
                name: 'w', folders: [{ path: '/tmp/w', primary: true }],
            })
            h.events.length = 0

            expect(h.engine.deleteWorkspace('nope', 'default')).toBe(false)
            expect(h.engine.deleteWorkspace(workspace.id, 'other')).toBe(false)
            expect(h.events).toHaveLength(0)
        } finally {
            h.cleanup()
        }
    })
})
