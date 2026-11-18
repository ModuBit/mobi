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
 * `mobi fork` 的只读会话清单契约（tui-fork 票 01）：
 * 排序、状态过滤、native id/path 缺失排除、namespace 隔离、旧 schema 的显式失败。
 */

import { describe, expect, it } from 'bun:test'
import { Database } from 'bun:sqlite'
import {
    listForkableSessionsFromDb,
    SessionListingError
} from '../../../src/store/sessionListing'

type RowInput = {
    id: string
    namespace?: string
    updatedAt?: number
    status?: 'online' | 'dormant' | 'archived'
    metadata?: Record<string, unknown> | null
    endState?: Record<string, unknown> | null
}

function createDb(): Database {
    const db = new Database(':memory:')
    db.run(`
        CREATE TABLE sessions (
            id TEXT PRIMARY KEY,
            namespace TEXT NOT NULL DEFAULT 'default',
            updated_at INTEGER NOT NULL,
            metadata TEXT,
            status TEXT NOT NULL DEFAULT 'dormant',
            end_state TEXT
        )
    `)
    return db
}

function insert(db: Database, row: RowInput): void {
    db.query(
        `INSERT INTO sessions (id, namespace, updated_at, metadata, status, end_state)
         VALUES (?, ?, ?, ?, ?, ?)`
    ).run(
        row.id,
        row.namespace ?? 'default',
        row.updatedAt ?? 1000,
        row.metadata === undefined ? JSON.stringify({ path: '/work', nativeSessionId: `native-${row.id}` }) : JSON.stringify(row.metadata),
        row.status ?? 'dormant',
        row.endState === undefined ? null : JSON.stringify(row.endState)
    )
}

