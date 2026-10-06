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

// ticket-24（personal-agent-rewrite）：scripts/migrate-personal-agent.ts 的行为约定——
// ①删 users 表（无消费方，纯结构清理）；②兜底删除 machine_id ≠ 本机（settings.cli.json）的
// machines/workspaces/sessions 行（sessions.machine_id 为 NULL 的保留），删除前须 --confirm；
// ③幂等（重跑无副作用）。脚本核心逻辑导出为 migrateDb 函数供测试。

import { describe, expect, it, beforeEach, afterEach } from 'bun:test'
import { Database } from 'bun:sqlite'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { migrateDb } from '../../../../../scripts/migrate-personal-agent'
import { Store } from '../../../src/store'

const LOCAL_MACHINE = 'local-machine-id'
const FOREIGN_MACHINE = 'foreign-machine-id'

let tmpDir: string
let dbPath: string

beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'mobi-migrate-personal-agent-'))
    dbPath = join(tmpDir, 'mobi.db')
    // 本机 machineId 从库同目录的 settings.cli.json 读取（与生产目录布局一致）
    writeFileSync(join(tmpDir, 'settings.cli.json'), JSON.stringify({ machineId: LOCAL_MACHINE }))
})

afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true })
})

/** 建一个「含 users/machines 表 + machine_id 列」的库：用当前 Store 建新 schema，
 *  再手动补旧结构（模拟 402 前的存量库——migrate-personal-agent 的处理对象） */
function createFixtureDb(): void {
    const store = new Store(dbPath)
    const db = store.getDatabaseForTesting()
    db.run(`
        ALTER TABLE sessions ADD COLUMN machine_id TEXT;
        ALTER TABLE workspaces ADD COLUMN machine_id TEXT NOT NULL DEFAULT '';
        CREATE TABLE machines (
            id TEXT PRIMARY KEY,
            namespace TEXT NOT NULL DEFAULT 'default',
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL
        );
        CREATE INDEX idx_machines_namespace ON machines(namespace);
        CREATE TABLE users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            platform TEXT NOT NULL,
            platform_user_id TEXT NOT NULL,
            namespace TEXT NOT NULL DEFAULT 'default',
            created_at INTEGER NOT NULL,
            UNIQUE(platform, platform_user_id)
        )
    `)
    const now = Date.now()
    // 机器：本机 1 + 他机 1
    db.run('INSERT INTO machines (id, namespace, created_at, updated_at) VALUES (?, ?, ?, ?)', [LOCAL_MACHINE, 'default', now, now])
    db.run('INSERT INTO machines (id, namespace, created_at, updated_at) VALUES (?, ?, ?, ?)', [FOREIGN_MACHINE, 'default', now, now])
    // 工作区：本机 2 + 他机 1
    for (const [id, machine] of [['ws-local-a', LOCAL_MACHINE], ['ws-local-b', LOCAL_MACHINE], ['ws-foreign', FOREIGN_MACHINE]] as const) {
        db.run(
            'INSERT INTO workspaces (id, namespace, machine_id, name, folders, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
            [id, 'default', machine, id, '[]', now, now]
        )
    }
    // 会话：本机 2 + 他机 1 + machine_id NULL 1（游离会话，保留）
    const sessions: Array<[string, string | null]> = [
        ['sess-local-a', LOCAL_MACHINE],
        ['sess-local-b', LOCAL_MACHINE],
        ['sess-foreign', FOREIGN_MACHINE],
        ['sess-orphan', null]
    ]
    for (const [id, machine] of sessions) {
        db.run('INSERT INTO sessions (id, created_at, updated_at) VALUES (?, ?, ?)', [id, now, now])
        if (machine) {
            db.run('UPDATE sessions SET machine_id = ? WHERE id = ?', [machine, id])
        }
    }
    // 消息：本机会话 2 + 他机会话 2（随 sessions 级联删除）
    for (const [id, sessionId] of [
        ['msg-local-1', 'sess-local-a'],
        ['msg-local-2', 'sess-local-b'],
        ['msg-foreign-1', 'sess-foreign'],
        ['msg-foreign-2', 'sess-foreign']
    ] as const) {
        db.run(
            'INSERT INTO messages (id, session_id, content, created_at, seq, position_at) VALUES (?, ?, ?, ?, ?, ?)',
            [id, sessionId, '{}', now, 1, now]
        )
    }
    db.run("INSERT INTO users (platform, platform_user_id, created_at) VALUES ('feishu', 'u1', ?)", [now])
    store.close()
}

