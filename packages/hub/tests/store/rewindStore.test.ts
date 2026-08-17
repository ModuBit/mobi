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

import { describe, test, expect, beforeEach } from 'bun:test'
import { Database } from 'bun:sqlite'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { Store } from '../../src/store'

/** webapp 用户消息内容（排队轨道来源；metadata 断言不依赖排队语义，仅保持真实信封） */
const WEBAPP_USER = { role: 'user', content: { type: 'text', text: 'hi' }, meta: { sentFrom: 'webapp' } }

describe('rewind store：metadata / attach / 软删除', () => {
    let store: Store
    let sid: string

    beforeEach(() => {
        store = new Store(':memory:')
        sid = store.sessions.getOrCreateSession('rewind-store-test', { path: '/tmp/x' }, null, 'default').id
    })

    describe('attachNativeSessionId', () => {
        test('只补缺 nativeSessionId 的行（幂等；已有归属不覆盖）', () => {
            store.messages.addMessage(sid, WEBAPP_USER, 'local-1')                                  // metadata NULL
            store.messages.addMessage(sid, WEBAPP_USER, 'local-2', 'persistent', { nativeId: 'u2' }) // 有 nativeId 缺 session
            store.messages.addMessage(sid, WEBAPP_USER, 'local-3', 'persistent',
                { nativeId: 'u3', nativeSessionId: 'old-sess' })                                    // 已归属，不得覆盖

            const attached = store.messages.attachNativeSessionId(sid, 'new-sess')
            expect(attached).toHaveLength(2)

            const rows = store.messages.getMessages(sid, 10)
            expect(rows.find(r => r.localId === 'local-1')?.metadata?.nativeSessionId).toBe('new-sess')
            expect(rows.find(r => r.localId === 'local-2')?.metadata?.nativeSessionId).toBe('new-sess')
            expect(rows.find(r => r.localId === 'local-2')?.metadata?.nativeId).toBe('u2')           // 补 session 不丢 nativeId
            expect(rows.find(r => r.localId === 'local-3')?.metadata?.nativeSessionId).toBe('old-sess')

            // 幂等：第二次全部已归属 → 无行可补
            expect(store.messages.attachNativeSessionId(sid, 'new-sess')).toHaveLength(0)
        })
    })

    describe('softDeleteMessagesFrom', () => {
        test('删 seq>= 锚点且未删的行，读取路径过滤，幂等', () => {
            for (let i = 1; i <= 5; i++) {
                store.messages.addMessage(sid, { ...WEBAPP_USER, content: { type: 'text', text: `m${i}` } }, `local-${i}`)
            }

            const deleted = store.messages.softDeleteMessagesFrom(sid, 3)
            expect(deleted).toBe(3) // seq 3,4,5

            // 读取路径全部过滤软删除行
            expect(store.messages.getMessages(sid, 10).map(r => r.seq)).toEqual([1, 2])
            expect(store.messages.getMessagesAfter(sid, 0).map(r => r.seq)).toEqual([1, 2])
            expect(store.messages.getUnsubmittedLocalMessages(sid).map(r => r.seq)).toEqual([1, 2])

            // 幂等：已删行不再计入
            expect(store.messages.softDeleteMessagesFrom(sid, 3)).toBe(0)
        })

        test('软删除后新增消息 seq 不回退（MAX(seq) 含已删行），且软删除行 deletedAt 可查', () => {
            for (let i = 1; i <= 3; i++) {
                store.messages.addMessage(sid, WEBAPP_USER, `local-${i}`)
            }
            store.messages.softDeleteMessagesFrom(sid, 2)

            const fresh = store.messages.addMessage(sid, WEBAPP_USER, 'local-4')
            expect(fresh.seq).toBe(4)
            expect(store.messages.getMessages(sid, 10).map(r => r.seq)).toEqual([1, 4])
        })
    })

    describe('bindNativeIds（metadata 形态）', () => {
        test('绑定空缺行并保留已有 nativeSessionId', () => {
            // 行内已有 nativeSessionId（message 事件先写入），bind 只补 nativeId
            store.messages.addMessage(sid, WEBAPP_USER, 'local-a', 'persistent', { nativeSessionId: 'ns-1' })
            store.messages.bindNativeIds(sid, [{ localId: 'local-a', metadata: { nativeId: 'uu-a', nativeSessionId: 'ns-2' } }])

            const row = store.messages.getMessages(sid, 10)[0]
            expect(row.metadata?.nativeId).toBe('uu-a')
            expect(row.metadata?.nativeSessionId).toBe('ns-1') // first-write-wins：session 不覆盖
        })
    })
})

