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

// 一次性迁移脚本（remove-machine-concept 403，BASELINE=0 期间 schema 直接定稿的配套迁移）：
// ① workspaces 表重建删 machine_id 列，重建 idx_workspaces_namespace；
// ② sessions 表重建删 machine_id 列（生产实为死列，无数据损失），重建原 3 个索引；
// ③ DROP machines 表（store 层 401 已退场，残留表无消费方）；
// ④ PRAGMA user_version 保持 1（BASELINE=0 未发布期，版本号不承载语义）；
// ⑤ 幂等：列/表已不存在 → 全部 skipped，exit 0。
//
// 本迁移理论 0 行删除（只删列删表），但保留 --confirm 门作统一惯例：任何分支出现
// 删除行数 > 0（表重建失败回滚前的异常计数）时拒绝执行并打印明细。
//
// 用法：bun scripts/migrate-remove-machine.ts [--confirm] [--vacuum] <db路径...>
// 无参默认处理 ~/.mobi/mobi.db 与 ~/.mobi-dev/mobi.db
//
// 注意：真实库执行前先停掉 daemon（daemon.state.json 存在即拒跑，防 WAL 与写竞争）。
// 回退：停服 → 整库还原 .bak 备份 → 装回上一版二进制（新二进制对旧库拒启，无半迁移态）。
// 备份保留至阶段⑤门通过。

