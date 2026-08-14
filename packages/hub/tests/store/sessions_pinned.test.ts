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

import { describe, expect, it, beforeEach, afterEach } from 'bun:test'

import { Store } from '../../src/store'

let store: Store

beforeEach(() => {
    store = new Store(':memory:')
})

afterEach(() => {
    store.close()
})

describe('sessions 置顶（纯展示维度分组，不改归属）', () => {
    it('setSessionPinned 三态：changed 递增 seq / noop 幂等 / not_found', () => {
        const s = store.sessions.getOrCreateSession('pin-1', { path: '/x' }, {}, 'default')
        expect(s.pinned).toBe(false)

        // changed：置顶 + seq/updated_at 递增
        expect(store.sessions.setSessionPinned(s.id, true, 'default')).toBe('changed')
        const pinned = store.sessions.getSession(s.id)
        expect(pinned?.pinned).toBe(true)
        expect(pinned!.seq).toBeGreaterThan(s.seq)

        // noop：重复置顶不递增 seq
        const seqBefore = pinned!.seq
        expect(store.sessions.setSessionPinned(s.id, true, 'default')).toBe('noop')
        expect(store.sessions.getSession(s.id)?.seq).toBe(seqBefore)

        // not_found：会话不存在 / 跨 namespace
        expect(store.sessions.setSessionPinned('nope', true, 'default')).toBe('not_found')
        expect(store.sessions.setSessionPinned(s.id, true, 'other')).toBe('not_found')

        // 取消置顶
        expect(store.sessions.setSessionPinned(s.id, false, 'default')).toBe('changed')
        expect(store.sessions.getSession(s.id)?.pinned).toBe(false)
    })

    it('置顶会话从「项目」「最近」过滤、进「置顶」；取消置顶反向', () => {
        const project = store.projects.createProject({
            namespace: 'default', machineId: 'm1', name: 'mobi',
            folders: [{ path: '/a/mobi', primary: true }]
        })
        const bound = store.sessions.getOrCreateSession(
            'pin-bound', { path: '/a/mobi' }, {}, 'default', undefined, project.id)
        const unbound = store.sessions.getOrCreateSession('pin-unbound', { path: '/y' }, {}, 'default')

        // 初始：项目 1 条、最近 1 条、置顶 0 条
        expect(store.sessions.getSessionsByProject('default', project.id, null).total).toBe(1)
        expect(store.sessions.getUnboundSessions('default', null).total).toBe(1)
        expect(store.sessions.getPinnedSessions('default', null).total).toBe(0)

        // 置顶后：两端都进「置顶」，原分组过滤掉
        store.sessions.setSessionPinned(bound.id, true, 'default')
        store.sessions.setSessionPinned(unbound.id, true, 'default')
        expect(store.sessions.getSessionsByProject('default', project.id, null).total).toBe(0)
        expect(store.sessions.getUnboundSessions('default', null).total).toBe(0)
        const pinnedResult = store.sessions.getPinnedSessions('default', null)
        expect(pinnedResult.total).toBe(2)
        expect(pinnedResult.sessions.map(s => s.id).sort()).toEqual([bound.id, unbound.id].sort())

        // 取消置顶：回到原分组（归属原样保留——bound 回项目，unbound 回最近）
        store.sessions.setSessionPinned(bound.id, false, 'default')
        store.sessions.setSessionPinned(unbound.id, false, 'default')
        expect(store.sessions.getSessionsByProject('default', project.id, null).total).toBe(1)
        expect(store.sessions.getUnboundSessions('default', null).total).toBe(1)
        expect(store.sessions.getPinnedSessions('default', null).total).toBe(0)
    })

    it('置顶跨 namespace 隔离', () => {
        const s = store.sessions.getOrCreateSession('pin-ns', { path: '/x' }, {}, 'default')
        store.sessions.setSessionPinned(s.id, true, 'default')
        expect(store.sessions.getPinnedSessions('default', null).total).toBe(1)
        expect(store.sessions.getPinnedSessions('other', null).total).toBe(0)
    })
})