describe('缺 metadata 列的存量库 → 启动报错引导人工补列', () => {
    let tmpDir: string
    let dbPath: string

    beforeEach(() => {
        tmpDir = mkdtempSync(join(tmpdir(), 'mobi-rewind-schema-'))
        dbPath = join(tmpDir, 'mobi.db')
    })

    test('（afterEach 由测试内 rmSync 兜底）报错文案含 ALTER TABLE 引导', () => {
        // 照 legacySchemaGuard.test.ts 模式：手建完整六表（含 native_id）但 messages 无 metadata/deleted_at 列
        const db = new Database(dbPath, { create: true, readwrite: true })
        db.run(`
            CREATE TABLE sessions (
                id TEXT PRIMARY KEY, tag TEXT,
                namespace TEXT NOT NULL DEFAULT 'default', machine_id TEXT,
                created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
                metadata TEXT, metadata_version INTEGER DEFAULT 1,
                agent_state TEXT, agent_state_version INTEGER DEFAULT 1,
                runtime_state TEXT, runtime_state_updated_at INTEGER,
                project_id TEXT, seq INTEGER DEFAULT 0
            );
            CREATE TABLE messages (
                id TEXT PRIMARY KEY, session_id TEXT NOT NULL, content TEXT NOT NULL,
                created_at INTEGER NOT NULL, seq INTEGER NOT NULL, local_id TEXT,
                native_id TEXT,
                is_sidechain INTEGER NOT NULL DEFAULT 0, parent_tool_use_id TEXT,
                category TEXT NOT NULL DEFAULT 'persistent', submitted_at INTEGER,
                queue_state TEXT, position_at INTEGER NOT NULL
            );
            CREATE TABLE machines (
                id TEXT PRIMARY KEY, namespace TEXT NOT NULL DEFAULT 'default',
                created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
                metadata TEXT, metadata_version INTEGER DEFAULT 1,
                runner_state TEXT, runner_state_version INTEGER DEFAULT 1,
                active INTEGER DEFAULT 0, active_at INTEGER, seq INTEGER DEFAULT 0
            );
            CREATE TABLE users (
                id INTEGER PRIMARY KEY AUTOINCREMENT, platform TEXT NOT NULL,
                platform_user_id TEXT NOT NULL, namespace TEXT NOT NULL DEFAULT 'default',
                created_at INTEGER NOT NULL, UNIQUE(platform, platform_user_id)
            );
            CREATE TABLE push_subscriptions (
                id INTEGER PRIMARY KEY AUTOINCREMENT, namespace TEXT NOT NULL,
                endpoint TEXT NOT NULL, p256dh TEXT NOT NULL, auth TEXT NOT NULL,
                created_at INTEGER NOT NULL, UNIQUE(namespace, endpoint)
            );
            CREATE TABLE projects (
                id TEXT PRIMARY KEY, namespace TEXT NOT NULL DEFAULT 'default',
                machine_id TEXT NOT NULL, name TEXT NOT NULL, folders TEXT NOT NULL,
                created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, seq INTEGER DEFAULT 0
            );
        `)
        db.run('PRAGMA user_version = 1')
        db.close()

        expect(() => new Store(dbPath)).toThrow(/ALTER TABLE messages ADD COLUMN metadata TEXT/)
        rmSync(tmpDir, { recursive: true, force: true })
    })
})
