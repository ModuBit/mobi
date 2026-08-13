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
            .toThrow()
    })

    it('getSessionsByProject 分页 + total；getUnboundSessions 只含游离', () => {
        const project = store.projects.createProject({
            namespace: 'default', machineId: 'm1', name: 'mobi',
            folders: [{ path: '/a/mobi', primary: true }]
        })
        for (let i = 0; i < 3; i++) {
            store.sessions.getOrCreateSession(`t${i}`, { path: '/a/mobi' }, {}, 'default', undefined, project.id)
        }
        store.sessions.getOrCreateSession('free', { path: '/x' }, {}, 'default')

        const inProject = store.sessions.getSessionsByProject('default', project.id, null, 2)
        expect(inProject.sessions).toHaveLength(2)
        expect(inProject.total).toBe(3)
        expect(inProject.hasMore).toBe(true)

        const unbound = store.sessions.getUnboundSessions('default', null, 20)
        expect(unbound.total).toBe(1)
        expect(unbound.sessions[0]?.projectId).toBeNull()
    })

    it('setSessionProject 归入 / 解绑', () => {
        const project = store.projects.createProject({
            namespace: 'default', machineId: 'm1', name: 'mobi',
            folders: [{ path: '/a/mobi', primary: true }]
        })
        const s = store.sessions.getOrCreateSession('tag9', { path: '/x' }, {}, 'default')
        expect(store.sessions.setSessionProject(s.id, project.id, 'default')).toBe(true)
        expect(store.sessions.getSession(s.id)?.projectId).toBe(project.id)
        expect(store.sessions.setSessionProject(s.id, null, 'default')).toBe(true)
        expect(store.sessions.getSession(s.id)?.projectId).toBeNull()
    })

    it('setSessionProject 目标项目不存在 → false；跨 namespace → false', () => {
        const s = store.sessions.getOrCreateSession('tag10', { path: '/x' }, {}, 'default')
        expect(store.sessions.setSessionProject(s.id, 'nope', 'default')).toBe(false)
        // 跨 namespace：项目在 other，会话在 default
        const other = store.projects.createProject({
            namespace: 'other', machineId: 'm1', name: 'y',
            folders: [{ path: '/y', primary: true }]
        })
        expect(store.sessions.setSessionProject(s.id, other.id, 'default')).toBe(false)
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
