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

import type { StoredMessage } from './types'
import { safeJsonParse } from './json'

type DbMessageRow = {
    id: string
    session_id: string
    content: string
    created_at: number
    seq: number
    local_id: string | null
    is_sidechain: number
    parent_tool_use_id: string | null
}

/** 从 content 中提取 isSidechain 标记 */
function extractIsSidechain(content: unknown): boolean {
    const c = content as { content?: { data?: { isSidechain?: boolean } } } | undefined
    return c?.content?.data?.isSidechain === true
}

/** 从 content 中提取 parentToolUseId */
function extractParentToolUseId(content: unknown): string | null {
    const c = content as { parentToolUseId?: string } | undefined
    return c?.parentToolUseId ?? null
}

function toStoredMessage(row: DbMessageRow): StoredMessage {
    return {
        id: row.id,
        sessionId: row.session_id,
        content: safeJsonParse(row.content),
        createdAt: row.created_at,
        seq: row.seq,
        localId: row.local_id,
        isSidechain: row.is_sidechain === 1,
        parentToolUseId: row.parent_tool_use_id,
    }
}

export function addMessage(
    db: Database,
    sessionId: string,
    content: unknown,
    localId?: string
): StoredMessage {
    const now = Date.now()

    if (localId) {
        const existing = db.prepare(
            'SELECT * FROM messages WHERE session_id = ? AND local_id = ? LIMIT 1'
        ).get(sessionId, localId) as DbMessageRow | undefined
        if (existing) {
            // 相同 localId：更新内容（resume 场景下内容可能有增量变化）
            const parentToolUseId = extractParentToolUseId(content)
            db.prepare(
                'UPDATE messages SET content = @content, parent_tool_use_id = @parent_tool_use_id WHERE id = @id'
            ).run({
                content: JSON.stringify(content),
                parent_tool_use_id: parentToolUseId,
                id: existing.id
            })
            const updated = db.prepare('SELECT * FROM messages WHERE id = ?').get(existing.id) as DbMessageRow
            return toStoredMessage(updated)
        }
    }

    const msgSeqRow = db.prepare(
        'SELECT COALESCE(MAX(seq), 0) + 1 AS nextSeq FROM messages WHERE session_id = ?'
    ).get(sessionId) as { nextSeq: number }
    const msgSeq = msgSeqRow.nextSeq

    const id = localId ?? randomUUID()
    const json = JSON.stringify(content)
    const isSidechain = extractIsSidechain(content) ? 1 : 0
    const parentToolUseId = extractParentToolUseId(content)

    db.prepare(`
        INSERT INTO messages (
            id, session_id, content, created_at, seq, local_id, is_sidechain, parent_tool_use_id
        ) VALUES (
            @id, @session_id, @content, @created_at, @seq, @local_id, @is_sidechain, @parent_tool_use_id
        )
    `).run({
        id,
        session_id: sessionId,
        content: json,
        created_at: now,
        seq: msgSeq,
        local_id: localId ?? null,
        is_sidechain: isSidechain,
        parent_tool_use_id: parentToolUseId,
    })

    const row = db.prepare('SELECT * FROM messages WHERE id = ?').get(id) as DbMessageRow | undefined
    if (!row) {
        throw new Error('Failed to create message')
    }
    return toStoredMessage(row)
}

export function getMessages(
    db: Database,
    sessionId: string,
    limit: number = 200,
    beforeSeq?: number,
    excludeSidechain: boolean = false
): StoredMessage[] {
    const safeLimit = Number.isFinite(limit) ? Math.max(1, Math.min(200, limit)) : 200
    const sidechainFilter = excludeSidechain ? ' AND is_sidechain = 0' : ''

    const rows = (beforeSeq !== undefined && beforeSeq !== null && Number.isFinite(beforeSeq))
        ? db.prepare(
            `SELECT * FROM messages WHERE session_id = ? AND seq < ?${sidechainFilter} ORDER BY seq DESC LIMIT ?`
        ).all(sessionId, beforeSeq, safeLimit) as DbMessageRow[]
        : db.prepare(
            `SELECT * FROM messages WHERE session_id = ?${sidechainFilter} ORDER BY seq DESC LIMIT ?`
        ).all(sessionId, safeLimit) as DbMessageRow[]

    return rows.reverse().map(toStoredMessage)
}

export function getMessagesAfter(
    db: Database,
    sessionId: string,
    afterSeq: number,
    limit: number = 200
): StoredMessage[] {
    const safeLimit = Number.isFinite(limit) ? Math.max(1, Math.min(200, limit)) : 200
    const safeAfterSeq = Number.isFinite(afterSeq) ? afterSeq : 0

    const rows = db.prepare(
        'SELECT * FROM messages WHERE session_id = ? AND seq > ? ORDER BY seq ASC LIMIT ?'
    ).all(sessionId, safeAfterSeq, safeLimit) as DbMessageRow[]

    return rows.map(toStoredMessage)
}

export function getSidechainMessages(
    db: Database,
    sessionId: string,
    parentToolUseId: string
): StoredMessage[] {
    const rows = db.prepare(
        'SELECT * FROM messages WHERE session_id = ? AND parent_tool_use_id = ? ORDER BY seq ASC'
    ).all(sessionId, parentToolUseId) as DbMessageRow[]
    return rows.map(toStoredMessage)
}

export function getMaxSeq(db: Database, sessionId: string): number {
    const row = db.prepare(
        'SELECT COALESCE(MAX(seq), 0) AS maxSeq FROM messages WHERE session_id = ?'
    ).get(sessionId) as { maxSeq: number } | undefined
    return row?.maxSeq ?? 0
}

export function mergeSessionMessages(
    db: Database,
    fromSessionId: string,
    toSessionId: string
): { moved: number; oldMaxSeq: number; newMaxSeq: number } {
    if (fromSessionId === toSessionId) {
        return { moved: 0, oldMaxSeq: 0, newMaxSeq: 0 }
    }

    const oldMaxSeq = getMaxSeq(db, fromSessionId)
    const newMaxSeq = getMaxSeq(db, toSessionId)

    try {
        db.exec('BEGIN')

        if (newMaxSeq > 0 && oldMaxSeq > 0) {
            db.prepare(
                'UPDATE messages SET seq = seq + ? WHERE session_id = ?'
            ).run(oldMaxSeq, toSessionId)
        }

        const collisions = db.prepare(`
            SELECT local_id FROM messages
            WHERE session_id = ? AND local_id IS NOT NULL
            INTERSECT
            SELECT local_id FROM messages
            WHERE session_id = ? AND local_id IS NOT NULL
        `).all(toSessionId, fromSessionId) as Array<{ local_id: string }>

        if (collisions.length > 0) {
            const localIds = collisions.map((row) => row.local_id)
            const placeholders = localIds.map(() => '?').join(', ')
            db.prepare(
                `UPDATE messages SET local_id = NULL WHERE session_id = ? AND local_id IN (${placeholders})`
            ).run(fromSessionId, ...localIds)
        }

        const result = db.prepare(
            'UPDATE messages SET session_id = ? WHERE session_id = ?'
        ).run(toSessionId, fromSessionId)

        db.exec('COMMIT')
        return { moved: result.changes, oldMaxSeq, newMaxSeq }
    } catch (error) {
        db.exec('ROLLBACK')
        throw error
    }
}
