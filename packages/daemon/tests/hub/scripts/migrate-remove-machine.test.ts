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

// remove-machine 403：scripts/migrate-remove-machine.ts 的行为约定——
// ①旧结构库（402 前形状，测试内手写 DDL）迁移后 sessions/workspaces 无 machine_id、
//   machines 表删除、数据行全保留、索引重建；
// ②daemon.state.json 存在 → 拒跑不改库；
// ③幂等：重跑全部 skipped、status ok；
// ④迁移后新 Store 可打开（红→绿的「迁移前新二进制拒启、迁移后可启」由
//   legacySchemaGuard 的 machine_id 引导检测与本文件共同锁定）。

import { describe, expect, it, beforeEach, afterEach } from 'bun:test'
import { Database } from 'bun:sqlite'
import { mkdtempSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { migrateDb } from '../../../../../scripts/migrate-remove-machine'
import { Store } from '../../../src/store'

let tmpDir: string
let dbPath: string

beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'mobi-migrate-remove-machine-'))
    dbPath = join(tmpDir, 'mobi.db')
})

afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true })
})

/** 造一个「402 前旧结构」库：sessions/workspaces 带 machine_id 列 + machines 表 + 混合数据 */
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
            workspace_id TEXT,
            pinned INTEGER DEFAULT 0,
            seq INTEGER DEFAULT 0
        );
        CREATE INDEX idx_sessions_tag ON sessions(tag);
        CREATE INDEX idx_sessions_tag_namespace ON sessions(tag, namespace);
        CREATE INDEX idx_sessions_workspace ON sessions(workspace_id);
        CREATE TABLE machines (
            id TEXT PRIMARY KEY,
            namespace TEXT NOT NULL DEFAULT 'default',
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL
        );
        CREATE INDEX idx_machines_namespace ON machines(namespace);
        CREATE TABLE workspaces (
            id TEXT PRIMARY KEY,
            namespace TEXT NOT NULL DEFAULT 'default',
            machine_id TEXT NOT NULL,
            name TEXT NOT NULL,
            folders TEXT NOT NULL,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL,
            seq INTEGER DEFAULT 0
        );
        CREATE INDEX idx_workspaces_namespace ON workspaces(namespace);
        CREATE INDEX idx_workspaces_machine ON workspaces(machine_id);
        CREATE TABLE messages (
            id TEXT PRIMARY KEY,
            session_id TEXT NOT NULL,
            content TEXT NOT NULL,
            created_at INTEGER NOT NULL,
            seq INTEGER NOT NULL,
            metadata TEXT,
            native_id TEXT GENERATED ALWAYS AS (json_extract(metadata, '$.nativeId')) STORED,
            position_at INTEGER NOT NULL,
            FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
        );
        CREATE TABLE push_subscriptions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            namespace TEXT NOT NULL,
            endpoint TEXT NOT NULL,
            p256dh TEXT NOT NULL,
            auth TEXT NOT NULL,
            created_at INTEGER NOT NULL,
            UNIQUE(namespace, endpoint)
        );
        PRAGMA user_version = 1;
    `)
    const now = Date.now()
    db.run('INSERT INTO machines (id, namespace, created_at, updated_at) VALUES (?, ?, ?, ?)', ['m-local', 'default', now, now])
    for (const id of ['ws-a', 'ws-b']) {
        db.run(
            'INSERT INTO workspaces (id, namespace, machine_id, name, folders, created_at, updated_at, seq) VALUES (?, ?, ?, ?, ?, ?, ?, 0)',
            [id, 'default', 'm-local', id, '[]', now, now]
        )
    }
    for (const id of ['sess-a', 'sess-b']) {
        db.run(
            'INSERT INTO sessions (id, namespace, machine_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
            [id, 'default', 'm-local', now, now]
        )
        db.run(
            'INSERT INTO messages (id, session_id, content, created_at, seq, position_at) VALUES (?, ?, ?, ?, 1, ?)',
            [`msg-${id}`, id, '{}', now, now]
        )
    }
    db.close()
}

function columnNames(db: Database, table: string): Set<string> {
    return new Set((db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map((c) => c.name))
}

describe('migrate-remove-machine', () => {
    it('旧结构库迁移：machine_id 列与 machines 表删除，数据全保留，索引重建', () => {
        createLegacyDb()

        const result = migrateDb(dbPath, { confirm: false })
        expect(result.status).toBe('ok')
        expect(result.rebuiltWorkspaces).toBe(true)
        expect(result.rebuiltSessions).toBe(true)
        expect(result.droppedMachinesTable).toBe(true)

        const db = new Database(dbPath, { readonly: true })
        // 新结构：无 machine_id 列、无 machines 表、旧 machine 索引随表/重建消失
        expect(columnNames(db, 'sessions').has('machine_id')).toBe(false)
        expect(columnNames(db, 'workspaces').has('machine_id')).toBe(false)
        const objectExists = (name: string): boolean =>
            Boolean(db.prepare("SELECT name FROM sqlite_master WHERE name = ?").get(name))
        expect(objectExists('machines')).toBe(false)
        expect(objectExists('idx_workspaces_machine')).toBe(false)
        // 数据行全保留
        expect((db.prepare('SELECT COUNT(*) AS c FROM sessions').get() as { c: number }).c).toBe(2)
        expect((db.prepare('SELECT COUNT(*) AS c FROM workspaces').get() as { c: number }).c).toBe(2)
        expect((db.prepare('SELECT COUNT(*) AS c FROM messages').get() as { c: number }).c).toBe(2)
        // 索引重建
        expect(objectExists('idx_sessions_tag')).toBe(true)
        expect(objectExists('idx_sessions_tag_namespace')).toBe(true)
        expect(objectExists('idx_sessions_workspace')).toBe(true)
        expect(objectExists('idx_workspaces_namespace')).toBe(true)
        // 版本号保持 1
        expect((db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version).toBe(1)
        db.close()
    })

    it('迁移后新 Store 可打开（迁移前会被 402 引导检测拒启）', () => {
        createLegacyDb()

        // 红：旧结构库新代码拒启（引导检测，见 legacySchemaGuard）
        expect(() => new Store(dbPath)).toThrow(/migrate-remove-machine/)

        migrateDb(dbPath, { confirm: false })

        // 绿：迁移后可启
        const store = new Store(dbPath)
        expect(store.workspaces.getWorkspaces('default')).toHaveLength(2)
        store.close()
    })

    it('daemon.state.json 存在 → 拒跑不改库', () => {
        createLegacyDb()
        writeFileSync(join(tmpDir, 'daemon.state.json'), '{}')

        const result = migrateDb(dbPath, { confirm: false })
        expect(result.status).toBe('refused')

        // 库未被改动（machine_id 列仍在）
        const db = new Database(dbPath, { readonly: true })
        expect(columnNames(db, 'sessions').has('machine_id')).toBe(true)
        db.close()
    })

    it('幂等：迁移后重跑全部 skipped、status ok', () => {
        createLegacyDb()
        migrateDb(dbPath, { confirm: false })

        const again = migrateDb(dbPath, { confirm: false })
        // 票面口径：列/表已不存在 → 整体 skipped（exit 0，不算失败）
        expect(again.status).toBe('skipped')
    })

    it('备份落盘：迁移后同目录存在 .bak 文件', () => {
        createLegacyDb()
        migrateDb(dbPath, { confirm: false })

        expect(existsSync(`${dbPath}.bak-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}`)).toBe(true)
    })

    it('库不存在 → skipped（不算失败）', () => {
        const result = migrateDb(join(tmpDir, 'nope.db'), { confirm: false })
        expect(result.status).toBe('skipped')
    })
})
