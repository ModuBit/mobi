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

import type { Database } from 'bun:sqlite'
import { randomUUID } from 'node:crypto'

import type { StoredSession, VersionedUpdateResult } from './types'
import { safeJsonParse } from './json'
import { updateVersionedField } from './versionedUpdates'

type DbSessionRow = {
    id: string
    tag: string | null
    namespace: string
    machine_id: string | null
    created_at: number
    updated_at: number
    metadata: string | null
    metadata_version: number
    agent_state: string | null
    agent_state_version: number
    runtime_state: string | null
    runtime_state_updated_at: number | null
    project_id: string | null
    pinned: number
    seq: number
}

function toStoredSession(row: DbSessionRow): StoredSession {
    return {
        id: row.id,
        tag: row.tag,
        namespace: row.namespace,
        machineId: row.machine_id,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        metadata: safeJsonParse(row.metadata),
        metadataVersion: row.metadata_version,
        agentState: safeJsonParse(row.agent_state),
        agentStateVersion: row.agent_state_version,
        runtimeState: safeJsonParse(row.runtime_state),
        runtimeStateUpdatedAt: row.runtime_state_updated_at,
        projectId: row.project_id,
        pinned: row.pinned === 1,
        seq: row.seq
    }
}

export function getOrCreateSession(
    db: Database,
    tag: string,
    metadata: unknown,
    agentState: unknown,
    namespace: string,
    runtimeState?: unknown,
    projectId?: string | null
): StoredSession {
    const existing = db.prepare(
        'SELECT * FROM sessions WHERE tag = ? AND namespace = ? ORDER BY created_at DESC LIMIT 1'
    ).get(tag, namespace) as DbSessionRow | undefined

    if (existing) {
        // resume 复用：归属（project_id）不重算——已存在 session 即使本次没带 projectId
        // 也保留原归属，避免重连时意外把手工归组改掉
        // 合并新 metadata 到已有 session（新增/更新字段覆盖旧值，旧字段保留）
        const existingMetadata = (safeJsonParse(existing.metadata) as Record<string, unknown>) ?? {}
        const newMetadata = (metadata as Record<string, unknown>) ?? {}
        const merged = { ...existingMetadata, ...newMetadata }

        // 无变化时跳过写入，避免高频重连产生无意义的 DB 更新和 SSE 通知
        if (JSON.stringify(merged) === JSON.stringify(existingMetadata)) {
            return toStoredSession(existing)
        }

        const updatedAt = Date.now()

        db.prepare(`
            UPDATE sessions
            SET metadata = @metadata,
                metadata_version = metadata_version + 1,
                updated_at = @updated_at,
                seq = seq + 1
            WHERE id = @id
        `).run({
            id: existing.id,
            metadata: JSON.stringify(merged),
            updated_at: updatedAt
        })

        // 直接基于内存数据构造返回值，避免多余 DB 读取
        return {
            ...toStoredSession(existing),
            metadata: merged,
            metadataVersion: existing.metadata_version + 1,
            updatedAt,
            seq: existing.seq + 1,
        }
    }

    const now = Date.now()
    const id = randomUUID()

    const metadataJson = JSON.stringify(metadata)
    const agentStateJson = agentState === null || agentState === undefined ? null : JSON.stringify(agentState)
    const runtimeStateJson = runtimeState ? JSON.stringify(runtimeState) : null

    // 归属校验：projectId 必须指向同 namespace 的现存项目（CLI 侧把它当硬失败）
    let projectIdVerified: string | null = null
    if (projectId) {
        const project = db.prepare('SELECT id FROM projects WHERE id = ? AND namespace = ?')
            .get(projectId, namespace) as { id: string } | undefined
        if (!project) throw new Error(`Project not found: ${projectId}`)
        projectIdVerified = project.id
    }

    db.prepare(`
        INSERT INTO sessions (
            id, tag, namespace, machine_id, created_at, updated_at,
            metadata, metadata_version,
            agent_state, agent_state_version,
            runtime_state, runtime_state_updated_at,
            project_id, seq
        ) VALUES (
            @id, @tag, @namespace, NULL, @created_at, @updated_at,
            @metadata, 1,
            @agent_state, 1,
            @runtime_state, @runtime_state_updated_at,
            @project_id, 0
        )
    `).run({
        id,
        tag,
        namespace,
        created_at: now,
        updated_at: now,
        metadata: metadataJson,
        agent_state: agentStateJson,
        runtime_state: runtimeStateJson,
        runtime_state_updated_at: runtimeState ? now : null,
        project_id: projectIdVerified
    })

    const row = getSession(db, id)
    if (!row) {
        throw new Error('Failed to create session')
    }
    return row
}

