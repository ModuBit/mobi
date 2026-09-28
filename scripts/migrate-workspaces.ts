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

// 一次性迁移脚本：存量会话按 group_key 回填项目实体（「项目实体化」Task 9，方案 A / 设计决策 D11、D13）
//
// 用法：bun scripts/migrate-projects.ts <db路径...>
// 无参默认处理 ~/.mobi/mobi.db 与 ~/.mobi-dev/mobi.db
//（目录探测于 2026-08-13 ls 确认：两目录下 db 文件均名为 mobi.db）
//
// 注意：真实库执行前先停掉 hub / runner 进程，避免 WAL 与写竞争。

import { Database } from 'bun:sqlite'
import { chmodSync, copyFileSync, existsSync } from 'node:fs'
import { basename, join } from 'node:path'
import { homedir } from 'node:os'
import { randomUUID } from 'node:crypto'

// 目标 schema 版本。来源：packages/hub/src/store/index.ts 的 SCHEMA_VERSION（读取日期 2026-08-13）。
// BASELINE=0 策略下新旧 schema 版本号同为 1，无法用 user_version 区分新旧库，
// 判别只能依赖列存在性（project_id / group_key），见脚本内探测逻辑。
const SCHEMA_VERSION = 1

// projects 表 DDL。来源：packages/hub/src/store/index.ts createSchema（复制日期 2026-08-13），逐列一致。
const CREATE_PROJECTS_SQL = `
    CREATE TABLE IF NOT EXISTS projects (
        id TEXT PRIMARY KEY,
        namespace TEXT NOT NULL DEFAULT 'default',
        machine_id TEXT NOT NULL,
        name TEXT NOT NULL,
        folders TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        seq INTEGER DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_projects_namespace ON projects(namespace);
    CREATE INDEX IF NOT EXISTS idx_projects_machine ON projects(machine_id);
`

/** 默认库路径（探测日期 2026-08-13） */
const DEFAULT_DB_PATHS = [
    `${homedir()}/.mobi/mobi.db`,
    `${homedir()}/.mobi-dev/mobi.db`
]

type SessionRow = {
    id: string
    namespace: string
    group_key: string
    metadata: string | null
    updated_at: number
}

type ProjectFolder = { path: string; primary: boolean }

type DbReport = {
    dbPath: string
    created: number
    reused: number
    linked: number
    skippedRows: number
    skippedGroups: number
}

/** PRAGMA table_info 结果列名集合 */
function tableColumns(db: Database, table: string): string[] {
    const rows = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]
    return rows.map((r) => r.name)
}

/**
 * 路径归一化：反斜杠统一为正斜杠、去尾部斜杠（与 hub extractGroupKey 写入侧一致，不做大小写归一）。
 * 防止尾斜杠路径 basename 得空串、以及仅分隔符不同的同目录被拆成两个 folder。
 * 根路径（如 "/"）去尾斜杠后为空，回填为 "/"。
 */
function normalizePath(p: string): string {
    const norm = p.replace(/\\/g, '/').replace(/\/+$/, '')
    return norm === '' ? '/' : norm
}

/** 安全 JSON 解析：失败返回 null */
function safeJsonParse(raw: string | null): Record<string, unknown> | null {
    if (!raw) return null
    try {
        const parsed = JSON.parse(raw)
        return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null
    } catch {
        return null
    }
}

/**
 * 机器归属：取众数（D13）。并列时取 updated_at 最新者。
 * entries 为组内各会话解析出的 { machineId, updatedAt }（metadata 损坏的行不参与）。
 */
function pickMachineId(entries: { machineId: string; updatedAt: number }[]): string | null {
    if (entries.length === 0) return null

    const stats = new Map<string, { count: number; lastSeen: number }>()
    for (const e of entries) {
        const s = stats.get(e.machineId)
        if (s) {
            s.count += 1
            s.lastSeen = Math.max(s.lastSeen, e.updatedAt)
        } else {
            stats.set(e.machineId, { count: 1, lastSeen: e.updatedAt })
        }
    }

    let best: string | null = null
    let bestCount = 0
    let bestLastSeen = -Infinity
    for (const [id, s] of stats) {
        if (s.count > bestCount || (s.count === bestCount && s.lastSeen > bestLastSeen)) {
            best = id
            bestCount = s.count
            bestLastSeen = s.lastSeen
        }
    }
    return best
}

