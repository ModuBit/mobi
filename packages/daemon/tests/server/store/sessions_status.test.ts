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

/**
 * 会话保留状态（session-retention 票 03）的 store 契约：
 * - status / status_updated_at / archived_at 三列同语句写（单一 setter）
 * - 归档写 archived_at，任何非归档迁移清空
 * - updated_at 不被保留状态迁移顶新（列表排序不受归档动作扰动）
 * - 启动自愈只回落「时间戳早于启动时刻」的 online 行
 */

import { describe, expect, it, beforeEach, afterEach } from 'bun:test'

import { Store } from '../../../src/store'

let store: Store

beforeEach(() => {
    store = new Store(':memory:')
})

afterEach(() => {
    store.close()
})

describe('setSessionStatus（唯一写入口）', () => {
    it('归档写 status + status_updated_at + archived_at，跨 namespace 返回 false', () => {
        const s = store.sessions.getOrCreateSession('status-1', { path: '/x' }, {}, 'default')

        expect(store.sessions.setSessionStatus(s.id, 'default', { status: 'archived', at: 1000 })).toBe(true)
        const row = store.sessions.getSession(s.id)
        expect(row?.status).toBe('archived')
        expect(row?.statusUpdatedAt).toBe(1000)
        expect(row?.archivedAt).toBe(1000)

        // namespace 不匹配 = 行不可见，写失败
        expect(store.sessions.setSessionStatus(s.id, 'other', { status: 'dormant' })).toBe(false)
    })

    it('非归档迁移清空 archived_at', () => {
        const s = store.sessions.getOrCreateSession('status-2', { path: '/x' }, {}, 'default')
        store.sessions.setSessionStatus(s.id, 'default', { status: 'archived', at: 1000 })

        expect(store.sessions.setSessionStatus(s.id, 'default', { status: 'online', at: 2000 })).toBe(true)
        const row = store.sessions.getSession(s.id)
        expect(row?.status).toBe('online')
        expect(row?.statusUpdatedAt).toBe(2000)
        expect(row?.archivedAt).toBeNull()
    })

    it('保留状态迁移不顶新 updated_at（列表排序不受归档动作扰动）', () => {
        const s = store.sessions.getOrCreateSession('status-3', { path: '/x' }, {}, 'default')
        const updatedAtBefore = store.sessions.getSession(s.id)?.updatedAt

        store.sessions.setSessionStatus(s.id, 'default', { status: 'archived', at: Date.now() })

        expect(store.sessions.getSession(s.id)?.updatedAt).toBe(updatedAtBefore)
    })

    it('新会话默认 dormant', () => {
        const s = store.sessions.getOrCreateSession('status-4', { path: '/x' }, {}, 'default')
        expect(store.sessions.getSession(s.id)?.status).toBe('dormant')
    })

    it('clearPinned 与归档同语句生效', () => {
        const s = store.sessions.getOrCreateSession('status-5', { path: '/x' }, {}, 'default')
        store.sessions.setSessionPinned(s.id, true, 'default')
        expect(store.sessions.getSession(s.id)?.pinned).toBe(true)

        store.sessions.setSessionStatus(s.id, 'default', { status: 'archived', clearPinned: true })
        expect(store.sessions.getSession(s.id)?.pinned).toBe(false)
    })
})