export function updateSessionMetadata(
    db: Database,
    id: string,
    metadata: unknown,
    expectedVersion: number,
    namespace: string,
    options?: { touchUpdatedAt?: boolean }
): VersionedUpdateResult<unknown | null> {
    const now = Date.now()
    const touchUpdatedAt = options?.touchUpdatedAt !== false

    return updateVersionedField({
        db,
        table: 'sessions',
        id,
        namespace,
        field: 'metadata',
        versionField: 'metadata_version',
        expectedVersion,
        value: metadata,
        encode: (value) => {
            const json = JSON.stringify(value)
            return json === undefined ? null : json
        },
        decode: safeJsonParse,
        setClauses: [
            'updated_at = CASE WHEN @touch_updated_at = 1 THEN @updated_at ELSE updated_at END',
            'seq = seq + 1'
        ],
        params: {
            updated_at: now,
            touch_updated_at: touchUpdatedAt ? 1 : 0
        }
    })
}

export function updateSessionAgentState(
    db: Database,
    id: string,
    agentState: unknown,
    expectedVersion: number,
    namespace: string
): VersionedUpdateResult<unknown | null> {
    const now = Date.now()
    const normalized = agentState ?? null

    return updateVersionedField({
        db,
        table: 'sessions',
        id,
        namespace,
        field: 'agent_state',
        versionField: 'agent_state_version',
        expectedVersion,
        value: normalized,
        encode: (value) => (value === null ? null : JSON.stringify(value)),
        decode: safeJsonParse,
        setClauses: ['updated_at = @updated_at', 'seq = seq + 1'],
        params: { updated_at: now }
    })
}

/**
 * 更新运行时状态（合并了 todos、teamState 等扩展状态）
 *
 * 采用 last-writer-wins，不按 runtime_state_updated_at 做时序裁决：
 * 合并已在调用方内存层完成（读 existing → merge → 整块写），db 层再比时间戳
 * 只会误伤——同一 assistant turn 的多条 delta 落在同一毫秒，严格小于的守卫会
 * 静默丢弃后到者（changes=0 不报错），导致 task 状态停滞且不推送 web。
 * 增量同步的顺序由单调递增的 seq 保证，与时间戳无关。
 */
export function setRuntimeState(
    db: Database,
    id: string,
    runtimeState: unknown,
    updatedAt: number,
    namespace: string
): boolean {
    try {
        const json = runtimeState === null || runtimeState === undefined ? null : JSON.stringify(runtimeState)
        const result = db.prepare(`
            UPDATE sessions
            SET runtime_state = @runtime_state,
                runtime_state_updated_at = @runtime_state_updated_at,
                updated_at = CASE WHEN updated_at > @updated_at THEN updated_at ELSE @updated_at END,
                seq = seq + 1
            WHERE id = @id
              AND namespace = @namespace
        `).run({
            id,
            runtime_state: json,
            runtime_state_updated_at: updatedAt,
            updated_at: updatedAt,
            namespace
        })

        return result.changes === 1
    } catch {
        return false
    }
}

/**
 * runtime_state 字段级合并写（所有「改一个字段」调用方的单点入口）。
 *
 * 读 DB 最新值 → 按 patch 合并 → 写回，整个函数同步完成（bun:sqlite 同步 API + JS 单线程），
 * 调用方之间不存在读-改-写交叠窗口——杜绝「各自持快照全量覆盖」丢字段
 * （#62：session-message 路径落库的 todos/backgroundTasks 曾被 sessionCache
 * 陈旧内存快照的 contextUsage/model 写覆盖）。
 *
 * patch 语义：出现的 key 覆盖（value === undefined 视为清除该字段），未出现的 key 保留 DB 现值。
 * 返回 null = 会话不存在（含 namespace 不匹配）或写库失败；
 * changed = 合并结果与现值是否不同（不变时跳过写库、seq 不推进，调用方据此省略广播）。
 */