/** 组内路径集合是否与既有项目一致（同名同文件夹判据，文件夹顺序不敏感） */
function sameFolders(a: ProjectFolder[], b: ProjectFolder[]): boolean {
    const key = (f: ProjectFolder[]) => f.map((x) => `${x.primary ? '1' : '0'}:${x.path}`).sort().join('|')
    return key(a) === key(b)
}

/** 迁移单个库（独立事务，失败即中止且保留备份） */
function migrateDb(dbPath: string): void {
    if (!existsSync(dbPath)) {
        console.error(`[跳过] ${dbPath} 不存在`)
        return
    }

    // 1a. WAL checkpoint：残留 -wal 未落盘时主文件不是完整状态，直接拷贝会丢已提交数据。
    //     先开库 truncate checkpoint 把 WAL 并入主文件，备份必然等于完整一致状态。
    {
        const pre = new Database(dbPath)
        pre.run('PRAGMA wal_checkpoint(TRUNCATE)')
        pre.close()
    }

    // 1b. 备份（永不覆盖既有备份：同日重跑则追加时分秒，仍冲突则追加序号）+ 收紧权限
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
    const report: DbReport = {
        dbPath,
        created: 0,
        reused: 0,
        linked: 0,
        skippedRows: 0,
        skippedGroups: 0
    }

    try {
        const migrate = db.transaction(() => {
            const sessionCols = tableColumns(db, 'sessions')

            // 2. 旧库无 project_id 列则补列（BASELINE=0 下列存在性是唯一新旧判别器）
            if (!sessionCols.includes('project_id')) {
                db.run('ALTER TABLE sessions ADD COLUMN project_id TEXT')
            }

            // 3. projects 表 + 索引（幂等）
            db.run(CREATE_PROJECTS_SQL)
            db.run('CREATE INDEX IF NOT EXISTS idx_sessions_project ON sessions(project_id)')

            // 4. 回填（group_key 列仍在 = 尚未回填过；已删列则整段跳过，天然幂等）
            if (sessionCols.includes('group_key')) {
                backfill(db, report)
            } else {
                console.log('[幂等] sessions 已无 group_key 列，跳过回填与删列')
            }

            // 5. 删除旧列与旧索引（必须先删索引：DROP COLUMN 时 SQLite 会重验引用该列的索引）
            db.run('DROP INDEX IF EXISTS idx_sessions_group_key')
            if (sessionCols.includes('group_key')) {
                db.run('ALTER TABLE sessions DROP COLUMN group_key')
            }

            // 6. 对齐 schema 版本
            db.run(`PRAGMA user_version = ${SCHEMA_VERSION}`)
        })
        migrate()
    } finally {
        db.close()
    }

    // 7. 报告
    console.log(
        `[完成] ${dbPath}：新建项目 ${report.created}，复用项目 ${report.reused}，` +
            `挂钩会话 ${report.linked}，跳过行 ${report.skippedRows}，跳过组 ${report.skippedGroups}`
    )
}

