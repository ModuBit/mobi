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

// 一次性迁移脚本（personal-agent-rewrite ticket-24，本期唯一一次 DB 变更）：
// ① 删 users 表（hub UserStore 已删，无消费方，纯结构清理）；
// ② 兜底删除 machine_id ≠ 本机（取库同目录 settings.cli.json 的 machineId）的
//    machines / workspaces / sessions 行（sessions.machine_id 为 NULL 的游离会话保留，
//    他机会话的 messages 随外键级联删除）——正常应删 0 行；删除行数 > 0 时打印明细
//    并要求 --confirm 才执行，否则拒绝且不改库；
// ③ 幂等：重跑无副作用。
//
// 用法：bun scripts/migrate-personal-agent.ts [--confirm] <db路径...>
// 无参默认处理 ~/.mobi/mobi.db 与 ~/.mobi-dev/mobi.db
//
// 注意：真实库执行前先停掉 daemon 进程，避免 WAL 与写竞争。
// 回退：停服 → 还原 .bak 备份 → 装回上一版二进制。备份保留至阶段⑤门通过。

import { Database } from 'bun:sqlite'
import { chmodSync, copyFileSync, existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { homedir } from 'node:os'

/** 默认库路径 */
const DEFAULT_DB_PATHS = [
    `${homedir()}/.mobi/mobi.db`,
    `${homedir()}/.mobi-dev/mobi.db`
]

export type MigrateOptions = {
    /** 删除他机行前的人工确认（删除行数 > 0 时必须） */
    confirm: boolean
}

export type MigrateResult = {
    dbPath: string
    status: 'ok' | 'refused' | 'skipped' | 'failed'
    /** users 表是否在本次被删除（幂等重跑为 false） */
    droppedUsersTable: boolean
    deletedMachines: number
    deletedWorkspaces: number
    deletedSessions: number
    /** 他机会话的消息随外键级联删除的行数 */
    cascadedMessages: number
}

/** 明细打印的每类上限（防他机数据异常膨胀刷屏） */
const DETAIL_LIMIT = 50

/** 读库同目录 settings.cli.json 的 machineId（与 node-core configuration 的文件布局一致） */
function loadLocalMachineId(dbPath: string): string | null {
    const settingsPath = join(dirname(dbPath), 'settings.cli.json')
    if (!existsSync(settingsPath)) return null
    try {
        const parsed = JSON.parse(readFileSync(settingsPath, 'utf8')) as { machineId?: unknown }
        return typeof parsed.machineId === 'string' && parsed.machineId ? parsed.machineId : null
    } catch {
        return null
    }
}

/** 打印他机行明细（refused 与 confirm 后执行共用） */
function printForeignDetails(db: Database, machineId: string): void {
    const machines = db.prepare('SELECT id FROM machines WHERE id != ? ORDER BY id LIMIT ?').all(machineId, DETAIL_LIMIT) as { id: string }[]
    const workspaces = db.prepare('SELECT id, name, machine_id FROM workspaces WHERE machine_id != ? ORDER BY id LIMIT ?').all(machineId, DETAIL_LIMIT) as { id: string; name: string; machine_id: string }[]
    const sessions = db.prepare('SELECT id, machine_id FROM sessions WHERE machine_id IS NOT NULL AND machine_id != ? ORDER BY id LIMIT ?').all(machineId, DETAIL_LIMIT) as { id: string; machine_id: string }[]
    const cascaded = (db.prepare(
        'SELECT COUNT(*) AS c FROM messages WHERE session_id IN (SELECT id FROM sessions WHERE machine_id IS NOT NULL AND machine_id != ?)'
    ).get(machineId) as { c: number }).c

    for (const m of machines) console.log(`  [机器] ${m.id}`)
    for (const w of workspaces) console.log(`  [工作区] ${w.id} name=${w.name} machine=${w.machine_id}`)
    for (const s of sessions) console.log(`  [会话] ${s.id} machine=${s.machine_id}`)
    console.log(`  [消息] 随他机会话级联删除 ${cascaded} 行`)
}

export function migrateDb(dbPath: string, options: MigrateOptions): MigrateResult {
    const empty: MigrateResult = {
        dbPath,
        status: 'ok',
        droppedUsersTable: false,
        deletedMachines: 0,
        deletedWorkspaces: 0,
        deletedSessions: 0,
        cascadedMessages: 0
    }

    if (!existsSync(dbPath)) {
        console.error(`[跳过] ${dbPath} 不存在`)
        return { ...empty, status: 'skipped' }
    }

    const machineId = loadLocalMachineId(dbPath)
    if (!machineId) {
        console.error(
            `[失败] ${dbPath} 同目录 settings.cli.json 缺少 machineId，无法判定本机行；` +
            '请补齐该文件或用 CLI 启动一次生成后再迁移。'
        )
        return { ...empty, status: 'failed' }
    }

    // 预扫描（只读）：他机行 > 0 且未确认时拒绝，且不做 checkpoint/备份（拒绝不改库）
    const scan = new Database(dbPath, { readonly: true })
    const foreignMachines = (scan.prepare('SELECT COUNT(*) AS c FROM machines WHERE id != ?').get(machineId) as { c: number }).c
    const foreignWorkspaces = (scan.prepare('SELECT COUNT(*) AS c FROM workspaces WHERE machine_id != ?').get(machineId) as { c: number }).c
    const foreignSessions = (scan.prepare('SELECT COUNT(*) AS c FROM sessions WHERE machine_id IS NOT NULL AND machine_id != ?').get(machineId) as { c: number }).c
    const hasForeign = foreignMachines + foreignWorkspaces + foreignSessions > 0
    if (hasForeign) {
        console.log(`[发现他机数据] ${dbPath}：机器 ${foreignMachines}，工作区 ${foreignWorkspaces}，会话 ${foreignSessions}`)
        printForeignDetails(scan, machineId)
    }
    scan.close()

    if (hasForeign && !options.confirm) {
        console.error(`[拒绝] ${dbPath} 存在他机行，需加 --confirm 才执行删除；本次未改动数据库`)
        return { ...empty, status: 'refused' }
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
    // 级联删除依赖外键，须在事务外开启（事务内 PRAGMA no-op）
    db.run('PRAGMA foreign_keys = ON')
    try {
        const migrate = db.transaction(() => {
            const result: MigrateResult = { ...empty }

            // 兜底删除他机行（sessions 先删，messages 随外键级联）。
            // 行数用 COUNT 预取而非 DELETE 的 .changes——bun:sqlite 的 changes 会把
            // FK 级联删除一并计入（sessions 1 + messages N 报成一个数），无法当删除行数用
            result.cascadedMessages = (db.prepare(
                'SELECT COUNT(*) AS c FROM messages WHERE session_id IN (SELECT id FROM sessions WHERE machine_id IS NOT NULL AND machine_id != ?)'
            ).get(machineId) as { c: number }).c
            result.deletedSessions = (db.prepare(
                'SELECT COUNT(*) AS c FROM sessions WHERE machine_id IS NOT NULL AND machine_id != ?'
            ).get(machineId) as { c: number }).c
            result.deletedWorkspaces = (db.prepare(
                'SELECT COUNT(*) AS c FROM workspaces WHERE machine_id != ?'
            ).get(machineId) as { c: number }).c
            result.deletedMachines = (db.prepare(
                'SELECT COUNT(*) AS c FROM machines WHERE id != ?'
            ).get(machineId) as { c: number }).c
            db.run('DELETE FROM sessions WHERE machine_id IS NOT NULL AND machine_id != ?', [machineId])
            db.run('DELETE FROM workspaces WHERE machine_id != ?', [machineId])
            db.run('DELETE FROM machines WHERE id != ?', [machineId])

            // 删 users 表与索引（幂等）
            result.droppedUsersTable = Boolean(
                db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'users'").get()
            )
            db.run('DROP INDEX IF EXISTS idx_users_platform')
            db.run('DROP INDEX IF EXISTS idx_users_platform_namespace')
            db.run('DROP TABLE IF EXISTS users')

            return result
        })

        const result = migrate()
        console.log(
            `[完成] ${dbPath}：删 users 表=${result.droppedUsersTable ? '是' : '已不存在'}，` +
            `删他机行 机器 ${result.deletedMachines} / 工作区 ${result.deletedWorkspaces} / 会话 ${result.deletedSessions}` +
            `（级联消息 ${result.cascadedMessages} 行）`
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
    const dbPaths = args.filter((arg) => !arg.startsWith('--'))
    const expandPath = (p: string): string =>
        p === '~' || p.startsWith('~/') ? join(homedir(), p.slice(1)) : p
    const targets = (dbPaths.length > 0 ? dbPaths : DEFAULT_DB_PATHS).map(expandPath)

    let failed = 0
    for (const p of targets) {
        const result = migrateDb(p, { confirm })
        if (result.status === 'failed' || result.status === 'refused') failed += 1
    }
    process.exit(failed > 0 ? 1 : 0)
}