export function mergeRuntimeState(
    db: Database,
    id: string,
    patch: Record<string, unknown>,
    updatedAt: number,
    namespace: string
): { merged: Record<string, unknown>; changed: boolean } | null {
    const row = getSessionByNamespace(db, id, namespace)
    if (!row) return null

    const current = (row.runtimeState as Record<string, unknown> | null) ?? {}
    const merged: Record<string, unknown> = { ...current }
    for (const [key, value] of Object.entries(patch)) {
        if (value === undefined) {
            delete merged[key]
        } else {
            merged[key] = value
        }
    }

    // 读写之间无 await，JSON 串相等即内容相等（spread 保持 key 序）
    if (JSON.stringify(merged) === JSON.stringify(current)) {
        return { merged, changed: false }
    }
    if (!setRuntimeState(db, id, merged, updatedAt, namespace)) return null
    return { merged, changed: true }
}

/** 合法的 runtimeState 可清理字段 */
const CLEARABLE_RUNTIME_STATE_FIELDS = new Set(['todos', 'tasks', 'backgroundTasks', 'goalStatus'])

/**
 * 清除 runtimeState 中的指定字段
 * 仅允许清除 CLEARABLE_RUNTIME_STATE_FIELDS 中的字段
 */
export function clearRuntimeStateFields(
    db: Database,
    id: string,
    fields: string[],
    namespace: string
): boolean {
    const row = getSessionByNamespace(db, id, namespace)
    if (!row || !row.runtimeState) return false

    const runtimeState = row.runtimeState as Record<string, unknown>
    let changed = false

    for (const field of fields) {
        if (CLEARABLE_RUNTIME_STATE_FIELDS.has(field) && field in runtimeState) {
            delete runtimeState[field]
            changed = true
        }
    }

    if (!changed) return false

    const now = Date.now()
    try {
        const result = db.prepare(`
            UPDATE sessions
            SET runtime_state = @runtime_state,
                runtime_state_updated_at = @runtime_state_updated_at,
                updated_at = CASE WHEN updated_at > @updated_at THEN updated_at ELSE @updated_at END,
                seq = seq + 1
            WHERE id = @id
              AND namespace = @namespace
        `).run({
            id,
            namespace,
            runtime_state: JSON.stringify(runtimeState),
            runtime_state_updated_at: now,
            updated_at: now,
        })
        return result.changes === 1
    } catch {
        return false
    }
}

export function getSessionByClaudeSessionId(
    db: Database,
    nativeSessionId: string,
    namespace: string
): StoredSession | null {
    // 通过 json_extract 读取 metadata.nativeSessionId 字段查找
    // 全表扫描但 sessions 表数据量极小，性能可接受
    // 多条相同 nativeSessionId 时，取 updated_at 最新的一条；相同时取 rowid 最大（即最新插入）的一条
    const row = db.prepare(`
        SELECT * FROM sessions
        WHERE json_extract(metadata, '$.nativeSessionId') = ?
          AND namespace = ?
        ORDER BY updated_at DESC, rowid DESC
        LIMIT 1
    `).get(nativeSessionId, namespace) as DbSessionRow | undefined
    return row ? toStoredSession(row) : null
}

export function getSession(db: Database, id: string): StoredSession | null {
    const row = db.prepare('SELECT * FROM sessions WHERE id = ?').get(id) as DbSessionRow | undefined
    return row ? toStoredSession(row) : null
}

export function getSessionByNamespace(db: Database, id: string, namespace: string): StoredSession | null {
    const row = db.prepare(
        'SELECT * FROM sessions WHERE id = ? AND namespace = ?'
    ).get(id, namespace) as DbSessionRow | undefined
    return row ? toStoredSession(row) : null
}

export function getSessions(db: Database): StoredSession[] {
    const rows = db.prepare('SELECT * FROM sessions ORDER BY updated_at DESC').all() as DbSessionRow[]
    return rows.map(toStoredSession)
}

export function getRecentSessions(db: Database, limit: number): StoredSession[] {
    const rows = db.prepare(
        'SELECT * FROM sessions ORDER BY updated_at DESC LIMIT ?'
    ).all(limit) as DbSessionRow[]
    return rows.map(toStoredSession)
}

