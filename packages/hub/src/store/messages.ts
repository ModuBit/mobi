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

import type { MessageCategory } from '@mobi/shared'

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
    category: string
    submitted_at: number | null
}

/** 历史查询的 category 过滤条件（只返回 persistent 消息） */
const HISTORY_CATEGORY_FILTER = "category = 'persistent'"

/**
 * 从 content（RawJSONLines 对象）中提取 isSidechain 标记
 * content 结构为 { content: { data: { isSidechain: boolean } }, parentToolUseId: string, ... }
 */
function extractIsSidechain(content: unknown): boolean {
    const c = content as { content?: { data?: { isSidechain?: boolean } } } | undefined
    return c?.content?.data?.isSidechain === true
}

/** 从 content 中提取 parentToolUseId */
function extractParentToolUseId(content: unknown): string | null {
    const c = content as { parentToolUseId?: string; content?: { data?: { parentToolUseId?: string } } } | undefined
    return c?.parentToolUseId ?? c?.content?.data?.parentToolUseId ?? null
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
        category: row.category,
        submittedAt: row.submitted_at,
    }
}

export function addMessage(
    db: Database,
    sessionId: string,
    content: unknown,
    localId: string | null | undefined,
    category: MessageCategory = 'persistent',
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
                'UPDATE messages SET content = @content, parent_tool_use_id = @parent_tool_use_id, category = @category WHERE id = @id'
            ).run({
                content: JSON.stringify(content),
                parent_tool_use_id: parentToolUseId,
                category: category,
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
    const role = (content as { role?: string } | null)?.role
    // 仅「带 localId 的 user 消息」排队（submittedAt=null，悬浮等采纳）；
    // agent 消息虽然也带 localId（=其 uuid），但 role≠user，立即定位不悬浮
    const submittedAt = (role === 'user' && localId) ? null : now

    db.prepare(`
        INSERT INTO messages (
            id, session_id, content, created_at, seq, local_id, is_sidechain, parent_tool_use_id, category, submitted_at
        ) VALUES (
            @id, @session_id, @content, @created_at, @seq, @local_id, @is_sidechain, @parent_tool_use_id, @category, @submitted_at
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
        category: category,
        submitted_at: submittedAt,
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
    const sidechainFilter = excludeSidechain ? 'AND is_sidechain = 0' : ''
    if (beforeSeq === undefined || beforeSeq === null || !Number.isFinite(beforeSeq)) {
        return queryByPosition(db, sessionId, limit, undefined, sidechainFilter)
    }
    const anchor = db.prepare(
        `SELECT COALESCE(submitted_at, created_at) AS p, seq FROM messages WHERE session_id = ? AND seq = ?`
    ).get(sessionId, beforeSeq) as { p: number; seq: number } | undefined
    if (!anchor) {
        // 游标行已不存在（如排队消息被取消后物理删除）→ 停止翻页返回空，
        // 避免回退到 queryByPosition(undefined) 拿最新页造成重复消息/滚动错乱
        return []
    }
    return queryByPosition(db, sessionId, limit, anchor, sidechainFilter)
}

/** 按 position（COALESCE(submitted_at, created_at)）分页查询消息 */
function queryByPosition(
    db: Database,
    sessionId: string,
    limit: number,
    before: { p: number; seq: number } | undefined,
    sidechainFilter: string
): StoredMessage[] {
    const safeLimit = Number.isFinite(limit) ? Math.max(1, Math.min(200, limit)) : 200
    const beforeClause = before
        ? 'AND (COALESCE(submitted_at, created_at) < @at OR (COALESCE(submitted_at, created_at) = @at AND seq < @seq))'
        : ''
    const rows = db.prepare(`
        SELECT *, COALESCE(submitted_at, created_at) AS position_at
        FROM messages
        WHERE session_id = @sessionId AND category = 'persistent' ${sidechainFilter} ${beforeClause}
        ORDER BY position_at DESC, seq DESC
        LIMIT @limit
    `).all({
        sessionId,
        at: before?.p ?? null,
        seq: before?.seq ?? null,
        limit: safeLimit,
    }) as DbMessageRow[]
    return rows.reverse().map(toStoredMessage)
}

/** 把 localId 对应的消息 submitted_at 设为给定值；已设过的不动。返回实际更新的 localId。 */
export function markMessagesSubmitted(
    db: Database,
    sessionId: string,
    localIds: string[],
    submittedAt: number
): string[] {
    if (localIds.length === 0) return []
    // 先查哪些还没 submit（候选），再 UPDATE，用 changes 校准
    const rows = db.prepare(
        `SELECT local_id FROM messages
         WHERE session_id = ? AND local_id IN (${localIds.map(() => '?').join(',')})
           AND submitted_at IS NULL`
    ).all(sessionId, ...localIds) as { local_id: string }[]
    const candidates = rows.map(r => r.local_id)
    if (candidates.length === 0) return []
    const result = db.prepare(
        `UPDATE messages SET submitted_at = ? WHERE session_id = ? AND submitted_at IS NULL AND local_id IN (${candidates.map(() => '?').join(',')})`
    ).run(submittedAt, sessionId, ...candidates)
    // 单连接同步执行，SELECT 与 UPDATE 之间无其他写入，changes 必等于 candidates.length。
    // 直接返回 candidates（之前用 slice(0, changes) 是死代码且语义错误——它假设前 N 个被更新）。
    void result
    return candidates
}

/** 仍排队（submitted_at IS NULL 且有 local_id）的 user 消息，用于悬浮条钉最新页。 */
export function getUnsubmittedLocalMessages(db: Database, sessionId: string): StoredMessage[] {
    const rows = db.prepare(
        `SELECT * FROM messages WHERE session_id = ? AND submitted_at IS NULL AND local_id IS NOT NULL ORDER BY seq ASC`
    ).all(sessionId) as DbMessageRow[]
    return rows.map(toStoredMessage)
}

/** 删除一条仍排队的消息；已 submit 则不删。 */
export function cancelQueuedMessage(
    db: Database,
    sessionId: string,
    localId: string
): { cancelled: boolean; submitted: boolean } {
    const row = db.prepare(
        `SELECT submitted_at FROM messages WHERE session_id = ? AND local_id = ?`
    ).get(sessionId, localId) as { submitted_at: number | null } | undefined
    if (!row) return { cancelled: false, submitted: false }
    if (row.submitted_at !== null) return { cancelled: false, submitted: true }
    // TOCTOU：SELECT 与 DELETE 之间可能被 submit，用 changes 判定真实结果
    const result = db.prepare(
        `DELETE FROM messages WHERE session_id = ? AND local_id = ? AND submitted_at IS NULL`
    ).run(sessionId, localId)
    return { cancelled: result.changes > 0, submitted: result.changes === 0 }
}

/** 查询某 localId 消息的提交状态（非破坏性）。exists=false 表示 DB 中无此消息。 */
export function getMessageSubmitState(
    db: Database,
    sessionId: string,
    localId: string
): { exists: boolean, submitted: boolean } {
    const row = db.prepare(
        `SELECT submitted_at FROM messages WHERE session_id = ? AND local_id = ?`
    ).get(sessionId, localId) as { submitted_at: number | null } | undefined
    if (!row) return { exists: false, submitted: false }
    return { exists: true, submitted: row.submitted_at !== null }
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
        `SELECT * FROM messages WHERE ${HISTORY_CATEGORY_FILTER} AND session_id = ? AND seq > ? ORDER BY seq ASC LIMIT ?`
    ).all(sessionId, safeAfterSeq, safeLimit) as DbMessageRow[]

    return rows.map(toStoredMessage)
}

const SIDECHAIN_MESSAGE_LIMIT = 200

export function getSidechainMessages(
    db: Database,
    sessionId: string,
    parentToolUseId: string
): StoredMessage[] {
    const rows = db.prepare(
        `SELECT * FROM messages WHERE ${HISTORY_CATEGORY_FILTER} AND session_id = ? AND parent_tool_use_id = ? ORDER BY seq DESC LIMIT ?`
    ).all(sessionId, parentToolUseId, SIDECHAIN_MESSAGE_LIMIT) as DbMessageRow[]
    return rows.reverse().map(toStoredMessage)
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
