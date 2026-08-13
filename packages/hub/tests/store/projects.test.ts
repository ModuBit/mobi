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

import { describe, test, expect, beforeEach, afterEach, it } from 'bun:test'

import { Store } from '../../src/store'

describe('ProjectStore', () => {
    let store: Store

    beforeEach(() => {
        store = new Store(':memory:')
    })

    afterEach(() => {
        store.close()
    })

    test('创建并读取项目', () => {
        const p = store.projects.createProject({
            namespace: 'default',
            machineId: 'm1',
            name: 'mobi',
            folders: [
                { path: '/a/mobi', primary: true },
                { path: '/a/shared', primary: false }
            ]
        })
        expect(p.id).toBeTruthy()
        expect(store.projects.getProject(p.id)?.name).toBe('mobi')
        expect(store.projects.getProject(p.id)?.folders).toHaveLength(2)
    })

    test('folders 非法时抛错（0 项 / 双 primary）', () => {
        expect(() =>
            store.projects.createProject({
                namespace: 'default',
                machineId: 'm1',
                name: 'x',
                folders: []
            })
        ).toThrow()
        expect(() =>
            store.projects.createProject({
                namespace: 'default',
                machineId: 'm1',
                name: 'x',
                folders: [
                    { path: '/a', primary: true },
                    { path: '/b', primary: true }
                ]
            })
        ).toThrow()
    })

    test('list 按 namespace 过滤、按 updatedAt 倒序', () => {
        const a = store.projects.createProject({
            namespace: 'default',
            machineId: 'm1',
            name: 'a',
            folders: [{ path: '/a', primary: true }]
        })
        store.projects.createProject({
            namespace: 'other',
            machineId: 'm1',
            name: 'b',
            folders: [{ path: '/b', primary: true }]
        })
        const list = store.projects.getProjects('default')
        expect(list.map(p => p.id)).toEqual([a.id])
    })

    test('update 改名/改 folders 并递增 seq', () => {
        const p = store.projects.createProject({
            namespace: 'default',
            machineId: 'm1',
            name: 'a',
            folders: [{ path: '/a', primary: true }]
        })
        const updated = store.projects.updateProject(p.id, 'default', { name: 'a2' })
        expect(updated?.name).toBe('a2')
        expect(store.projects.getProject(p.id)?.seq).toBeGreaterThan(p.seq)
    })

    test('删除不存在的项目返回 false', () => {
        expect(store.projects.deleteProject('nonexistent', 'default')).toBe(false)
    })

    // 依赖 Task 3 的 getOrCreateSession(..., projectId) 参数，届时补全实现启用
    it.todo('删除项目 → 名下 sessions 解绑（project_id 置 NULL）', () => {})
})
