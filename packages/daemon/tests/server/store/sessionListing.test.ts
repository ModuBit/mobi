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

    it('排除归档、缺 native id、缺 path 的行', () => {
        const db = createDb()
        insert(db, { id: 'ok', metadata: { path: '/ok', nativeSessionId: 'native-ok' } })
        insert(db, { id: 'archived', status: 'archived', metadata: { path: '/x', nativeSessionId: 'n1' } })
        insert(db, { id: 'no-native', metadata: { path: '/x' } })
        insert(db, { id: 'no-path', metadata: { nativeSessionId: 'n2' } })

        expect(listForkableSessionsFromDb(db, 'default').map(s => s.id)).toEqual(['ok'])
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