describe('主列表分页排除归档 + 归档列表（票 04）', () => {
    function seedList() {
        const ws = store.workspaces.createWorkspace({ namespace: 'default', name: 'ws', folders: [{ path: '/tmp/ws', primary: true }] })
        const normal = store.sessions.getOrCreateSession('list-normal', { path: '/x' }, {}, 'default', undefined, ws.id)
        const archived = store.sessions.getOrCreateSession('list-archived', { path: '/x' }, {}, 'default', undefined, ws.id)
        store.sessions.setSessionStatus(archived.id, 'default', { status: 'archived', at: 1000 })
        return { archivedId: archived.id, normalId: normal.id, workspaceId: ws.id }
    }

    it('工作区 / 最近 / 置顶三个分组都不含归档行', () => {
        const { archivedId, normalId, workspaceId } = seedList()

        const byWorkspace = store.sessions.getSessionsByWorkspace('default', workspaceId, null)
        expect(byWorkspace.sessions.map(s => s.id)).toEqual([normalId])

        const unbound = store.sessions.getUnboundSessions('default', null)
        expect(unbound.sessions.map(s => s.id)).not.toContain(archivedId)

        store.sessions.setSessionPinned(normalId, true, 'default')
        const pinned = store.sessions.getPinnedSessions('default', null)
        expect(pinned.sessions.map(s => s.id)).toEqual([normalId])
    })

    it('getArchivedSessions 分页：归档时间倒序、只含归档行、游标翻页、total 全集', () => {
        const a = store.sessions.getOrCreateSession('arc-a', { path: '/x' }, {}, 'default')
        const b = store.sessions.getOrCreateSession('arc-b', { path: '/x' }, {}, 'default')
        const c = store.sessions.getOrCreateSession('arc-c', { path: '/x' }, {}, 'default')
        const normal = store.sessions.getOrCreateSession('arc-normal', { path: '/x' }, {}, 'default')
        store.sessions.setSessionStatus(a.id, 'default', { status: 'archived', at: 1000 })
        store.sessions.setSessionStatus(b.id, 'default', { status: 'archived', at: 2000 })
        store.sessions.setSessionStatus(c.id, 'default', { status: 'archived', at: 3000 })

        // 首页（limit=2）：按 archived_at 倒序取前两条，total 是全集数
        const page1 = store.sessions.getArchivedSessions('default', undefined, null, 2)
        expect(page1.sessions.map(s => s.id)).toEqual([c.id, b.id])
        expect(page1.hasMore).toBe(true)
        expect(page1.nextCursor).toBe(2000)
        expect(page1.total).toBe(3)

        // 翻页：游标 = 上一页末行 archived_at
        const page2 = store.sessions.getArchivedSessions('default', undefined, page1.nextCursor, 2)
        expect(page2.sessions.map(s => s.id)).toEqual([a.id])
        expect(page2.hasMore).toBe(false)
        expect(page2.nextCursor).toBeNull()

        // 取消归档后立即从归档列表消失
        store.sessions.setSessionStatus(c.id, 'default', { status: 'dormant', at: 4000 })
        expect(store.sessions.getArchivedSessions('default', undefined, null, 50).sessions.map(s => s.id)).toEqual([b.id, a.id])
        expect(normal.status).toBe('dormant')
    })

    it('getArchivedWorkspaceCounts 按工作区聚合计数；getArchivedSessionIds 支持三态范围', () => {
        const wsA = store.workspaces.createWorkspace({ namespace: 'default', name: 'ws-a', folders: [{ path: '/tmp/a', primary: true }] })
        const wsB = store.workspaces.createWorkspace({ namespace: 'default', name: 'ws-b', folders: [{ path: '/tmp/b', primary: true }] })
        const a1 = store.sessions.getOrCreateSession('cnt-a1', { path: '/x' }, {}, 'default')
        const a2 = store.sessions.getOrCreateSession('cnt-a2', { path: '/x' }, {}, 'default')
        const b1 = store.sessions.getOrCreateSession('cnt-b1', { path: '/x' }, {}, 'default')
        const free = store.sessions.getOrCreateSession('cnt-free', { path: '/x' }, {}, 'default')
        store.sessions.setSessionWorkspace(a1.id, wsA.id, 'default')
        store.sessions.setSessionWorkspace(a2.id, wsA.id, 'default')
        store.sessions.setSessionWorkspace(b1.id, wsB.id, 'default')
        store.sessions.setSessionStatus(a1.id, 'default', { status: 'archived', at: 1000 })
        store.sessions.setSessionStatus(a2.id, 'default', { status: 'archived', at: 2000 })
        store.sessions.setSessionStatus(b1.id, 'default', { status: 'archived', at: 3000 })
        store.sessions.setSessionStatus(free.id, 'default', { status: 'archived', at: 4000 })

        const counts = store.sessions.getArchivedWorkspaceCounts('default')
        expect(counts).toContainEqual({ workspaceId: wsA.id, count: 2 })
        expect(counts).toContainEqual({ workspaceId: wsB.id, count: 1 })
        expect(counts).toContainEqual({ workspaceId: null, count: 1 })

        // 范围 id：全部 / 指定工作区 / 未归入（归档时间倒序）
        expect(store.sessions.getArchivedSessionIds('default')).toEqual([free.id, b1.id, a2.id, a1.id])
        expect(store.sessions.getArchivedSessionIds('default', wsA.id)).toEqual([a2.id, a1.id])
        expect(store.sessions.getArchivedSessionIds('default', null)).toEqual([free.id])

        // 项目过滤下推：指定工作区 / 未归入，各自分页且 total 是过滤全集
        const wsPage = store.sessions.getArchivedSessions('default', wsA.id, null, 50)
        expect(wsPage.sessions.map(s => s.id)).toEqual([a2.id, a1.id])
        expect(wsPage.total).toBe(2)
        const freePage = store.sessions.getArchivedSessions('default', null, null, 50)
        expect(freePage.sessions.map(s => s.id)).toEqual([free.id])
        expect(freePage.total).toBe(1)
    })
})