export function getSessionsByNamespace(db: Database, namespace: string): StoredSession[] {
    const rows = db.prepare(
        'SELECT * FROM sessions WHERE namespace = ? ORDER BY updated_at DESC'
    ).all(namespace) as DbSessionRow[]
    return rows.map(toStoredSession)
}

export function deleteSession(db: Database, id: string, namespace: string): boolean {
    const result = db.prepare(
        'DELETE FROM sessions WHERE id = ? AND namespace = ?'
    ).run(id, namespace)
    return result.changes > 0
}

// ============ 项目归属相关 ============

export type ProjectSessionsResult = {
    sessions: StoredSession[]
    nextCursor: number | null
    hasMore: boolean
    /** 该分组会话总数（不受 cursor 影响，用于前端显示「真实剩余」而非本地已加载剩余） */
    total: number
}

/**
 * 会话分页查询的共享实现（getSessionsByProject / getUnboundSessions 复用）。
 *
 * 单语句同时取分页数据与全集总数：内层 CTE 用 COUNT(*) OVER() 算全集
 * （仅按 whereSql 过滤，不含 cursor/LIMIT），外层套 cursor 过滤与分页。
 * 用单语句而非「SELECT + 独立 COUNT」是为了快照一致——SQLite WAL 下两条独立语句
 * 各自取读快照，中间若有 CLI 写入 session，COUNT 与分页 SELECT 会基于不同快照，
 * 致 total 与累计行数偏差、前端 remainingCount 失真。单语句天然同一快照，无竞态。
 *
 * 已知限制（记录而非修复）：游标为 `updated_at < cursor`，同一毫秒的会话在跨页
 * 边界会被整批跳过（tie-skip）。理论上可用 (updated_at, seq) 元组游标消除，但那会
 * 改变 nextCursor 的结构语义（web 端按单数字 cursor 透传），风险大于收益，故保持现状。
 */
function paginateSessions(
    db: Database,
    whereSql: string,
    params: Array<string | number | null>,
    cursor: number | null,
    limit: number = 20
): ProjectSessionsResult {
    const cursorCondition = cursor ? 'AND updated_at < ?' : ''
    const sql = `
        WITH counted AS (
            SELECT *, COUNT(*) OVER() AS total_count
            FROM sessions
            WHERE ${whereSql}
        )
        SELECT * FROM counted
        WHERE 1=1 ${cursorCondition}
        ORDER BY updated_at DESC
        LIMIT ?
    `

    const rows = cursor
        ? db.prepare(sql).all(...params, cursor, limit) as (DbSessionRow & { total_count: number })[]
        : db.prepare(sql).all(...params, limit) as (DbSessionRow & { total_count: number })[]

    const sessions = rows.map(toStoredSession)
    const hasMore = rows.length === limit
    const nextCursor = hasMore && rows.length > 0
        ? rows[rows.length - 1].updated_at
        : null
    // 全集总数从首行取（同一结果集所有行的 total_count 一致）；空结果集时为 0。
    // 例外（V5）：带 cursor 的空页通常是「剩余会话 updated_at 被顶到 cursor 之上」的瞬时
    // 边界——total 若归 0，前端 remainingCount 归 0、「展开更多」消失但会话尚未加载完。
    // 此时补一次同条件 COUNT（快照可能略有偏移，可接受）保住全集数
    let total = rows.length > 0 ? rows[0].total_count : 0
    if (rows.length === 0 && cursor !== null) {
        const counted = db.prepare(
            `SELECT COUNT(*) AS cnt FROM sessions WHERE ${whereSql}`
        ).get(...params) as { cnt: number } | undefined
        total = counted?.cnt ?? 0
    }

    return { sessions, nextCursor, hasMore, total }
}

/**
 * 按项目分页查询会话（SQL 按 updated_at 游标；前端再按 active→updatedAt 排序展示）。
 * 置顶会话不进「项目」分组（在「置顶」区展示）。
 * 快照一致语义见 paginateSessions 注释。
 */
export function getSessionsByProject(
    db: Database,
    namespace: string,
    projectId: string,
    cursor: number | null,
    limit: number = 20
): ProjectSessionsResult {
    return paginateSessions(
        db, 'namespace = ? AND project_id = ? AND pinned = 0', [namespace, projectId], cursor, limit)
}

/**
 * 游离会话分页查询（project_id IS NULL），「最近」区数据源。
 * 置顶会话不进「最近」（在「置顶」区展示）。
 * 快照一致语义见 paginateSessions 注释。
 */
