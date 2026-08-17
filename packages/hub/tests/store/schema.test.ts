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

import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { mkdtempSync, rmSync } from 'node:fs'
import { describe, test, expect } from 'bun:test'
import { Database } from 'bun:sqlite'

import { Store } from '../../src/store'

describe('Store schema 初始化', () => {
    function createTempDir(): string {
        return mkdtempSync(join(tmpdir(), 'mobi-schema-test-'))
    }

    test('全新数据库自动创建 schema 并可正常操作', () => {
        const dir = createTempDir()
        const dbPath = join(dir, 'test.db')
        try {
            const store = new Store(dbPath)
            // 验证 schema 已创建：可正常写入和读取
            const session = store.sessions.getOrCreateSession('schema-tag', null, null, 'default')
            expect(session.id).toBeTruthy()
            const msg = store.messages.addMessage(session.id, { text: 'hello' })
            expect(msg.seq).toBe(1)
            store.close()
        } finally {
            rmSync(dir, { recursive: true, force: true })
        }
    })

    test('schema version 不匹配时抛出错误（baseline=0 提示未发布）', () => {
        const dir = createTempDir()
        const dbPath = join(dir, 'mismatch.db')
        try {
            // 预设一个 user_version 不匹配的数据库
            const db = new Database(dbPath, { create: true })
            db.run('CREATE TABLE sessions (id TEXT PRIMARY KEY)')
            db.run('PRAGMA user_version = 999')
            db.close()

            expect(() => new Store(dbPath)).toThrow(
                /schema version mismatch.*unreleased schema/
            )
        } finally {
            rmSync(dir, { recursive: true, force: true })
        }
    })

    test('user_version 匹配但缺少必需表时抛出错误', () => {
        const dir = createTempDir()
        const dbPath = join(dir, 'missing-tables.db')
        try {
            // 只创建部分表，但 user_version 与 SCHEMA_VERSION 匹配
            const db = new Database(dbPath, { create: true })
            db.run('CREATE TABLE sessions (id TEXT PRIMARY KEY)')
            db.run('PRAGMA user_version = 2') // 匹配当前 SCHEMA_VERSION
            db.close()

            expect(() => new Store(dbPath)).toThrow(/missing required tables/)
        } finally {
            rmSync(dir, { recursive: true, force: true })
        }
    })

    test(':memory: 数据库正常创建并关闭', () => {
        const store = new Store(':memory:')
        // 基本操作验证
        const session = store.sessions.getOrCreateSession('mem-tag', null, null, 'default')
        expect(session.id).toBeTruthy()
        store.close()
    })
})
