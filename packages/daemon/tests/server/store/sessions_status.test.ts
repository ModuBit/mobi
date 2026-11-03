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