describe('删除墓碑（票 07）', () => {
    it('写入可查；native id 为 null 也落行；重复写覆盖', () => {
        store.sessions.addSessionTombstone({ sessionId: 't-1', nativeSessionId: 'native-1', deletedAt: 1000 })
        expect(store.sessions.getSessionTombstone('t-1')).toEqual({
            sessionId: 't-1', nativeSessionId: 'native-1', deletedAt: 1000,
        })

        // 未绑定 native id 的会话（未激活 fork 等）
        store.sessions.addSessionTombstone({ sessionId: 't-2', nativeSessionId: null, deletedAt: 2000 })
        expect(store.sessions.getSessionTombstone('t-2')?.nativeSessionId).toBeNull()

        // 行删除后墓碑仍在（独立表，不 cascade）
        const s = store.sessions.getOrCreateSession('t-3', { path: '/x' }, {}, 'default')
        store.sessions.addSessionTombstone({ sessionId: s.id, nativeSessionId: null, deletedAt: 3000 })
        store.sessions.deleteSession(s.id, 'default')
        expect(store.sessions.getSessionTombstone(s.id)?.deletedAt).toBe(3000)
        expect(store.sessions.getSession(s.id)).toBeNull()

        // 查不存在的墓碑
        expect(store.sessions.getSessionTombstone('nope')).toBeNull()
    })
})

describe('reconcileStartupSessionStatus（启动自愈）', () => {
    it('只回落时间戳早于启动时刻的 online 行；重连过的与 archived 行不动', () => {
        const stale = store.sessions.getOrCreateSession('recon-stale', { path: '/x' }, {}, 'default')
        const reconnected = store.sessions.getOrCreateSession('recon-live', { path: '/x' }, {}, 'default')
        const archived = store.sessions.getOrCreateSession('recon-archived', { path: '/x' }, {}, 'default')

        const startupAt = 10_000
        // 崩溃遗留：启动前最后一次迁移在启动时刻之前
        store.sessions.setSessionStatus(stale.id, 'default', { status: 'online', at: 9_000 })
        // 活会话：宽限期内重连，时间戳晚于启动时刻
        store.sessions.setSessionStatus(reconnected.id, 'default', { status: 'online', at: 11_000 })
        // 归档行：哪怕时间戳再早也不参与
        store.sessions.setSessionStatus(archived.id, 'default', { status: 'archived', at: 9_000 })

        const changed = store.sessions.reconcileStartupSessionStatus(startupAt, 12_000)

        expect(changed).toEqual([stale.id])
        expect(store.sessions.getSession(stale.id)?.status).toBe('dormant')
        expect(store.sessions.getSession(reconnected.id)?.status).toBe('online')
        expect(store.sessions.getSession(archived.id)?.status).toBe('archived')
    })

    it('时间戳为 NULL 的 online 行按崩溃遗留回落', () => {
        const s = store.sessions.getOrCreateSession('recon-null', { path: '/x' }, {}, 'default')
        store.sessions.setSessionStatus(s.id, 'default', { status: 'online' })
        // 人工把时间戳抹掉（模拟迁移期旧数据）
        store.getDatabaseForTesting().run(`UPDATE sessions SET status_updated_at = NULL WHERE id = '${s.id}'`)

        const changed = store.sessions.reconcileStartupSessionStatus(Date.now())

        expect(changed).toEqual([s.id])
        expect(store.sessions.getSession(s.id)?.status).toBe('dormant')
    })
})
