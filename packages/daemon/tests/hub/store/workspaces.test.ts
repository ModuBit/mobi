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

import { Store } from '../../../src/store'

describe('WorkspaceStore', () => {
    let store: Store

    beforeEach(() => {
        store = new Store(':memory:')
    })

    afterEach(() => {
        store.close()
    })

    test('创建并读取工作区', () => {
        const p = store.workspaces.createWorkspace({
            namespace: 'default',
            machineId: 'm1',
            name: 'mobi',
            folders: [
                { path: '/a/mobi', primary: true },
                { path: '/a/shared', primary: false }
            ]
        })
        expect(p.id).toBeTruthy()
        expect(store.workspaces.getWorkspace(p.id)?.name).toBe('mobi')
        expect(store.workspaces.getWorkspace(p.id)?.folders).toHaveLength(2)
    })

    test('folders 非法时抛错（0 项 / 双 primary）', () => {
        expect(() =>
            store.workspaces.createWorkspace({
                namespace: 'default',
                machineId: 'm1',
                name: 'x',
                folders: []
            })
        ).toThrow()
        expect(() =>
            store.workspaces.createWorkspace({
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
        const a = store.workspaces.createWorkspace({
            namespace: 'default',
            machineId: 'm1',
            name: 'a',
            folders: [{ path: '/a', primary: true }]
        })
        const b = store.workspaces.createWorkspace({
            namespace: 'default',
            machineId: 'm1',
            name: 'b',
            folders: [{ path: '/b', primary: true }]
        })
        // 跨 namespace 的工作区不应出现
        store.workspaces.createWorkspace({
            namespace: 'other',
            machineId: 'm1',
            name: 'c',
            folders: [{ path: '/c', primary: true }]
        })
        // update a 拉开 updatedAt → a 应排在 b 前
        store.workspaces.updateWorkspace(a.id, 'default', { name: 'a2' })
        const list = store.workspaces.getWorkspaces('default')
        expect(list.map(p => p.id)).toEqual([a.id, b.id])
    })

    test('list 按「最近会话活动」排序——活跃工作区浮顶，无会话回退实体编辑时间（V7）', () => {
        const a = store.workspaces.createWorkspace({
            namespace: 'default', machineId: 'm1', name: 'a',
            folders: [{ path: '/a', primary: true }]
        })
        Bun.sleepSync(2)
        // b 实体更「新」（后建）——纯实体排序下 b 会钉在 a 上面
        store.workspaces.createWorkspace({
            namespace: 'default', machineId: 'm1', name: 'b',
            folders: [{ path: '/b', primary: true }]
        })
        Bun.sleepSync(2)
        // a 名下发生会话活动（updated_at = now，晚于 b 的实体 updatedAt）→ a 应浮顶
        store.sessions.getOrCreateSession('tag-v7', { path: '/a' }, {}, 'default', undefined, a.id)

        const list = store.workspaces.getWorkspaces('default')
        expect(list.map(p => p.id)[0]).toBe(a.id)
    })

    test('update 改名/改 folders 并递增 seq', () => {
        const p = store.workspaces.createWorkspace({
            namespace: 'default',
            machineId: 'm1',
            name: 'a',
            folders: [{ path: '/a', primary: true }]
        })
        const updated = store.workspaces.updateWorkspace(p.id, 'default', { name: 'a2' })
        expect(updated?.name).toBe('a2')
        expect(store.workspaces.getWorkspace(p.id)?.seq).toBeGreaterThan(p.seq)

        // folders patch 分支：替换文件夹列表并再次递增 seq
        const foldersUpdated = store.workspaces.updateWorkspace(p.id, 'default', {
            folders: [{ path: '/a/new', primary: true }]
        })
        expect(foldersUpdated?.folders).toEqual([{ path: '/a/new', primary: true }])
        expect(foldersUpdated?.seq).toBeGreaterThan(updated?.seq ?? 0)

        // folders patch 非法时抛错
        expect(() =>
            store.workspaces.updateWorkspace(p.id, 'default', { folders: [] })
        ).toThrow()
    })

    test('update 不存在的工作区（即使 folders 非法）返回 null 而非抛错', () => {
        const result = store.workspaces.updateWorkspace('nonexistent', 'default', {
            folders: []
        })
        expect(result).toBeNull()
    })

    test('跨 namespace 的 update 返回 null / delete 返回 false', () => {
        const p = store.workspaces.createWorkspace({
            namespace: 'default',
            machineId: 'm1',
            name: 'a',
            folders: [{ path: '/a', primary: true }]
        })
        expect(store.workspaces.updateWorkspace(p.id, 'other', { name: 'x' })).toBeNull()
        expect(store.workspaces.deleteWorkspace(p.id, 'other')).toBe(false)
        // 原 namespace 下工作区未被误删
        expect(store.workspaces.getWorkspace(p.id)?.name).toBe('a')
    })

    test('删除不存在的工作区返回 false', () => {
        expect(store.workspaces.deleteWorkspace('nonexistent', 'default')).toBe(false)
    })

    // 依赖 Task 3 的 getOrCreateSession(..., workspaceId) 参数，届时补全实现启用
    it('删除工作区 → 名下 sessions 解绑（workspace_id 置 NULL），返回受影响 id 与解绑一致', () => {
        const p = store.workspaces.createWorkspace({
            namespace: 'default',
            machineId: 'm1',
            name: 'mobi',
            folders: [{ path: '/a/mobi', primary: true }]
        })
        const bound1 = store.sessions.getOrCreateSession(
            'proj-del-1', { path: '/a/mobi' }, null, 'default', undefined, p.id
        )
        const bound2 = store.sessions.getOrCreateSession(
            'proj-del-2', { path: '/a/mobi' }, null, 'default', undefined, p.id
        )
        // 游离会话不受影响
        store.sessions.getOrCreateSession('proj-del-free', { path: '/x' }, null, 'default')
        expect(bound1.workspaceId).toBe(p.id)

        const affected = store.workspaces.deleteWorkspace(p.id, 'default')
        // 返回的 id 列表 = 事务内实际解绑的会话，游离会话不在其中
        expect(affected !== false && [...affected].sort()).toEqual([bound1.id, bound2.id].sort())

        // 会话本身不删，仅解绑
        const after = store.sessions.getSession(bound1.id)
        expect(after).not.toBeNull()
        expect(after?.workspaceId).toBeNull()
        expect(store.sessions.getSession(bound2.id)?.workspaceId).toBeNull()
    })
})
