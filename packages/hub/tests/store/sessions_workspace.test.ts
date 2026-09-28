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

describe('sessions 与 workspace 关联', () => {
    it('getOrCreateSession 带 workspaceId 写入归属', () => {
        const workspace = store.workspaces.createWorkspace({
            namespace: 'default', machineId: 'm1', name: 'mobi',
            folders: [{ path: '/a/mobi', primary: true }]
        })
        const s = store.sessions.getOrCreateSession('tag1', { path: '/a/mobi' }, {}, 'default', undefined, workspace.id)
        expect(s.workspaceId).toBe(workspace.id)
    })

    it('不带 workspaceId → 游离', () => {
        const s = store.sessions.getOrCreateSession('tag2', { path: '/x' }, {}, 'default')
        expect(s.workspaceId).toBeNull()
    })

    it('workspaceId 不存在 → 抛错', () => {
        expect(() => store.sessions.getOrCreateSession('tag3', { path: '/x' }, {}, 'default', undefined, 'nope'))
            .toThrow('Workspace not found: nope')
    })

    it('getSessionsByWorkspace 分页 + total；getUnboundSessions 只含游离', () => {
        const workspace = store.workspaces.createWorkspace({
            namespace: 'default', machineId: 'm1', name: 'mobi',
            folders: [{ path: '/a/mobi', primary: true }]
        })
        // 注：插入间隔 1ms 确保 updated_at 严格不同（同毫秒会让 `< cursor` 跳过所有同毫秒行）
        for (let i = 0; i < 3; i++) {
            store.sessions.getOrCreateSession(`t${i}`, { path: '/a/mobi' }, {}, 'default', undefined, workspace.id)
            Bun.sleepSync(1)
        }
        store.sessions.getOrCreateSession('free1', { path: '/x' }, {}, 'default')
        Bun.sleepSync(1)
        store.sessions.getOrCreateSession('free2', { path: '/y' }, {}, 'default')
        Bun.sleepSync(1)
        store.sessions.getOrCreateSession('free3', { path: '/z' }, {}, 'default')

        const inWorkspace = store.sessions.getSessionsByWorkspace('default', workspace.id, null, 2)
        expect(inWorkspace.sessions).toHaveLength(2)
        expect(inWorkspace.total).toBe(3)
        expect(inWorkspace.hasMore).toBe(true)

        // 第二页（cursor 路径）：剩余 1 条，total 仍为全集 3（不受 cursor 影响）
        const inWorkspacePage2 = store.sessions.getSessionsByWorkspace('default', workspace.id, inWorkspace.nextCursor, 2)
        expect(inWorkspacePage2.sessions).toHaveLength(1)
        expect(inWorkspacePage2.hasMore).toBe(false)
        expect(inWorkspacePage2.total).toBe(3)

        const unbound = store.sessions.getUnboundSessions('default', null, 20)
        expect(unbound.total).toBe(3)
        expect(unbound.sessions[0]?.workspaceId).toBeNull()

        // 游离会话第二页（cursor 路径）：剩余 1 条，total 仍为全集 3（不受 cursor 影响）
        const unboundPage1 = store.sessions.getUnboundSessions('default', null, 2)
        expect(unboundPage1.sessions).toHaveLength(2)
        expect(unboundPage1.hasMore).toBe(true)
        const unboundPage2 = store.sessions.getUnboundSessions('default', unboundPage1.nextCursor, 2)
        expect(unboundPage2.sessions).toHaveLength(1)
        expect(unboundPage2.hasMore).toBe(false)
        expect(unboundPage2.total).toBe(3)
    })

    it('cursor 页空结果时 total 仍报全集数（V5：翻页间隙 updated_at 被顶起的会话不丢「展开更多」）', () => {
        const workspace = store.workspaces.createWorkspace({
            namespace: 'default', machineId: 'm1', name: 'mobi',
            folders: [{ path: '/a/mobi', primary: true }]
        })
        for (let i = 0; i < 3; i++) {
            store.sessions.getOrCreateSession(`tv${i}`, { path: '/a/mobi' }, {}, 'default', undefined, workspace.id)
            Bun.sleepSync(1)
        }
        const page1 = store.sessions.getSessionsByWorkspace('default', workspace.id, null, 2)
        expect(page1.total).toBe(3)
        expect(page1.nextCursor).not.toBeNull()

        // 翻页间隙：剩余会话的 updated_at 被顶到 cursor 之上（如 metadata 更新）
        const remaining = store.sessions.getSessionsByNamespace('default')
            .filter(s => s.workspaceId === workspace.id)
            .slice(2)   // 第三条（page1 未加载）
        expect(remaining.length).toBe(1)
        store.sessions.updateSessionMetadata(remaining[0].id, { path: '/a/mobi', name: 'bumped' }, remaining[0].metadataVersion, 'default')

        // 下一页空结果：旧行为 total 归 0 → 前端 remainingCount=0、「展开更多」消失但会话没加载完
        const page2 = store.sessions.getSessionsByWorkspace('default', workspace.id, page1.nextCursor, 2)
        expect(page2.sessions).toHaveLength(0)
        expect(page2.total).toBe(3)
    })

    it('setSessionWorkspace 归入 / 解绑', () => {
        const workspace = store.workspaces.createWorkspace({
            namespace: 'default', machineId: 'm1', name: 'mobi',
            folders: [{ path: '/a/mobi', primary: true }]
        })
        const s = store.sessions.getOrCreateSession('tag9', { path: '/x' }, {}, 'default')
        expect(store.sessions.setSessionWorkspace(s.id, workspace.id, 'default')).toBe('changed')
        expect(store.sessions.getSession(s.id)?.workspaceId).toBe(workspace.id)
        expect(store.sessions.setSessionWorkspace(s.id, null, 'default')).toBe('changed')
        expect(store.sessions.getSession(s.id)?.workspaceId).toBeNull()
    })

    it('setSessionWorkspace 幂等：重归入同一工作区不递增 seq/updated_at', () => {
        const workspace = store.workspaces.createWorkspace({
            namespace: 'default', machineId: 'm1', name: 'mobi',
            folders: [{ path: '/a/mobi', primary: true }]
        })
        const s = store.sessions.getOrCreateSession('tag9b', { path: '/x' }, {}, 'default')
        expect(store.sessions.setSessionWorkspace(s.id, workspace.id, 'default')).toBe('changed')
        // 重归入同一工作区：noop，且 seq/updated_at 保持不变
        const before = store.sessions.getSession(s.id)!
        expect(store.sessions.setSessionWorkspace(s.id, workspace.id, 'default')).toBe('noop')
        const after = store.sessions.getSession(s.id)!
        expect(after.seq).toBe(before.seq)
        expect(after.updatedAt).toBe(before.updatedAt)
        // 幂等解绑：归属已是 null，再解绑仍是 noop
        expect(store.sessions.setSessionWorkspace(s.id, null, 'default')).toBe('changed')
        expect(store.sessions.setSessionWorkspace(s.id, null, 'default')).toBe('noop')
    })

    it('setSessionWorkspace 目标工作区不存在 / 跨 namespace / 会话不存在 → not_found', () => {
        const s = store.sessions.getOrCreateSession('tag10', { path: '/x' }, {}, 'default')
        expect(store.sessions.setSessionWorkspace(s.id, 'nope', 'default')).toBe('not_found')
        // 跨 namespace：工作区在 other，会话在 default
        const other = store.workspaces.createWorkspace({
            namespace: 'other', machineId: 'm1', name: 'y',
            folders: [{ path: '/y', primary: true }]
        })
        expect(store.sessions.setSessionWorkspace(s.id, other.id, 'default')).toBe('not_found')
        // 会话不存在
        expect(store.sessions.setSessionWorkspace('ghost', other.id, 'other')).toBe('not_found')
    })

    it('resume 复用：已存在 session 的 workspaceId 不变（合并分支不重算归属）', () => {
        const workspace = store.workspaces.createWorkspace({
            namespace: 'default', machineId: 'm1', name: 'mobi',
            folders: [{ path: '/a/mobi', primary: true }]
        })
        store.sessions.getOrCreateSession('tag11', { path: '/a/mobi' }, {}, 'default', undefined, workspace.id)
        // 同 tag 再调（模拟重连/resume），即使不带 workspaceId 也保留原归属
        const again = store.sessions.getOrCreateSession('tag11', { path: '/a/mobi' }, {}, 'default')
        expect(again.workspaceId).toBe(workspace.id)
    })
})
