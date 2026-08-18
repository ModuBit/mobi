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
import { Database } from 'bun:sqlite'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Store } from '../../src/store'

/**
 * V1（code-review）：存量旧 schema 库（user_version 与当前 SCHEMA_VERSION 相同、sessions 带 group_key、无 projects 表）
 * 必须在 initSchema 阶段被明确拒绝并引导到迁移脚本，
 * 而不是放行后在 ProjectCache.warmup 的 SELECT * FROM projects 处崩溃。
 * 注：BASELINE=0 未发布期版本号无法区分新旧 schema，列存在性是唯一判别器，故 fixture 钉当前版本号。
 */

let tmpDir: string
let dbPath: string

beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'mobi-legacy-schema-'))
    dbPath = join(tmpDir, 'mobi.db')
})

afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true })
})

/** 造一个「项目实体化之前」的旧库：五张旧表、sessions 带 group_key、user_version 钉当前 SCHEMA_VERSION */
function createLegacyDb(): void {
    const db = new Database(dbPath, { create: true, readwrite: true })
    db.run(`
        CREATE TABLE sessions (
            id TEXT PRIMARY KEY,
            tag TEXT,
            namespace TEXT NOT NULL DEFAULT 'default',
            machine_id TEXT,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL,
            metadata TEXT,
            metadata_version INTEGER DEFAULT 1,
            agent_state TEXT,
            agent_state_version INTEGER DEFAULT 1,
            runtime_state TEXT,
            runtime_state_updated_at INTEGER,
            group_key TEXT,
            seq INTEGER DEFAULT 0
        );
        CREATE TABLE machines (
            id TEXT PRIMARY KEY,
            namespace TEXT NOT NULL DEFAULT 'default',
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL,
            metadata TEXT,
            metadata_version INTEGER DEFAULT 1,
            runner_state TEXT,
            runner_state_version INTEGER DEFAULT 1,
            active INTEGER DEFAULT 0,
            active_at INTEGER,
            seq INTEGER DEFAULT 0
        );
        CREATE TABLE messages (
            id TEXT PRIMARY KEY,
            session_id TEXT NOT NULL,
            content TEXT NOT NULL,
            created_at INTEGER NOT NULL,
            seq INTEGER NOT NULL,
            local_id TEXT,
            is_sidechain INTEGER NOT NULL DEFAULT 0,
            parent_tool_use_id TEXT,
            category TEXT NOT NULL DEFAULT 'persistent',
            submitted_at INTEGER,
            queue_state TEXT,
            position_at INTEGER NOT NULL,
            FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
        );
        CREATE TABLE users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            platform TEXT NOT NULL,
            platform_id TEXT NOT NULL UNIQUE
        );
        CREATE TABLE push_subscriptions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            endpoint TEXT NOT NULL UNIQUE
        );
    `)
    db.run('PRAGMA user_version = 1')
    db.close()
}

describe('legacy schema guard', () => {
    it('旧 group_key schema 库 → 启动即报错并引导到迁移脚本', () => {
        createLegacyDb()

        expect(() => new Store(dbPath)).toThrow(/migrate-projects/)
    })

    it('缺 projects 表的库 → 报错含迁移脚本提示', () => {
        createLegacyDb()
        // 手动补 project_id 列，只留「缺 projects 表」一种缺陷
        const db = new Database(dbPath, { create: true, readwrite: true })
        db.run('ALTER TABLE sessions ADD COLUMN project_id TEXT')
        db.close()

        expect(() => new Store(dbPath)).toThrow(/migrate-projects/)
    })

    it('缺 native_id 列的库（项目实体化之后、native_id 之前）→ 报错并引导手动补列', () => {
        // 用当前 Store 建库（含 projects/project_id），再删列模拟旧库——SQLite 不支持 DROP COLUMN 前的
        // 简化：直接建一个「无 native_id 但有 project_id」的库
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

        expect(() => new Store(dbPath)).toThrow(/ALTER TABLE messages ADD COLUMN native_id/)
    })

    it('native_id 为普通 TEXT 列（Phase 1 遗留）→ 报错引导重建为生成列', () => {
        // 存量库 native_id 是普通 TEXT 列（早期 ADD COLUMN 建列，非生成列）：列存在但 hidden=0，
        // 放行会导致只写 metadata 不写 native_id、markMessagesAcked 永不命中、ack 静默失效
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
                metadata TEXT, deleted_at INTEGER,
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

        expect(() => new Store(dbPath)).toThrow(/not a STORED generated column/)
    })

    it('全新库正常初始化（projects 表就位）', () => {
        const store = new Store(dbPath)
        // projects 表存在且可用
        const project = store.projects.createProject({
            namespace: 'default', machineId: 'm1', name: 'x',
            folders: [{ path: '/a', primary: true }]
        })
        expect(store.projects.getProject(project.id)?.name).toBe('x')
        store.close()
    })
})
