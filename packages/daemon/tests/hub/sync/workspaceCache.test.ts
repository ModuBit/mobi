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
import type { SyncEvent } from '@mobi/shared/types'
import { Store } from '../../../src/store'
import { EventPublisher } from '../../../src/sync/eventPublisher'
import { WorkspaceCache } from '../../../src/sync/workspaceCache'
import type { SSEManager } from '../../../src/sse/sseManager'

/** 构造捕获广播事件的 WorkspaceCache（SSE 联动断言用） */
function makeCache(store: Store): { cache: WorkspaceCache; events: SyncEvent[] } {
    const events: SyncEvent[] = []
    const sseManager = {
        broadcast: (event: SyncEvent) => { events.push(event) },
    } as unknown as SSEManager
    // resolveNamespace 语义照抄 SyncEngine：事件自带 namespace 则透传
    const publisher = new EventPublisher(sseManager, (event) => event.namespace)
    // warmup 时机照抄 SyncEngine：构造后立即 warmupCache
    const cache = new WorkspaceCache(store, publisher)
    cache.warmupCache()
    return { cache, events }
}

describe('WorkspaceCache', () => {
    let store: Store
    let cache: WorkspaceCache
    let events: SyncEvent[]

    beforeEach(() => {
        store = new Store(':memory:')
        const made = makeCache(store)
        cache = made.cache
        events = made.events
    })

    afterEach(() => {
        store.close()
    })

    test('createWorkspace 后缓存可读，并广播 workspace-added（带 namespace）', () => {
        const workspace = cache.createWorkspace('default', {
            machineId: 'm1',
            name: 'mobi',
            folders: [{ path: '/a/mobi', primary: true }],
        })

        expect(cache.getWorkspace(workspace.id)?.name).toBe('mobi')
        expect(cache.getWorkspaces('default').map(p => p.id)).toEqual([workspace.id])

        const last = events[events.length - 1]
        expect(last).toMatchObject({ type: 'workspace-added', workspaceId: workspace.id, namespace: 'default' })
    })

    test('createWorkspace folders 非法时透传 store 抛错且不发事件', () => {
        expect(() => cache.createWorkspace('default', {
            machineId: 'm1',
            name: 'x',
            folders: [{ path: '/a', primary: true }, { path: '/b', primary: true }],
        })).toThrow()
        expect(events).toHaveLength(0)
    })

    test('updateWorkspace 后广播 workspace-updated 且缓存刷新', () => {
        const workspace = cache.createWorkspace('default', {
            machineId: 'm1', name: 'a', folders: [{ path: '/a', primary: true }],
        })

        const updated = cache.updateWorkspace(workspace.id, 'default', { name: 'a2' })
        expect(updated?.name).toBe('a2')
        expect(cache.getWorkspace(workspace.id)?.name).toBe('a2')

        const last = events[events.length - 1]
        expect(last).toMatchObject({ type: 'workspace-updated', workspaceId: workspace.id, namespace: 'default' })
    })

    test('updateWorkspace 跨 namespace / 不存在 → null 不发事件', () => {
        const workspace = cache.createWorkspace('default', {
            machineId: 'm1', name: 'a', folders: [{ path: '/a', primary: true }],
        })
        expect(cache.updateWorkspace(workspace.id, 'other', { name: 'x' })).toBeNull()
        const count = events.length
        expect(cache.updateWorkspace('nope', 'default', { name: 'x' })).toBeNull()
        expect(events).toHaveLength(count)
    })

    test('deleteWorkspace 后广播 workspace-removed，名下会话逐个广播 session-updated', () => {
        const workspace = cache.createWorkspace('default', {
            machineId: 'm1', name: 'a', folders: [{ path: '/a', primary: true }],
        })
        const s1 = store.sessions.getOrCreateSession('t1', { path: '/a' }, null, 'default', undefined, workspace.id)
        const s2 = store.sessions.getOrCreateSession('t2', { path: '/a' }, null, 'default', undefined, workspace.id)
        store.sessions.getOrCreateSession('free', { path: '/x' }, null, 'default')

        expect(cache.deleteWorkspace(workspace.id, 'default')?.sort()).toEqual([s1.id, s2.id].sort())

        // 缓存移除 + DB 删除 + 会话解绑
        expect(cache.getWorkspace(workspace.id)).toBeUndefined()
        expect(store.workspaces.getWorkspace(workspace.id)).toBeNull()
        expect(store.sessions.getSession(s1.id)?.workspaceId).toBeNull()
        expect(store.sessions.getSession(s2.id)?.workspaceId).toBeNull()

        const removed = events.filter(e => e.type === 'workspace-removed')
        expect(removed).toHaveLength(1)
        expect(removed[0]).toMatchObject({ workspaceId: workspace.id, namespace: 'default' })

        const updated = events.filter(e => e.type === 'session-updated')
        expect(updated.map(e => (e as { sessionId: string }).sessionId).sort())
            .toEqual([s1.id, s2.id].sort())
        for (const e of updated) {
            expect((e as { namespace?: string }).namespace).toBe('default')
        }
    })

    test('deleteWorkspace 不存在 / 跨 namespace → null 不发事件', () => {
        expect(cache.deleteWorkspace('nope', 'default')).toBeNull()
        const workspace = cache.createWorkspace('default', {
            machineId: 'm1', name: 'a', folders: [{ path: '/a', primary: true }],
        })
        expect(cache.deleteWorkspace(workspace.id, 'other')).toBeNull()
        expect(events.filter(e => e.type === 'workspace-removed')).toHaveLength(0)
    })

    test('getWorkspaces 按 namespace 过滤、updatedAt 倒序', async () => {
        const a = cache.createWorkspace('default', {
            machineId: 'm1', name: 'a', folders: [{ path: '/a', primary: true }],
        })
        cache.createWorkspace('other', {
            machineId: 'm1', name: 'b', folders: [{ path: '/b', primary: true }],
        })
        await new Promise(r => setTimeout(r, 5))
        // 更新 a 抬升 updatedAt，a 应排在最前
        cache.updateWorkspace(a.id, 'default', { name: 'a2' })

        const list = cache.getWorkspaces('default')
        expect(list.map(p => p.name)).toEqual(['a2'])
        expect(cache.getWorkspaces('other').map(p => p.name)).toEqual(['b'])
    })

    test('warmup：DB 已有工作区时新缓存实例可读（重启恢复）', () => {
        const workspace = store.workspaces.createWorkspace({
            namespace: 'default', machineId: 'm1', name: 'pre',
            folders: [{ path: '/a', primary: true }],
        })

        const fresh = makeCache(store)
        expect(fresh.cache.getWorkspace(workspace.id)?.name).toBe('pre')
        expect(fresh.cache.getWorkspaces('default')).toHaveLength(1)
    })
})
