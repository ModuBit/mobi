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
import { Store } from '../../src/store'
import { EventPublisher } from '../../src/sync/eventPublisher'
import { ProjectCache } from '../../src/sync/projectCache'
import type { SSEManager } from '../../src/sse/sseManager'

/** 构造捕获广播事件的 ProjectCache（SSE 联动断言用） */
function makeCache(store: Store): { cache: ProjectCache; events: SyncEvent[] } {
    const events: SyncEvent[] = []
    const sseManager = {
        broadcast: (event: SyncEvent) => { events.push(event) },
    } as unknown as SSEManager
    // resolveNamespace 语义照抄 SyncEngine：事件自带 namespace 则透传
    const publisher = new EventPublisher(sseManager, (event) => event.namespace)
    // warmup 时机照抄 SyncEngine：构造后立即 warmupCache
    const cache = new ProjectCache(store, publisher)
    cache.warmupCache()
    return { cache, events }
}

describe('ProjectCache', () => {
    let store: Store
    let cache: ProjectCache
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

    test('createProject 后缓存可读，并广播 project-added（带 namespace）', () => {
        const project = cache.createProject('default', {
            machineId: 'm1',
            name: 'mobi',
            folders: [{ path: '/a/mobi', primary: true }],
        })

        expect(cache.getProject(project.id)?.name).toBe('mobi')
        expect(cache.getProjects('default').map(p => p.id)).toEqual([project.id])

        const last = events[events.length - 1]
        expect(last).toMatchObject({ type: 'project-added', projectId: project.id, namespace: 'default' })
    })

    test('createProject folders 非法时透传 store 抛错且不发事件', () => {
        expect(() => cache.createProject('default', {
            machineId: 'm1',
            name: 'x',
            folders: [{ path: '/a', primary: true }, { path: '/b', primary: true }],
        })).toThrow()
        expect(events).toHaveLength(0)
    })

    test('updateProject 后广播 project-updated 且缓存刷新', () => {
        const project = cache.createProject('default', {
            machineId: 'm1', name: 'a', folders: [{ path: '/a', primary: true }],
        })

        const updated = cache.updateProject(project.id, 'default', { name: 'a2' })
        expect(updated?.name).toBe('a2')
        expect(cache.getProject(project.id)?.name).toBe('a2')

        const last = events[events.length - 1]
        expect(last).toMatchObject({ type: 'project-updated', projectId: project.id, namespace: 'default' })
    })

    test('updateProject 跨 namespace / 不存在 → null 不发事件', () => {
        const project = cache.createProject('default', {
            machineId: 'm1', name: 'a', folders: [{ path: '/a', primary: true }],
        })
        expect(cache.updateProject(project.id, 'other', { name: 'x' })).toBeNull()
        const count = events.length
        expect(cache.updateProject('nope', 'default', { name: 'x' })).toBeNull()
        expect(events).toHaveLength(count)
    })

    test('deleteProject 后广播 project-removed，名下会话逐个广播 session-updated', () => {
        const project = cache.createProject('default', {
            machineId: 'm1', name: 'a', folders: [{ path: '/a', primary: true }],
        })
        const s1 = store.sessions.getOrCreateSession('t1', { path: '/a' }, null, 'default', undefined, project.id)
        const s2 = store.sessions.getOrCreateSession('t2', { path: '/a' }, null, 'default', undefined, project.id)
        store.sessions.getOrCreateSession('free', { path: '/x' }, null, 'default')

        expect(cache.deleteProject(project.id, 'default')).toBe(true)

        // 缓存移除 + DB 删除 + 会话解绑
        expect(cache.getProject(project.id)).toBeUndefined()
        expect(store.projects.getProject(project.id)).toBeNull()
        expect(store.sessions.getSession(s1.id)?.projectId).toBeNull()
        expect(store.sessions.getSession(s2.id)?.projectId).toBeNull()

        const removed = events.filter(e => e.type === 'project-removed')
        expect(removed).toHaveLength(1)
        expect(removed[0]).toMatchObject({ projectId: project.id, namespace: 'default' })

        const updated = events.filter(e => e.type === 'session-updated')
        expect(updated.map(e => (e as { sessionId: string }).sessionId).sort())
            .toEqual([s1.id, s2.id].sort())
        for (const e of updated) {
            expect((e as { namespace?: string }).namespace).toBe('default')
        }
    })

    test('deleteProject 不存在 / 跨 namespace → false 不发事件', () => {
        expect(cache.deleteProject('nope', 'default')).toBe(false)
        const project = cache.createProject('default', {
            machineId: 'm1', name: 'a', folders: [{ path: '/a', primary: true }],
        })
        expect(cache.deleteProject(project.id, 'other')).toBe(false)
        expect(events.filter(e => e.type === 'project-removed')).toHaveLength(0)
    })

    test('getProjects 按 namespace 过滤、updatedAt 倒序', async () => {
        const a = cache.createProject('default', {
            machineId: 'm1', name: 'a', folders: [{ path: '/a', primary: true }],
        })
        cache.createProject('other', {
            machineId: 'm1', name: 'b', folders: [{ path: '/b', primary: true }],
        })
        await new Promise(r => setTimeout(r, 5))
        // 更新 a 抬升 updatedAt，a 应排在最前
        cache.updateProject(a.id, 'default', { name: 'a2' })

        const list = cache.getProjects('default')
        expect(list.map(p => p.name)).toEqual(['a2'])
        expect(cache.getProjects('other').map(p => p.name)).toEqual(['b'])
    })

    test('warmup：DB 已有项目时新缓存实例可读（重启恢复）', () => {
        const project = store.projects.createProject({
            namespace: 'default', machineId: 'm1', name: 'pre',
            folders: [{ path: '/a', primary: true }],
        })

        const fresh = makeCache(store)
        expect(fresh.cache.getProject(project.id)?.name).toBe('pre')
        expect(fresh.cache.getProjects('default')).toHaveLength(1)
    })
})
