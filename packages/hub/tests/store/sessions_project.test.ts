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

describe('sessions 与 project 关联', () => {
    it('getOrCreateSession 带 projectId 写入归属', () => {
        const project = store.projects.createProject({
            namespace: 'default', machineId: 'm1', name: 'mobi',
            folders: [{ path: '/a/mobi', primary: true }]
        })
        const s = store.sessions.getOrCreateSession('tag1', { path: '/a/mobi' }, {}, 'default', undefined, project.id)
        expect(s.projectId).toBe(project.id)
    })

    it('不带 projectId → 游离', () => {
        const s = store.sessions.getOrCreateSession('tag2', { path: '/x' }, {}, 'default')
        expect(s.projectId).toBeNull()
    })

    it('projectId 不存在 → 抛错', () => {
        expect(() => store.sessions.getOrCreateSession('tag3', { path: '/x' }, {}, 'default', undefined, 'nope'))
            .toThrow('Project not found: nope')
    })

    it('getSessionsByProject 分页 + total；getUnboundSessions 只含游离', () => {
        const project = store.projects.createProject({
            namespace: 'default', machineId: 'm1', name: 'mobi',
            folders: [{ path: '/a/mobi', primary: true }]
        })
        // 注：插入间隔 1ms 确保 updated_at 严格不同（同毫秒会让 `< cursor` 跳过所有同毫秒行）
        for (let i = 0; i < 3; i++) {
            store.sessions.getOrCreateSession(`t${i}`, { path: '/a/mobi' }, {}, 'default', undefined, project.id)
            Bun.sleepSync(1)
        }
        store.sessions.getOrCreateSession('free1', { path: '/x' }, {}, 'default')
        Bun.sleepSync(1)
        store.sessions.getOrCreateSession('free2', { path: '/y' }, {}, 'default')
        Bun.sleepSync(1)
        store.sessions.getOrCreateSession('free3', { path: '/z' }, {}, 'default')

        const inProject = store.sessions.getSessionsByProject('default', project.id, null, 2)
        expect(inProject.sessions).toHaveLength(2)
        expect(inProject.total).toBe(3)
        expect(inProject.hasMore).toBe(true)

        // 第二页（cursor 路径）：剩余 1 条，total 仍为全集 3（不受 cursor 影响）
        const inProjectPage2 = store.sessions.getSessionsByProject('default', project.id, inProject.nextCursor, 2)
        expect(inProjectPage2.sessions).toHaveLength(1)
        expect(inProjectPage2.hasMore).toBe(false)
        expect(inProjectPage2.total).toBe(3)

        const unbound = store.sessions.getUnboundSessions('default', null, 20)
        expect(unbound.total).toBe(3)
        expect(unbound.sessions[0]?.projectId).toBeNull()

        // 游离会话第二页（cursor 路径）：剩余 1 条，total 仍为全集 3（不受 cursor 影响）
        const unboundPage1 = store.sessions.getUnboundSessions('default', null, 2)
        expect(unboundPage1.sessions).toHaveLength(2)
        expect(unboundPage1.hasMore).toBe(true)
        const unboundPage2 = store.sessions.getUnboundSessions('default', unboundPage1.nextCursor, 2)
        expect(unboundPage2.sessions).toHaveLength(1)
        expect(unboundPage2.hasMore).toBe(false)
        expect(unboundPage2.total).toBe(3)
    })

    it('setSessionProject 归入 / 解绑', () => {
        const project = store.projects.createProject({
            namespace: 'default', machineId: 'm1', name: 'mobi',
            folders: [{ path: '/a/mobi', primary: true }]
        })
        const s = store.sessions.getOrCreateSession('tag9', { path: '/x' }, {}, 'default')
        expect(store.sessions.setSessionProject(s.id, project.id, 'default')).toBe('changed')
        expect(store.sessions.getSession(s.id)?.projectId).toBe(project.id)
        expect(store.sessions.setSessionProject(s.id, null, 'default')).toBe('changed')
        expect(store.sessions.getSession(s.id)?.projectId).toBeNull()
    })

    it('setSessionProject 幂等：重归入同一项目不递增 seq/updated_at', () => {
        const project = store.projects.createProject({
            namespace: 'default', machineId: 'm1', name: 'mobi',
            folders: [{ path: '/a/mobi', primary: true }]
        })
        const s = store.sessions.getOrCreateSession('tag9b', { path: '/x' }, {}, 'default')
        expect(store.sessions.setSessionProject(s.id, project.id, 'default')).toBe('changed')
        // 重归入同一项目：noop，且 seq/updated_at 保持不变
        const before = store.sessions.getSession(s.id)!
        expect(store.sessions.setSessionProject(s.id, project.id, 'default')).toBe('noop')
        const after = store.sessions.getSession(s.id)!
        expect(after.seq).toBe(before.seq)
        expect(after.updatedAt).toBe(before.updatedAt)
        // 幂等解绑：归属已是 null，再解绑仍是 noop
        expect(store.sessions.setSessionProject(s.id, null, 'default')).toBe('changed')
        expect(store.sessions.setSessionProject(s.id, null, 'default')).toBe('noop')
    })

    it('setSessionProject 目标项目不存在 / 跨 namespace / 会话不存在 → not_found', () => {
        const s = store.sessions.getOrCreateSession('tag10', { path: '/x' }, {}, 'default')
        expect(store.sessions.setSessionProject(s.id, 'nope', 'default')).toBe('not_found')
        // 跨 namespace：项目在 other，会话在 default
        const other = store.projects.createProject({
            namespace: 'other', machineId: 'm1', name: 'y',
            folders: [{ path: '/y', primary: true }]
        })
        expect(store.sessions.setSessionProject(s.id, other.id, 'default')).toBe('not_found')
        // 会话不存在
        expect(store.sessions.setSessionProject('ghost', other.id, 'other')).toBe('not_found')
    })

    it('resume 复用：已存在 session 的 projectId 不变（合并分支不重算归属）', () => {
        const project = store.projects.createProject({
            namespace: 'default', machineId: 'm1', name: 'mobi',
            folders: [{ path: '/a/mobi', primary: true }]
        })
        store.sessions.getOrCreateSession('tag11', { path: '/a/mobi' }, {}, 'default', undefined, project.id)
        // 同 tag 再调（模拟重连/resume），即使不带 projectId 也保留原归属
        const again = store.sessions.getOrCreateSession('tag11', { path: '/a/mobi' }, {}, 'default')
        expect(again.projectId).toBe(project.id)
    })
})