import { Database } from 'bun:sqlite'
import { chmodSync, copyFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { homedir } from 'node:os'

/** 默认库路径 */
const DEFAULT_DB_PATHS = [
    `${homedir()}/.mobi/mobi.db`,
    `${homedir()}/.mobi-dev/mobi.db`
]

export type MigrateOptions = {
    /** 人工确认门（删除行数 > 0 时必须；理论恒 0，保门作统一惯例） */
    confirm: boolean
    /** 迁移后可选 VACUUM（删列不缩文件，需回收磁盘时用） */
    vacuum?: boolean
}

export type MigrateResult = {
    dbPath: string
    status: 'ok' | 'refused' | 'skipped' | 'failed'
    /** workspaces 表是否在本次被重建（幂等重跑为 false） */
    rebuiltWorkspaces: boolean
    /** sessions 表是否在本次被重建（幂等重跑为 false） */
    rebuiltSessions: boolean
    /** machines 表是否在本次被删除（幂等重跑为 false） */
    droppedMachinesTable: boolean
}

/** 402 后 createSchema 的 workspaces 形状（迁移目标结构的唯一依据） */
const WORKSPACES_NEW_DDL = `
    CREATE TABLE workspaces_new (
        id TEXT PRIMARY KEY,
        namespace TEXT NOT NULL DEFAULT 'default',
        name TEXT NOT NULL,
        folders TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        seq INTEGER DEFAULT 0
    )
`

/** 402 后 createSchema 的 sessions 形状（同旧表去 machine_id） */
const SESSIONS_NEW_DDL = `
    CREATE TABLE sessions_new (
        id TEXT PRIMARY KEY,
        tag TEXT,
        namespace TEXT NOT NULL DEFAULT 'default',
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
    )
`

/** sessions 原有 3 个索引（与 createSchema 一致） */
const SESSIONS_INDEX_DDL = `
    CREATE INDEX IF NOT EXISTS idx_sessions_tag ON sessions(tag);
    CREATE INDEX IF NOT EXISTS idx_sessions_tag_namespace ON sessions(tag, namespace);
    CREATE INDEX IF NOT EXISTS idx_sessions_workspace ON sessions(workspace_id);
`

/** 表是否存在 */
function tableExists(db: Database, name: string): boolean {
    return Boolean(db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(name))
}

/** 列是否存在 */
function columnExists(db: Database, table: string, column: string): boolean {
    return (db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>)
        .some((col) => col.name === column)
}

export function migrateDb(dbPath: string, options: MigrateOptions): MigrateResult {
    const empty: MigrateResult = {
        dbPath,
        status: 'ok',
        rebuiltWorkspaces: false,
        rebuiltSessions: false,
        droppedMachinesTable: false
    }

    if (!existsSync(dbPath)) {
        console.error(`[跳过] ${dbPath} 不存在`)
        return { ...empty, status: 'skipped' }
    }

    // 前置：daemon 未停则拒跑（daemon.state.json 是 daemon 存活期间常驻的状态文件）
    const statePath = join(dirname(dbPath), 'daemon.state.json')
    if (existsSync(statePath)) {
        console.error(
            `[拒绝] ${dbPath} 同目录存在 daemon.state.json，daemon 可能仍在运行。` +
            '请先 `mobi service stop` 停服再迁移；本次未改动数据库'
        )
        return { ...empty, status: 'refused' }
    }

    // 预扫描（只读）：确认有待迁移结构才动手，全无则 skipped
    const scan = new Database(dbPath, { readonly: true })
    const hasMachineId = (tableExists(scan, 'sessions') && columnExists(scan, 'sessions', 'machine_id')) ||
        (tableExists(scan, 'workspaces') && columnExists(scan, 'workspaces', 'machine_id'))
    const hasMachinesTable = tableExists(scan, 'machines')
    scan.close()

    if (!hasMachineId && !hasMachinesTable) {
        console.log(`[跳过] ${dbPath} 已是新结构（无 machine_id 列 / machines 表）`)
        return { ...empty, status: 'skipped' }
    }

    // WAL checkpoint：残留 -wal 未落盘时主文件不是完整状态，直接拷贝会丢已提交数据
    {
        const pre = new Database(dbPath)
        pre.run('PRAGMA wal_checkpoint(TRUNCATE)')
        pre.close()
    }

    // 备份（永不覆盖既有备份：同日重跑则追加时分秒，仍冲突则追加序号）+ 收紧权限
    const day = new Date().toISOString().slice(0, 10).replace(/-/g, '')
    let backupPath = `${dbPath}.bak-${day}`
    if (existsSync(backupPath)) {
        const stamp = `${dbPath}.bak-${day}-${new Date().toTimeString().slice(0, 8).replace(/:/g, '')}`
        backupPath = stamp
        for (let i = 2; existsSync(backupPath); i++) {
            backupPath = `${stamp}-${i}`
        }
    }
    copyFileSync(dbPath, backupPath)
    chmodSync(backupPath, 0o600)
    console.log(`[备份] ${dbPath} -> ${backupPath}`)

    const db = new Database(dbPath)
    try {
        const migrate = db.transaction(() => {
            const result: MigrateResult = { ...empty }

            // workspaces 重建删列（结构以 402 后 createSchema 为准）
            if (tableExists(db, 'workspaces') && columnExists(db, 'workspaces', 'machine_id')) {
                const before = (db.prepare('SELECT COUNT(*) AS c FROM workspaces').get() as { c: number }).c
                db.run(WORKSPACES_NEW_DDL)
                db.run(`
                    INSERT INTO workspaces_new (id, namespace, name, folders, created_at, updated_at, seq)
                    SELECT id, namespace, name, folders, created_at, updated_at, seq FROM workspaces
                `)
                const after = (db.prepare('SELECT COUNT(*) AS c FROM workspaces_new').get() as { c: number }).c
                if (after !== before) {
                    // --confirm 门的实质：本迁移不该丢任何行，行数不符即异常（事务回滚）
                    throw new Error(`workspaces 重建行数不符（${before} -> ${after}），拒绝提交`)
                }
                db.run('DROP TABLE workspaces')
                db.run('ALTER TABLE workspaces_new RENAME TO workspaces')
                db.run('CREATE INDEX IF NOT EXISTS idx_workspaces_namespace ON workspaces(namespace)')
                result.rebuiltWorkspaces = true
            }

            // sessions 重建删列（machine_id 生产全 NULL 死列，无数据损失）
            if (tableExists(db, 'sessions') && columnExists(db, 'sessions', 'machine_id')) {
                const before = (db.prepare('SELECT COUNT(*) AS c FROM sessions').get() as { c: number }).c
                db.run(SESSIONS_NEW_DDL)
                db.run(`
                    INSERT INTO sessions_new (
                        id, tag, namespace, created_at, updated_at,
                        metadata, metadata_version,
                        agent_state, agent_state_version,
                        runtime_state, runtime_state_updated_at,
                        workspace_id, pinned, seq
                    )
                    SELECT
                        id, tag, namespace, created_at, updated_at,
                        metadata, metadata_version,
                        agent_state, agent_state_version,
                        runtime_state, runtime_state_updated_at,
                        workspace_id, pinned, seq
                    FROM sessions
                `)
                const after = (db.prepare('SELECT COUNT(*) AS c FROM sessions_new').get() as { c: number }).c
                if (after !== before) {
                    throw new Error(`sessions 重建行数不符（${before} -> ${after}），拒绝提交`)
                }
                db.run('DROP TABLE sessions')
                db.run('ALTER TABLE sessions_new RENAME TO sessions')
                db.run(SESSIONS_INDEX_DDL)
                result.rebuiltSessions = true
            }

            // machines 表退场（幂等）
            if (tableExists(db, 'machines')) {
                db.run('DROP INDEX IF EXISTS idx_machines_namespace')
                db.run('DROP TABLE machines')
                result.droppedMachinesTable = true
            }

            // BASELINE=0 未发布期版本号不承载语义：保持不变（通常已是 1）

            return result
        })

        const result = migrate()

        if (options.vacuum) {
            db.run('VACUUM')
            console.log(`[VACUUM] ${dbPath} 已回收空间`)
        }

        console.log(
            `[完成] ${dbPath}：workspaces 重建=${result.rebuiltWorkspaces ? '是' : '已新结构'}，` +
            `sessions 重建=${result.rebuiltSessions ? '是' : '已新结构'}，` +
            `machines 表删除=${result.droppedMachinesTable ? '是' : '已不存在'}`
        )
        return result
    } catch (err) {
        console.error(`[失败] ${dbPath} 迁移中止（备份已保留）：`, err)
        return { ...empty, status: 'failed' }
    } finally {
        db.close()
    }
}

// ---- 入口（测试 import 本模块时不执行） ----

if (import.meta.main) {
    const args = process.argv.slice(2)
    const confirm = args.includes('--confirm')
    const vacuum = args.includes('--vacuum')
    const dbPaths = args.filter((arg) => !arg.startsWith('--'))
    const expandPath = (p: string): string =>
        p === '~' || p.startsWith('~/') ? join(homedir(), p.slice(1)) : p
    const targets = (dbPaths.length > 0 ? dbPaths : DEFAULT_DB_PATHS).map(expandPath)

    let failed = 0
    for (const p of targets) {
        const result = migrateDb(p, { confirm, vacuum })
        if (result.status === 'failed' || result.status === 'refused') failed += 1
    }
    process.exit(failed > 0 ? 1 : 0)
}
