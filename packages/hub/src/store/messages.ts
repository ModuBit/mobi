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

import { isQueueableUserSubmission, type MessageCategory } from '@mobi/shared'

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
    queue_state: 'pending' | 'consumed' | null
    position_at: number
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
        queueState: row.queue_state,
        positionAt: row.position_at,
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
            // 相同 localId：更新内容（resume 重放，内容可能有增量变化）。
            // queue_state 由新内容重新裁决：仍可排队 → 保留已有状态（已消费不复位为 pending）；
            // 不再可排队（如 CLI 回显）→ 归入非排队轨道（queue_state=NULL）。
            const parentToolUseId = extractParentToolUseId(content)
            const stillQueueable = isQueueableUserSubmission(content, existing.local_id)
            const queueState = stillQueueable
                ? (existing.queue_state === 'consumed' ? 'consumed' : 'pending')
                : null
            db.prepare(
                `UPDATE messages
                 SET content = @content, parent_tool_use_id = @parent_tool_use_id,
                     category = @category, queue_state = @queue_state,
                     submitted_at = CASE WHEN @queue_state = 'consumed' THEN submitted_at ELSE NULL END
                 WHERE id = @id`
            ).run({
                content: JSON.stringify(content),
                parent_tool_use_id: parentToolUseId,
                category: category,
                queue_state: queueState,
                id: existing.id,
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
    // 排队轨道的「唯一写入决策点」：denylist，CLI 来源永不排队。
    // submitted_at 仅在消费时写入；position_at 初始 = created_at（消费时跳变）。
    const queueState = isQueueableUserSubmission(content, localId) ? 'pending' : null

    db.prepare(`
        INSERT INTO messages (
            id, session_id, content, created_at, seq, local_id, is_sidechain,
            parent_tool_use_id, category, submitted_at, queue_state, position_at
        ) VALUES (
            @id, @session_id, @content, @created_at, @seq, @local_id, @is_sidechain,
            @parent_tool_use_id, @category, @submitted_at, @queue_state, @position_at
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
        submitted_at: null,
        queue_state: queueState,
        position_at: now,
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
        `SELECT position_at AS p, seq FROM messages WHERE session_id = ? AND seq = ?`
    ).get(sessionId, beforeSeq) as { p: number; seq: number } | undefined
    if (!anchor) {
        // 游标行已不存在（如排队消息被取消后物理删除）→ 停止翻页返回空，
        // 避免回退到 queryByPosition(undefined) 拿最新页造成重复消息/滚动错乱
        return []
    }
    return queryByPosition(db, sessionId, limit, anchor, sidechainFilter)
}

/**
 * 按 position_at 分页查询消息。beforeSeq 是页内最老消息的 seq（可为任意 queue_state，
 * 由 messageService.getMessagesPage 选定）。若该游标为 pending 消息且在翻页间隙被消费，
 * 其 position_at 跳变会让下一页与当前页重叠——由 Web 端 flattenMessagesPages 跨页 id 去重兜底。
 */
function queryByPosition(
    db: Database,
    sessionId: string,
    limit: number,
    before: { p: number; seq: number } | undefined,
    sidechainFilter: string
): StoredMessage[] {
    const safeLimit = Number.isFinite(limit) ? Math.max(1, Math.min(200, limit)) : 200
    const beforeClause = before
        ? 'AND (position_at < @at OR (position_at = @at AND seq < @seq))'
        : ''
    const rows = db.prepare(`
        SELECT * FROM messages
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

/** 把 localId 对应的 pending 消息翻为 consumed：写 submitted_at + 跳 position_at。返回实际更新的 localId。 */
export function markMessagesSubmitted(
    db: Database,
    sessionId: string,
    localIds: string[],
    submittedAt: number
): string[] {
    if (localIds.length === 0) return []
    // 候选 = 仍 pending 的；first-write-wins：已 consumed 的不动（position_at 已是消费时刻，不能二次跳变）
    const rows = db.prepare(
        `SELECT local_id FROM messages
         WHERE session_id = ? AND local_id IN (${localIds.map(() => '?').join(',')})
           AND queue_state = 'pending'`
    ).all(sessionId, ...localIds) as { local_id: string }[]
    const candidates = rows.map(r => r.local_id)
    if (candidates.length === 0) return []
    const result = db.prepare(
        `UPDATE messages
         SET queue_state = 'consumed', submitted_at = ?, position_at = ?
         WHERE session_id = ? AND queue_state = 'pending' AND local_id IN (${candidates.map(() => '?').join(',')})`
    ).run(submittedAt, submittedAt, sessionId, ...candidates)
    void result
    return candidates
}

/** 仍排队（queue_state='pending'）的 user 消息，用于悬浮条钉最新页。 */
export function getUnsubmittedLocalMessages(db: Database, sessionId: string): StoredMessage[] {
    const rows = db.prepare(
        `SELECT * FROM messages WHERE session_id = ? AND queue_state = 'pending' ORDER BY seq ASC`
    ).all(sessionId) as DbMessageRow[]
    return rows.map(toStoredMessage)
}

/** 删除一条仍排队（pending）的消息；已 consumed 则不删。 */
export function cancelQueuedMessage(
    db: Database,
    sessionId: string,
    localId: string
): { cancelled: boolean; submitted: boolean } {
    const row = db.prepare(
        `SELECT queue_state FROM messages WHERE session_id = ? AND local_id = ?`
    ).get(sessionId, localId) as { queue_state: 'pending' | 'consumed' | null } | undefined
    if (!row) return { cancelled: false, submitted: false }
    if (row.queue_state === 'consumed') return { cancelled: false, submitted: true }
    // TOCTOU：SELECT 与 DELETE 之间可能被 markMessagesSubmitted 翻为 consumed，用 changes 判定真实结果
    const result = db.prepare(
        `DELETE FROM messages WHERE session_id = ? AND local_id = ? AND queue_state = 'pending'`
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
        `SELECT queue_state FROM messages WHERE session_id = ? AND local_id = ?`
    ).get(sessionId, localId) as { queue_state: 'pending' | 'consumed' | null } | undefined
    if (!row) return { exists: false, submitted: false }
    return { exists: true, submitted: row.queue_state === 'consumed' }
}

/**
 * 按 seq 增量查询（seq > afterSeq）。
 *
 * 与 getMessages 的 position_at 排序**有意不同**：本函数服务 CLI REST 代理
 * `/cli/sessions/:id/messages` 的「拉取某 seq 之后全部消息」回填场景，需要稳定、
 * 单调、不受排队消费影响的捕获点，故按 seq；而 getMessages 服务 Web 分页，需要
 * 排队感知（运行中消费的消息排在 turn 之后），故按 position_at。两者面向不同消费者，
 * 不要强行统一（见 P6）。
 */
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
