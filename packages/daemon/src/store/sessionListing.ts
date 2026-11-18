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
 * 终端 fork 的只读会话清单（tui-fork 票 01）。
 *
 * 数据源是 daemon 的 SQLite 会话账本；本模块刻意只读、只取最小字段集，
 * 让 CLI 在 daemon 停机时也能发现可 fork 的会话。写路径仍唯一归 daemon。
 */

import { Database } from 'bun:sqlite'
import { existsSync } from 'node:fs'
import {
    FORKABLE_STATUSES,
    isResumableEndReason,
    resolveSessionTitle,
    type ForkableSession,
    type ForkableStatus
} from '@mobi/shared'

/** 只读查询的显式失败：调用方据此给出可操作提示，而不是静默空列表 */
export class SessionListingError extends Error {
    constructor(message: string) {
        super(message)
        this.name = 'SessionListingError'
    }
}

/**
 * 查询投影：SQL 只取标量（不物化整段 metadata JSON——其中 sdkMetadata 等字段
 * 从不被列表使用，按行 parse 会把大块无关数据读进 JS）。
 * json_valid 守卫让脏行按 NULL 处理（与写路径 safeJsonParse 的防御策略一致）。
 */
type SessionRow = {
    id: string
    name: unknown
    summary_text: unknown
    path: unknown
    native_session_id: unknown
    /** metadata.forkedFrom / forkFrom（fork 标记，判断标题优先级反转）；对象/缺失等形状不关心，只看在场 */
    forked_from: unknown
    fork_from: unknown
    end_reason: unknown
    status: string
    updated_at: number
}

/** 只读查询必须用到的列；缺任意一列说明库 schema 落后于当前 CLI */
const REQUIRED_COLUMNS = ['id', 'namespace', 'metadata', 'status', 'updated_at', 'end_state'] as const

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error)
}

/** 打开只读数据库；不存在或打不开时给出明确错误 */
function openReadOnly(dbPath: string): Database {
    if (!existsSync(dbPath)) {
        throw new SessionListingError(`未找到 mobi 数据库：${dbPath}（daemon 尚未初始化？）`)
    }
    try {
        const db = new Database(dbPath, { readonly: true })
        db.run('PRAGMA busy_timeout = 5000')
        return db
    } catch (error) {
        throw new SessionListingError(`无法以只读方式打开 mobi 数据库 ${dbPath}：${errorMessage(error)}`)
    }
}

/** schema 守卫：缺表/缺列时提示先启动 daemon 完成迁移，不把 SQL 错误透给用户 */
function assertSessionsSchema(db: Database): void {
    let columns: { name: string }[]
    try {
        columns = db.query('PRAGMA table_info(sessions)').all() as { name: string }[]
    } catch (error) {
        throw new SessionListingError(`读取 sessions 表结构失败：${errorMessage(error)}`)
    }
    if (columns.length === 0) {
        throw new SessionListingError('mobi 数据库缺少 sessions 表，请先启动 daemon 完成初始化')
    }
    const present = new Set(columns.map(column => column.name))
    const missing = REQUIRED_COLUMNS.filter(column => !present.has(column))
    if (missing.length > 0) {
        throw new SessionListingError(
            `mobi 数据库 schema 过旧，缺少字段：${missing.join(', ')}。请先启动 daemon 完成迁移`
        )
    }
}

/** 非空字符串（json_extract 结果可能是数字/对象等脏值） */
function nonEmptyString(value: unknown): string | null {
    return typeof value === 'string' && value.length > 0 ? value : null
}

/**
 * 行 → 可列示 / 可 fork 会话。
 * 状态过滤已由 SQL IN（FORKABLE_STATUSES 单源占位符）完成，此处不再重过滤；
 * end_reason 为 null（老数据未回填 / 进程仍在）视为可接续（isResumableEndReason）。
 * native id 未就绪（SDK 尚未回报）的行保留（nativeSessionId 置 null）：静默丢行会让
 * sessions list 看不到该会话、拿不到 mobi id 去 stop；fork 侧自行排除这类行。
 */
function toForkableSession(row: SessionRow): ForkableSession | null {
    if (!isResumableEndReason(nonEmptyString(row.end_reason))) return null

    const nativeSessionId = nonEmptyString(row.native_session_id)
    const path = nonEmptyString(row.path)
    if (!path) return null

    return {
        id: row.id,
        // 标题取值链单源 resolveSessionTitle：非 fork 行 summary.text 优先（与 Web 展示
        // 一致——否则照 Web 标题 fork 会 not-found），fork 行反转 name 优先
        title: resolveSessionTitle({
            name: nonEmptyString(row.name),
            summaryText: nonEmptyString(row.summary_text),
            path,
            isFork: row.forked_from !== null || row.fork_from !== null
        }),
        path,
        nativeSessionId,
        updatedAt: row.updated_at,
        status: row.status as ForkableStatus
    }
}

/** 从已打开的数据库读取可列示会话（测试与复用入口） */
export function listForkableSessionsFromDb(db: Database, namespace: string): ForkableSession[] {
    assertSessionsSchema(db)

    // 状态集单源：占位符按 FORKABLE_STATUSES 动态生成，与 shared 类型 Extract 同一份定义，
    // 调整状态集只改 shared 一处（此前 SQL 字面量与常量独立拼写，改一漏二静默失配）
    const statusPlaceholders = FORKABLE_STATUSES.map(() => '?').join(', ')

    let rows: SessionRow[]
    try {
        rows = db
            .query(
                `SELECT id,
                        CASE WHEN json_valid(metadata) THEN json_extract(metadata, '$.name') END AS name,
                        CASE WHEN json_valid(metadata) THEN json_extract(metadata, '$.summary.text') END AS summary_text,
                        CASE WHEN json_valid(metadata) THEN json_extract(metadata, '$.path') END AS path,
                        CASE WHEN json_valid(metadata) THEN json_extract(metadata, '$.nativeSessionId') END AS native_session_id,
                        CASE WHEN json_valid(metadata) THEN json_extract(metadata, '$.forkedFrom') END AS forked_from,
                        CASE WHEN json_valid(metadata) THEN json_extract(metadata, '$.forkFrom') END AS fork_from,
                        CASE WHEN json_valid(end_state) THEN json_extract(end_state, '$.reason') END AS end_reason,
                        status, updated_at
                 FROM sessions
                 WHERE namespace = ? AND status IN (${statusPlaceholders})
                 ORDER BY updated_at DESC`
            )
            .all(namespace, ...FORKABLE_STATUSES) as SessionRow[]
    } catch (error) {
        throw new SessionListingError(`读取 sessions 失败：${errorMessage(error)}`)
    }

    return rows.map(toForkableSession).filter((session): session is ForkableSession => session !== null)
}

/**
 * 读取可 fork 会话的公开入口：只读打开 → 查询 → 关闭。
 * daemon 在跑时 WAL 允许并发读；daemon 停机时退化为普通文件读取。
 */
export function listForkableSessions(dbPath: string, namespace: string): ForkableSession[] {
    const db = openReadOnly(dbPath)
    try {
        return listForkableSessionsFromDb(db, namespace)
    } finally {
        db.close()
    }
}