/** 按 (namespace, group_key) 分组回填 project_id */
function backfill(db: Database, report: DbReport): void {
    const rows = db
        .prepare('SELECT id, namespace, group_key, metadata, updated_at FROM sessions WHERE group_key IS NOT NULL')
        .all() as SessionRow[]

    const groups = new Map<string, SessionRow[]>()
    for (const row of rows) {
        const key = JSON.stringify([row.namespace, row.group_key])
        const list = groups.get(key)
        if (list) list.push(row)
        else groups.set(key, [row])
    }

    const findProject = db.prepare('SELECT id, folders FROM projects WHERE namespace = ? AND name = ?')
    const insertProject = db.prepare(
        'INSERT INTO projects (id, namespace, machine_id, name, folders, created_at, updated_at, seq) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    )
    const findFallbackMachine = db.prepare(
        'SELECT id FROM machines WHERE namespace = ? ORDER BY updated_at DESC LIMIT 1'
    )
    const linkSession = db.prepare('UPDATE sessions SET project_id = ? WHERE id = ? AND project_id IS NULL')

    for (const groupRows of groups.values()) {
        const namespace = groupRows[0].namespace

        // 组内 distinct metadata.path（JSON 损坏的行跳过并计数，但仍参与挂钩与机器众数以外的统计）
        const paths: string[] = []
        const machineEntries: { machineId: string; updatedAt: number }[] = []
        for (const row of groupRows) {
            const meta = safeJsonParse(row.metadata)
            if (!meta) {
                report.skippedRows += 1
                continue
            }
            const rawPath = typeof meta.path === 'string' ? meta.path : ''
            const path = rawPath ? normalizePath(rawPath) : ''
            if (path && !paths.includes(path)) paths.push(path)
            const machineId = typeof meta.machineId === 'string' ? meta.machineId : ''
            if (machineId) machineEntries.push({ machineId, updatedAt: row.updated_at })
        }

        // 整组无有效路径（无法定 primary / name）则跳过该组，组内会话保持游离
        if (paths.length === 0) {
            report.skippedGroups += 1
            console.warn(
                `[警告] 组 (${namespace}, ${groupRows[0].group_key}) 无任何可解析 metadata.path，${groupRows.length} 个会话保持游离`
            )
            continue
        }

        // 最短路径为 primary；等长并列时取字典序最小（先 sort 保证确定化）
        const sortedPaths = [...paths].sort()
        const primaryPath = sortedPaths.reduce((a, b) => (b.length < a.length ? b : a))
        const folders: ProjectFolder[] = paths.map((p) => ({ path: p, primary: p === primaryPath }))
        // machine_id 取众数（并列取最新），全空回退 namespace 最近机器，再无则 unknown
        const machineId =
            pickMachineId(machineEntries) ??
            ((findFallbackMachine.get(namespace) as { id: string } | undefined)?.id ?? 'unknown')

        // 幂等键 (namespace, primaryPath)：同名同文件夹的项目直接复用
        const name = basename(primaryPath)
        let projectId: string | null = null
        for (const existing of findProject.all(namespace, name) as { id: string; folders: string }[]) {
            const existingFolders = (safeJsonParse(existing.folders) as ProjectFolder[] | null) ?? []
            if (sameFolders(existingFolders, folders)) {
                projectId = existing.id
                report.reused += 1
                break
            }
        }
        if (!projectId) {
            projectId = randomUUID()
            const now = Date.now()
            insertProject.run(projectId, namespace, machineId, name, JSON.stringify(folders), now, now, 0)
            report.created += 1
            console.log(
                `[新建] 项目 ${name}（ns=${namespace}，机器=${machineId}，会话=${groupRows.length}，folders=${JSON.stringify(folders)}）`
            )
        } else {
            console.log(
                `[复用] 项目 ${name}（ns=${namespace}，机器=${machineId}，会话=${groupRows.length}，folders=${JSON.stringify(folders)}）`
            )
        }

        // 挂钩组内会话（group_key 为 NULL 的老会话不在此列，保持游离）
        for (const row of groupRows) {
            linkSession.run(projectId, row.id)
            report.linked += 1
        }
    }
}

// ---- 入口 ----

const dbPaths = process.argv.slice(2)
// 支持 ~/ 前缀展开
const expandPath = (p: string): string =>
    p === '~' || p.startsWith('~/') ? join(homedir(), p.slice(1)) : p
const targets = (dbPaths.length > 0 ? dbPaths : DEFAULT_DB_PATHS).map(expandPath)

let failed = 0
for (const p of targets) {
    try {
        migrateDb(p)
    } catch (err) {
        failed += 1
        console.error(`[失败] ${p} 迁移中止（备份已保留）：`, err)
    }
}
process.exit(failed > 0 ? 1 : 0)
