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
    group_key: string | null
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
        groupKey: row.group_key,
        seq: row.seq
    }
}

/**
 * 从 path 中提取分组 key
 * 规则：取 path 的最后两级目录
 * 示例：/home/user/projects/mobi/src → projects/mobi
 */
export function extractGroupKey(path: string | undefined | null): string | null {
    if (!path) return null

    // 规范化路径，处理 Windows 路径分隔符
    const normalized = path.replace(/\\/g, '/')
    const parts = normalized.split('/').filter(Boolean)

    // 边界情况处理
    if (parts.length === 0) return null
    if (parts.length === 1) return parts[0]
    return parts.slice(-2).join('/')
}

export function getOrCreateSession(
    db: Database,
    tag: string,
    metadata: unknown,
    agentState: unknown,
    namespace: string,
    runtimeState?: unknown
): StoredSession {
    const existing = db.prepare(
        'SELECT * FROM sessions WHERE tag = ? AND namespace = ? ORDER BY created_at DESC LIMIT 1'
    ).get(tag, namespace) as DbSessionRow | undefined

    if (existing) {
        // 合并新 metadata 到已有 session（新增/更新字段覆盖旧值，旧字段保留）
        const existingMetadata = safeJsonParse(existing.metadata) as Record<string, unknown> ?? {}
        const newMetadata = (metadata as Record<string, unknown>) ?? {}
        const merged = { ...existingMetadata, ...newMetadata }
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

    // 计算 groupKey
    const metadataObj = metadata as { path?: string } | null
    const groupKey = extractGroupKey(metadataObj?.path)

    db.prepare(`
        INSERT INTO sessions (
            id, tag, namespace, machine_id, created_at, updated_at,
            metadata, metadata_version,
            agent_state, agent_state_version,
            runtime_state, runtime_state_updated_at,
            group_key, seq
        ) VALUES (
            @id, @tag, @namespace, NULL, @created_at, @updated_at,
            @metadata, 1,
            @agent_state, 1,
            @runtime_state, @runtime_state_updated_at,
            @group_key, 0
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
        group_key: groupKey
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
              AND (runtime_state_updated_at IS NULL OR runtime_state_updated_at < @runtime_state_updated_at)
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

export function getSessionByClaudeSessionId(
    db: Database,
    claudeSessionId: string,
    namespace: string
): StoredSession | null {
    // 通过 json_extract 读取 metadata.claudeSessionId 字段查找
    // 全表扫描但 sessions 表数据量极小，性能可接受
    // 多条相同 claudeSessionId 时，取 updated_at 最新的一条；相同时取 rowid 最大（即最新插入）的一条
    const row = db.prepare(`
        SELECT * FROM sessions
        WHERE json_extract(metadata, '$.claudeSessionId') = ?
          AND namespace = ?
        ORDER BY updated_at DESC, rowid DESC
        LIMIT 1
    `).get(claudeSessionId, namespace) as DbSessionRow | undefined
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

// ============ 分组相关 ============

export type SessionGroup = {
    key: string
    name: string
    activeCount: number
    totalCount: number
    updatedAt: number
}

export function getSessionGroups(db: Database, namespace: string): SessionGroup[] {
    const rows = db.prepare(`
        SELECT
            group_key,
            COUNT(*) as total_count,
            MAX(updated_at) as updated_at
        FROM sessions
        WHERE namespace = ? AND group_key IS NOT NULL
        GROUP BY group_key
        ORDER BY
            MAX(updated_at) DESC
    `).all(namespace) as Array<{
        group_key: string
        total_count: number
        updated_at: number
    }>

    return rows.map(row => ({
        key: row.group_key,
        name: row.group_key,
        activeCount: 0,  // 将在 API 层从内存计算
        totalCount: row.total_count,
        updatedAt: row.updated_at
    }))
}

export type GroupSessionsResult = {
    sessions: StoredSession[]
    nextCursor: number | null
    hasMore: boolean
}

export function getSessionsByGroup(
    db: Database,
    namespace: string,
    groupKey: string,
    cursor: number | null,
    limit: number = 20
): GroupSessionsResult {
    const cursorCondition = cursor ? 'AND updated_at < ?' : ''
    const sql = `
        SELECT * FROM sessions
        WHERE namespace = ? AND group_key = ? ${cursorCondition}
        ORDER BY updated_at DESC
        LIMIT ?
    `

    const rows = cursor
        ? db.prepare(sql).all(namespace, groupKey, cursor, limit) as DbSessionRow[]
        : db.prepare(sql).all(namespace, groupKey, limit) as DbSessionRow[]

    const sessions = rows.map(toStoredSession)
    const hasMore = rows.length === limit
    const nextCursor = hasMore && rows.length > 0
        ? rows[rows.length - 1].updated_at
        : null

    return { sessions, nextCursor, hasMore }
}
