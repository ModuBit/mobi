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
        const b = store.projects.createProject({
            namespace: 'default',
            machineId: 'm1',
            name: 'b',
            folders: [{ path: '/b', primary: true }]
        })
        // 跨 namespace 的项目不应出现
        store.projects.createProject({
            namespace: 'other',
            machineId: 'm1',
            name: 'c',
            folders: [{ path: '/c', primary: true }]
        })
        // update a 拉开 updatedAt → a 应排在 b 前
        store.projects.updateProject(a.id, 'default', { name: 'a2' })
        const list = store.projects.getProjects('default')
        expect(list.map(p => p.id)).toEqual([a.id, b.id])
    })

    test('list 按「最近会话活动」排序——活跃项目浮顶，无会话回退实体编辑时间（V7）', () => {
        const a = store.projects.createProject({
            namespace: 'default', machineId: 'm1', name: 'a',
            folders: [{ path: '/a', primary: true }]
        })
        Bun.sleepSync(2)
        // b 实体更「新」（后建）——纯实体排序下 b 会钉在 a 上面
        store.projects.createProject({
            namespace: 'default', machineId: 'm1', name: 'b',
            folders: [{ path: '/b', primary: true }]
        })
        Bun.sleepSync(2)
        // a 名下发生会话活动（updated_at = now，晚于 b 的实体 updatedAt）→ a 应浮顶
        store.sessions.getOrCreateSession('tag-v7', { path: '/a' }, {}, 'default', undefined, a.id)

        const list = store.projects.getProjects('default')
        expect(list.map(p => p.id)[0]).toBe(a.id)
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

        // folders patch 分支：替换文件夹列表并再次递增 seq
        const foldersUpdated = store.projects.updateProject(p.id, 'default', {
            folders: [{ path: '/a/new', primary: true }]
        })
        expect(foldersUpdated?.folders).toEqual([{ path: '/a/new', primary: true }])
        expect(foldersUpdated?.seq).toBeGreaterThan(updated?.seq ?? 0)

        // folders patch 非法时抛错
        expect(() =>
            store.projects.updateProject(p.id, 'default', { folders: [] })
        ).toThrow()
    })

    test('update 不存在的项目（即使 folders 非法）返回 null 而非抛错', () => {
        const result = store.projects.updateProject('nonexistent', 'default', {
            folders: []
        })
        expect(result).toBeNull()
    })

    test('跨 namespace 的 update 返回 null / delete 返回 false', () => {
        const p = store.projects.createProject({
            namespace: 'default',
            machineId: 'm1',
            name: 'a',
            folders: [{ path: '/a', primary: true }]
        })
        expect(store.projects.updateProject(p.id, 'other', { name: 'x' })).toBeNull()
        expect(store.projects.deleteProject(p.id, 'other')).toBe(false)
        // 原 namespace 下项目未被误删
        expect(store.projects.getProject(p.id)?.name).toBe('a')
    })

    test('删除不存在的项目返回 false', () => {
        expect(store.projects.deleteProject('nonexistent', 'default')).toBe(false)
    })

    // 依赖 Task 3 的 getOrCreateSession(..., projectId) 参数，届时补全实现启用
    it('删除项目 → 名下 sessions 解绑（project_id 置 NULL）', () => {
        const p = store.projects.createProject({
            namespace: 'default',
            machineId: 'm1',
            name: 'mobi',
            folders: [{ path: '/a/mobi', primary: true }]
        })
        const bound = store.sessions.getOrCreateSession(
            'proj-del-1', { path: '/a/mobi' }, null, 'default', undefined, p.id
        )
        expect(bound.projectId).toBe(p.id)

        expect(store.projects.deleteProject(p.id, 'default')).toBe(true)
        // 会话本身不删，仅解绑
        const after = store.sessions.getSession(bound.id)
        expect(after).not.toBeNull()
        expect(after?.projectId).toBeNull()
    })
})
