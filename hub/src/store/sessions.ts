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
    active: number
    active_at: number | null
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
        active: row.active === 1,
        activeAt: row.active_at,
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
    namespace: string
): StoredSession {
    const existing = db.prepare(
        'SELECT * FROM sessions WHERE tag = ? AND namespace = ? ORDER BY created_at DESC LIMIT 1'
    ).get(tag, namespace) as DbSessionRow | undefined

    if (existing) {
        return toStoredSession(existing)
    }

    const now = Date.now()
    const id = randomUUID()

    const metadataJson = JSON.stringify(metadata)
    const agentStateJson = agentState === null || agentState === undefined ? null : JSON.stringify(agentState)

    // 计算 groupKey
    const metadataObj = metadata as { path?: string } | null
    const groupKey = extractGroupKey(metadataObj?.path)

    db.prepare(`
        INSERT INTO sessions (
            id, tag, namespace, machine_id, created_at, updated_at,
            metadata, metadata_version,
            agent_state, agent_state_version,
            runtime_state, runtime_state_updated_at,
            group_key,
            active, active_at, seq
        ) VALUES (
            @id, @tag, @namespace, NULL, @created_at, @updated_at,
            @metadata, 1,
            @agent_state, 1,
            NULL, NULL,
            @group_key,
            0, NULL, 0
        )
    `).run({
        id,
        tag,
        namespace,
        created_at: now,
        updated_at: now,
        metadata: metadataJson,
        agent_state: agentStateJson,
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
            SUM(CASE WHEN active = 1 THEN 1 ELSE 0 END) as active_count,
            MAX(updated_at) as updated_at
        FROM sessions
        WHERE namespace = ? AND group_key IS NOT NULL
        GROUP BY group_key
        ORDER BY
            MAX(active) DESC,
            MAX(updated_at) DESC
    `).all(namespace) as Array<{
        group_key: string
        total_count: number
        active_count: number
        updated_at: number
    }>

    return rows.map(row => ({
        key: row.group_key,
        name: row.group_key,
        activeCount: row.active_count,
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
        ORDER BY active DESC, updated_at DESC
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