export function getUnboundSessions(
    db: Database,
    namespace: string,
    cursor: number | null,
    limit: number = 20
): ProjectSessionsResult {
    return paginateSessions(
        db, 'namespace = ? AND project_id IS NULL AND pinned = 0', [namespace], cursor, limit)
}

/**
 * 置顶会话分页查询（跨项目/游离），「置顶」区数据源。
 * 快照一致语义见 paginateSessions 注释。
 */
export function getPinnedSessions(
    db: Database,
    namespace: string,
    cursor: number | null,
    limit: number = 20
): ProjectSessionsResult {
    return paginateSessions(db, 'namespace = ? AND pinned = 1', [namespace], cursor, limit)
}

/** setSessionProject 的三态结果（幂等语义见函数注释） */
export type SetSessionProjectResult =
    | 'changed'   // 归属变化，已写入（seq/updated_at 递增，调用方需广播）
    | 'noop'      // 归属未变化，幂等跳过（不递增 seq，无需广播）
    | 'not_found' // 会话不存在，或目标项目不存在 / 跨 namespace

/**
 * 归入项目 / 解绑（纯改归属，不动 metadata）；projectId 须存在且同 namespace。
 * updated_at + seq 成对递增，与 sessions 变更范式一致（SSE 增量同步靠 seq 感知）。
 * 幂等：重归入同一项目（project_id 未变）不递增 seq/updated_at，避免无意义的 SSE 扰动
 * ——`IS NOT ?` 同时覆盖 null 与非 null 两种「目标与现值相同」的情形（SQLite 的
 * 严格不等号对 NULL 恒为 NULL，IS NOT 才能正确比较）。
 */
export function setSessionProject(
    db: Database,
    id: string,
    projectId: string | null,
    namespace: string
): SetSessionProjectResult {
    if (projectId) {
        const project = db.prepare('SELECT id FROM projects WHERE id = ? AND namespace = ?')
            .get(projectId, namespace) as { id: string } | undefined
        if (!project) return 'not_found'
    }
    const result = db.prepare(
        'UPDATE sessions SET project_id = ?, updated_at = ?, seq = seq + 1 WHERE id = ? AND namespace = ? AND project_id IS NOT ?'
    ).run(projectId, Date.now(), id, namespace, projectId)
    if (result.changes > 0) return 'changed'
    // changes=0 有两种可能：幂等跳过（会话在、归属没变）或会话不存在，需区分
    return db.prepare('SELECT 1 FROM sessions WHERE id = ? AND namespace = ?')
        .get(id, namespace) ? 'noop' : 'not_found'
}

/** setSessionPinned 的三态结果（幂等语义与 setSessionProject 一致） */
export type SetSessionPinnedResult =
    | 'changed'   // 置顶态变化，已写入（seq 递增、updated_at 不动，调用方需广播）
    | 'noop'      // 置顶态未变化，幂等跳过（不递增 seq，无需广播）
    | 'not_found' // 会话不存在或跨 namespace

/**
 * 置顶 / 取消置顶。置顶是纯展示维度的分组（不改归属）：置顶 → 会话进「置顶」分组，
 * 同时从「项目」「最近」过滤掉；取消置顶反向。归属（project_id）原样保留——
 * 取消置顶后回到原分组。
 * 只递增 seq（变更代数，供 SSE 广播感知），**不动 updated_at**：分组排序与游标
 * 分页都以 updated_at 为据（paginateSessions），置顶往返若刷新它，会话会窜到
 * 分组最前，破坏原有排序。
 * 幂等：置顶态未变化时不递增 seq，避免无意义的 SSE 扰动。
 */
export function setSessionPinned(
    db: Database,
    id: string,
    pinned: boolean,
    namespace: string
): SetSessionPinnedResult {
    const target = pinned ? 1 : 0
    const result = db.prepare(
        'UPDATE sessions SET pinned = ?, seq = seq + 1 WHERE id = ? AND namespace = ? AND pinned IS NOT ?'
    ).run(target, id, namespace, target)
    if (result.changes > 0) return 'changed'
    return db.prepare('SELECT 1 FROM sessions WHERE id = ? AND namespace = ?')
        .get(id, namespace) ? 'noop' : 'not_found'
}