describe('listForkableSessionsFromDb', () => {
    it('按 updated_at 倒序返回可 fork 会话，并回填标题与 native id', () => {
        const db = createDb()
        insert(db, {
            id: 'a',
            updatedAt: 100,
            metadata: { path: '/a', nativeSessionId: 'native-a', name: '会话 A' }
        })
        insert(db, {
            id: 'b',
            updatedAt: 300,
            metadata: { path: '/b', nativeSessionId: 'native-b', summary: { text: '会话 B' } }
        })

        const result = listForkableSessionsFromDb(db, 'default')

        expect(result.map(s => s.id)).toEqual(['b', 'a'])
        expect(result[0]).toMatchObject({ title: '会话 B', path: '/b', nativeSessionId: 'native-b' })
        expect(result[1]).toMatchObject({ title: '会话 A', path: '/a', nativeSessionId: 'native-a' })
        expect(result.every(s => s.status === 'dormant')).toBe(true)
    })

    it('保留 online 与 dormant 两种状态', () => {
        const db = createDb()
        insert(db, { id: 'online', status: 'online' })
        insert(db, { id: 'dormant', status: 'dormant' })

        expect(listForkableSessionsFromDb(db, 'default').map(s => [s.id, s.status])).toEqual([
            ['online', 'online'],
            ['dormant', 'dormant']
        ])
    })

    it('排除归档与缺 path 的行；native id 未就绪的行保留（nativeSessionId 为 null）', () => {
        const db = createDb()
        insert(db, { id: 'ok', metadata: { path: '/ok', nativeSessionId: 'native-ok' } })
        insert(db, { id: 'archived', status: 'archived', metadata: { path: '/x', nativeSessionId: 'n1' } })
        insert(db, { id: 'no-native', metadata: { path: '/x' } })
        insert(db, { id: 'no-path', metadata: { nativeSessionId: 'n2' } })

        // native id 未就绪（SDK 尚未回报）的行不再静默丢弃：sessions list 要能看到它、拿到 id 去 stop
        expect(listForkableSessionsFromDb(db, 'default').map(s => [s.id, s.nativeSessionId])).toEqual([
            ['ok', 'native-ok'],
            ['no-native', null]
        ])
    })

    it('标题取值与 Web 展示一致：非 fork 行 summary.text 优先于 name', () => {
        const db = createDb()
        // 场景：先重命名（写 name 清 summary）后 summary 事件回填——Web 显示 summary.text，
        // 用户照 Web 标题 `mobi fork "<标题>"`，投影若 name 优先则三段匹配落空
        insert(db, {
            id: 'renamed',
            metadata: { path: '/w', nativeSessionId: 'n', name: '旧命名', summary: { text: 'Web 显示的动态摘要' } }
        })

        expect(listForkableSessionsFromDb(db, 'default')[0]?.title).toBe('Web 显示的动态摘要')
    })

    it('fork 行（forkedFrom / forkFrom 在场）标题 name 优先，无 name 降级 path 基名', () => {
        const db = createDb()
        insert(db, {
            id: 'fork-activated',
            metadata: {
                path: '/w/fork-a', nativeSessionId: 'n1',
                name: '父会话 · 分叉', summary: { text: 'fork 自身摘要' },
                forkedFrom: { sessionId: 'parent-1' }
            }
        })
        insert(db, {
            id: 'fork-pending',
            metadata: {
                path: '/w/fork-b', nativeSessionId: 'n2',
                name: '待激活 · 分叉', summary: { text: '继承的摘要' },
                forkFrom: { parentSessionId: 'parent-1', parentNativeId: 'pn', anchorNativeId: 'an' }
            }
        })
        insert(db, {
            id: 'fork-unnamed',
            metadata: { path: '/w/fork-c', nativeSessionId: 'n3', forkedFrom: { sessionId: 'parent-1' } }
        })

        const titles = new Map(listForkableSessionsFromDb(db, 'default').map(s => [s.id, s.title]))
        expect(titles.get('fork-activated')).toBe('父会话 · 分叉')
        expect(titles.get('fork-pending')).toBe('待激活 · 分叉')
        expect(titles.get('fork-unnamed')).toBe('fork-c')
    })

    it('排除已终结会话，保留可唤醒的 pause', () => {
        const db = createDb()
        insert(db, { id: 'paused', endState: { reason: 'pause', pauseTrigger: 'idle_timeout' } })
        insert(db, { id: 'stopped', endState: { reason: 'stop' } })
        insert(db, { id: 'crashed', endState: { reason: 'crash' } })

        expect(listForkableSessionsFromDb(db, 'default').map(s => s.id)).toEqual(['paused'])
    })

    it('按 namespace 隔离', () => {
        const db = createDb()
        insert(db, { id: 'mine', namespace: 'default' })
        insert(db, { id: 'other', namespace: 'team' })

        expect(listForkableSessionsFromDb(db, 'default').map(s => s.id)).toEqual(['mine'])
        expect(listForkableSessionsFromDb(db, 'team').map(s => s.id)).toEqual(['other'])
    })

    it('metadata 非法 JSON 的行跳过而不是整体失败', () => {
        const db = createDb()
        db.query(
            `INSERT INTO sessions (id, namespace, updated_at, metadata, status, end_state)
             VALUES ('bad', 'default', 1, '{not-json', 'dormant', NULL)`
        ).run()
        insert(db, { id: 'good' })

        expect(listForkableSessionsFromDb(db, 'default').map(s => s.id)).toEqual(['good'])
    })

    it('schema 缺列时给出可操作的显式错误', () => {
        const db = new Database(':memory:')
        db.run('CREATE TABLE sessions (id TEXT PRIMARY KEY, namespace TEXT, metadata TEXT, status TEXT)')

        expect(() => listForkableSessionsFromDb(db, 'default')).toThrow(SessionListingError)
        expect(() => listForkableSessionsFromDb(db, 'default')).toThrow(/schema 过旧/)
    })

    it('缺 sessions 表时给出初始化提示', () => {
        const db = new Database(':memory:')

        expect(() => listForkableSessionsFromDb(db, 'default')).toThrow(SessionListingError)
        expect(() => listForkableSessionsFromDb(db, 'default')).toThrow(/缺少 sessions 表/)
    })
})