function counts(db: Database): Record<string, number> {
    // 表可能已被迁移删除（users）：先查 sqlite_master，不存在记 0
    const table = (name: string): number => {
        const exists = (db.prepare(
            "SELECT COUNT(*) AS c FROM sqlite_master WHERE type = 'table' AND name = ?"
        ).get(name) as { c: number }).c
        return exists ? (db.prepare(`SELECT COUNT(*) AS c FROM ${name}`).get() as { c: number }).c : 0
    }
    return {
        users: table('users'),
        machines: table('machines'),
        workspaces: table('workspaces'),
        sessions: table('sessions'),
        messages: table('messages')
    }
}

describe('migrate-personal-agent（ticket-24 DB 结构清理）', () => {
    it('他机行 + --confirm：删 users 表与他机行，本机行与 NULL machine_id 会话保留，他机会话消息级联删除', () => {
        createFixtureDb()

        const result = migrateDb(dbPath, { confirm: true })
        expect(result.status).toBe('ok')
        expect(result.droppedUsersTable).toBe(true)
        expect(result.deletedMachines).toBe(1)
        expect(result.deletedWorkspaces).toBe(1)
        expect(result.deletedSessions).toBe(1)
        expect(result.cascadedMessages).toBe(2)

        const db = new Database(dbPath, { readonly: true })
        expect(counts(db)).toEqual({
            users: 0,
            machines: 1,
            workspaces: 2,
            sessions: 3,
            messages: 2
        })
        expect(db.prepare('SELECT id FROM sessions ORDER BY id').all().map((r) => (r as { id: string }).id))
            .toEqual(['sess-local-a', 'sess-local-b', 'sess-orphan'])
        // users 表已不存在（行数查询来自 sqlite_master 判定）
        expect(db.prepare("SELECT COUNT(*) AS c FROM sqlite_master WHERE type = 'table' AND name = 'users'").get())
            .toEqual({ c: 0 })
        db.close()
    })

    it('他机行 + 无 --confirm：拒绝执行、非 ok 状态，库未被改动', () => {
        createFixtureDb()

        const result = migrateDb(dbPath, { confirm: false })
        expect(result.status).toBe('refused')

        const db = new Database(dbPath, { readonly: true })
        expect(counts(db)).toEqual({
            users: 1,
            machines: 2,
            workspaces: 3,
            sessions: 4,
            messages: 4
        })
        db.close()
    })

    it('无他机行：无需 --confirm 即完成（users 删除不要求确认）', () => {
        createFixtureDb()
        // 先清掉他机数据，只剩 users 表清理
        {
            const db = new Database(dbPath, { readwrite: true })
            db.run('PRAGMA foreign_keys = ON')
            db.run('DELETE FROM messages WHERE session_id = ?', ['sess-foreign'])
            db.run('DELETE FROM sessions WHERE id = ?', ['sess-foreign'])
            db.run('DELETE FROM workspaces WHERE machine_id = ?', [FOREIGN_MACHINE])
            db.run('DELETE FROM machines WHERE id = ?', [FOREIGN_MACHINE])
            db.close()
        }

        const result = migrateDb(dbPath, { confirm: false })
        expect(result.status).toBe('ok')
        expect(result.droppedUsersTable).toBe(true)
        expect(result.deletedMachines).toBe(0)

        const db = new Database(dbPath, { readonly: true })
        expect(counts(db)).toEqual({ users: 0, machines: 1, workspaces: 2, sessions: 3, messages: 2 })
        db.close()
    })

    it('幂等：迁移后再跑一次，无删除、状态仍 ok', () => {
        createFixtureDb()
        migrateDb(dbPath, { confirm: true })

        const again = migrateDb(dbPath, { confirm: false })
        expect(again.status).toBe('ok')
        expect(again.droppedUsersTable).toBe(false)
        expect(again.deletedMachines).toBe(0)
        expect(again.deletedSessions).toBe(0)

        const db = new Database(dbPath, { readonly: true })
        expect(counts(db)).toEqual({ users: 0, machines: 1, workspaces: 2, sessions: 3, messages: 2 })
        db.close()
    })

    it('库不存在 → skipped（不算失败）；settings.cli.json 缺 machineId → failed', () => {
        expect(migrateDb(join(tmpDir, 'nope.db'), { confirm: true }).status).toBe('skipped')

        createFixtureDb()
        writeFileSync(join(tmpDir, 'settings.cli.json'), '{}')
        expect(migrateDb(dbPath, { confirm: true }).status).toBe('failed')
    })
})
