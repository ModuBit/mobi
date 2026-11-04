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

// 一次性迁移脚本：存量库补会话保留状态三列（session-retention 票 03）——
//   status TEXT NOT NULL DEFAULT 'dormant'（存量行一律 dormant，活会话由 daemon
//   重启后的重连事件翻回 online，宽限期自愈兜底）
//   status_updated_at INTEGER（最近一次状态迁移时刻，启动自愈判活依据）
//   archived_at INTEGER（归档时刻）
// 以及两个查询索引。已是新 schema 的库天然幂等，重跑无副作用。
//
// 用法：bun scripts/migrate-session-status.ts <db路径...>
// 无参默认处理 ~/.mobi/mobi.db 与 ~/.mobi-dev/mobi.db
//
// 注意：真实库执行前先停掉 daemon 进程，避免 WAL 与写竞争。

import { Database } from 'bun:sqlite'
import { chmodSync, copyFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'

const ADD_COLUMNS_SQL = [
    `ALTER TABLE sessions ADD COLUMN status TEXT NOT NULL DEFAULT 'dormant'`,
    `ALTER TABLE sessions ADD COLUMN status_updated_at INTEGER`,
    `ALTER TABLE sessions ADD COLUMN archived_at INTEGER`,
] as const

const CREATE_INDEXES_SQL = `
    CREATE INDEX IF NOT EXISTS idx_sessions_namespace_status ON sessions(namespace, status);
    CREATE INDEX IF NOT EXISTS idx_sessions_namespace_archived ON sessions(namespace, archived_at);
`

function tableColumns(db: Database, table: string): Set<string> {
    const rows = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>
    return new Set(rows.map(row => row.name))
}

function migrate(dbPath: string): void {
    console.log(`\n==> ${dbPath}`)
    if (!existsSync(dbPath)) {
        console.log('    跳过：文件不存在')
        return
    }

    // 修改前快照（与 migrate-workspaces 同款备份策略）。-wal/-shm 若在场必须一并
    // 备份——只 copy 主库会漏掉未 checkpoint 的写入，回滚时静默丢最近数据
    const backupPath = `${dbPath}.bak-status-${Date.now()}`
    copyFileSync(dbPath, backupPath)
    for (const ext of ['-wal', '-shm']) {
        if (existsSync(`${dbPath}${ext}`)) copyFileSync(`${dbPath}${ext}`, `${backupPath}${ext}`)
    }
    console.log(`    备份: ${backupPath}（含 -wal/-shm 附属文件，如在场）`)

    const db = new Database(dbPath, { readwrite: true })
    try {
        db.run('PRAGMA busy_timeout = 5000')
        const columns = tableColumns(db, 'sessions')
        if (columns.size === 0) {
            console.log('    跳过：sessions 表不存在（新库由 daemon 建表）')
            return
        }

        const missing = ['status', 'status_updated_at', 'archived_at'].filter(name => !columns.has(name))
        if (missing.length === 0) {
            // 已迁移过：仍确保索引在（早于索引补齐版本迁移的库）
            db.run(CREATE_INDEXES_SQL)
            console.log('    已是新 schema（无缺列），索引已确保')
            return
        }

        db.run('BEGIN')
        try {
            // 只补缺失列（幂等：已迁移过的库在 missing.length === 0 分支已返回）
            const columnByStatement: Record<string, string> = {
                [ADD_COLUMNS_SQL[0]]: 'status',
                [ADD_COLUMNS_SQL[1]]: 'status_updated_at',
                [ADD_COLUMNS_SQL[2]]: 'archived_at',
            }
            for (const statement of ADD_COLUMNS_SQL) {
                if (missing.includes(columnByStatement[statement])) {
                    db.run(statement)
                }
            }
            db.run(CREATE_INDEXES_SQL)
            db.run('COMMIT')
        } catch (error) {
            db.run('ROLLBACK')
            throw error
        }

        const after = tableColumns(db, 'sessions')
        const dormantRows = db.prepare(`SELECT COUNT(*) AS n FROM sessions WHERE status = 'dormant'`).get() as { n: number }
        console.log(`    迁移完成：补列 [${missing.join(', ')}]，存量行 ${dormantRows.n} 条全部 dormant`)
        console.log(`    校验: status=${after.has('status') ? '✓' : '✗'} status_updated_at=${after.has('status_updated_at') ? '✓' : '✗'} archived_at=${after.has('archived_at') ? '✓' : '✗'}`)
    } finally {
        db.close()
        for (const path of [dbPath, `${dbPath}-wal`, `${dbPath}-shm`]) {
            try {
                chmodSync(path, 0o600)
            } catch {
                // 部分文件系统不支持权限设置，可安全忽略
            }
        }
    }
}

function main(): void {
    const args = process.argv.slice(2)
    const dbPaths = args.length > 0
        ? args
        : [join(homedir(), '.mobi', 'mobi.db'), join(homedir(), '.mobi-dev', 'mobi.db')]

    console.log(`会话保留状态三列迁移（目标：sessions.status / status_updated_at / archived_at）`)
    for (const dbPath of dbPaths) {
        migrate(dbPath)
    }
    console.log('\n全部完成。重启 daemon 后生效；活会话将在重连后翻回 online。')
}

main()
