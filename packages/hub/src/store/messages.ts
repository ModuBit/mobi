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

import { isQueueableUserSubmission, type MessageCategory, type NativeMessageMetadata } from '@mobi/shared'

import type { StoredMessage } from './types'
import { safeJsonParse } from './json'

type DbMessageRow = {
    id: string
    session_id: string
    content: string
    created_at: number
    seq: number
    local_id: string | null
    /** 上游 native 事实 JSON（{ nativeId?, nativeSessionId? }）；NULL = 未记录 */
    metadata: string | null
    /** 软删除时刻（rewind 截断）；NULL = 未删除 */
    deleted_at: number | null
    is_sidechain: number
    parent_tool_use_id: string | null
    category: string
    submitted_at: number | null
    queue_state: 'pending' | 'consumed' | null
    position_at: number
}

/** 历史查询的 category 过滤条件（只返回 persistent 消息） */
const HISTORY_CATEGORY_FILTER = "category = 'persistent'"

/** 读取路径统一过滤软删除行（rewind 截断后不可见，行保留兜底可找回） */
const NOT_DELETED_FILTER = 'AND deleted_at IS NULL'

/** metadata JSON 中 nativeId 缺失的判定片段（first-write-wins 守卫） */
const NATIVE_ID_MISSING_GUARD = "json_extract(COALESCE(metadata, '{}'), '$.nativeId') IS NULL"

/** 解析 metadata 列 JSON（NULL / 损坏 → null，损坏时不当作已记录事实） */
function parseMetadata(raw: string | null): NativeMessageMetadata | null {
    return (safeJsonParse(raw) as NativeMessageMetadata | null) ?? null
}

/** 序列化 metadata（无有效字段 → null 列，避免落 '{}' 空对象噪音） */
function serializeMetadata(metadata: NativeMessageMetadata | null): string | null {
    if (!metadata || (metadata.nativeId === undefined && metadata.nativeSessionId === undefined && metadata.nativeAckAt === undefined)) {
        return null
    }
    return JSON.stringify(metadata)
}

/**
 * 合并 native 事实（first-write-wins）：只补空缺字段，已有值（含已有 nativeSessionId）不覆盖。
 * 供 addMessage 的 resume 重放更新分支使用（SQL COALESCE 语义的 TS 等价物，因需同时保两类 key）。
 */
function mergeMetadata(existing: NativeMessageMetadata | null, incoming: NativeMessageMetadata | null): NativeMessageMetadata {
    return {
        nativeId: existing?.nativeId ?? incoming?.nativeId,
        nativeSessionId: existing?.nativeSessionId ?? incoming?.nativeSessionId,
        nativeAckAt: existing?.nativeAckAt ?? incoming?.nativeAckAt,
    }
}

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
        metadata: parseMetadata(row.metadata),
        deletedAt: row.deleted_at,
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
    metadata: NativeMessageMetadata | null = null,
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
            // native 事实 first-write-wins：只补空缺，已有值不覆盖（对齐旧 native_id COALESCE 语义）
            const parentToolUseId = extractParentToolUseId(content)
            const stillQueueable = isQueueableUserSubmission(content, existing.local_id)
            const queueState = stillQueueable
                ? (existing.queue_state === 'consumed' ? 'consumed' : 'pending')
                : null
            const mergedMetadata = mergeMetadata(parseMetadata(existing.metadata), metadata)
            db.prepare(
                `UPDATE messages
                 SET content = @content, parent_tool_use_id = @parent_tool_use_id,
                     category = @category, queue_state = @queue_state,
                     metadata = @metadata,
                     submitted_at = CASE WHEN @queue_state = 'consumed' THEN submitted_at ELSE NULL END
                 WHERE id = @id`
            ).run({
                content: JSON.stringify(content),
                parent_tool_use_id: parentToolUseId,
                category: category,
                queue_state: queueState,
                metadata: serializeMetadata(mergedMetadata),
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
            id, session_id, content, created_at, seq, local_id, metadata, is_sidechain,
            parent_tool_use_id, category, submitted_at, queue_state, position_at
        ) VALUES (
            @id, @session_id, @content, @created_at, @seq, @local_id, @metadata, @is_sidechain,
            @parent_tool_use_id, @category, @submitted_at, @queue_state, @position_at
        )
    `).run({
        id,
        session_id: sessionId,
        content: json,
        created_at: now,
        seq: msgSeq,
        local_id: localId ?? null,
        metadata: serializeMetadata(metadata),
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
        // 避免回退到 queryByPosition(undefined) 拿最新页造成重复消息/滚动错乱。
        // 注意此处不过滤 deleted_at：软删除行仍可作翻页坐标（rewind 后更早历史要继续可翻），
        // 页内行由 queryByPosition 的 NOT_DELETED_FILTER 保证不含软删除行
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
        WHERE session_id = @sessionId AND category = 'persistent' ${sidechainFilter} ${beforeClause} ${NOT_DELETED_FILTER}
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

/** 绑定用户消息的 native 锚点到 metadata（push 时上报）。只补 nativeId 空缺的行——幂等，
 *  重复上报/重发不覆盖；已有 nativeSessionId 保留（message 事件可能先写入）。返回补写后的行
 *  （供 handler 广播消息更新，Web 端据此刷新 rewind 判据——否则补写只落库、Web 端已渲染的行
 *  不更新，hover 不显 rewind icon，刷新才见）。 */
export function bindNativeIds(
    db: Database,
    sessionId: string,
    bindings: { localId: string; metadata: { nativeId: string; nativeSessionId?: string } }[],
): StoredMessage[] {
    if (bindings.length === 0) return []
    // json_set 的 SQL NULL 值会落成 json null，故 nativeSessionId 拆两条语句：
    // 仅在绑定确带值时才 set 该 key（COALESCE 保已有值，first-write-wins）
    const setNativeIdOnly = db.prepare(`
        UPDATE messages
        SET metadata = json_set(COALESCE(metadata, '{}'), '$.nativeId', @nativeId)
        WHERE session_id = @sid AND local_id = @localId AND ${NATIVE_ID_MISSING_GUARD}
    `)
    const setNativeIdWithSession = db.prepare(`
        UPDATE messages
        SET metadata = json_set(
            json_set(COALESCE(metadata, '{}'), '$.nativeId', @nativeId),
            '$.nativeSessionId', COALESCE(json_extract(COALESCE(metadata, '{}'), '$.nativeSessionId'), @nativeSessionId))
        WHERE session_id = @sid AND local_id = @localId AND ${NATIVE_ID_MISSING_GUARD}
    `)
    // local_id 有 UNIQUE INDEX（session_id, local_id），一行一 localId，回读补写后的完整行供广播
    const selectByLocalId = db.prepare(
        'SELECT * FROM messages WHERE session_id = ? AND local_id = ? LIMIT 1'
    )
    // 事务包裹：批次原子落库，避免逐条 autocommit 在中途失败时残留半批绑定（1:N 批内共享同一 nativeId）
    const run = db.transaction((): StoredMessage[] => {
        const bound: StoredMessage[] = []
        for (const b of bindings) {
            const stmt = b.metadata.nativeSessionId ? setNativeIdWithSession : setNativeIdOnly
            const result = stmt.run({
                nativeId: b.metadata.nativeId,
                nativeSessionId: b.metadata.nativeSessionId ?? null,
                sid: sessionId,
                localId: b.localId,
            })
            if (result.changes > 0) {
                const row = selectByLocalId.get(sessionId, b.localId) as DbMessageRow | undefined
                if (row) bound.push(toStoredMessage(row))
            }
        }
        return bound
    })
    return run()
}

/** 标记 CC 已接收（isReplay 回显）。按 native_id 生成列索引查询，first-write-wins：
 *  重复 ack / 无此 nativeId 行返回 null。返回更新后的完整行（供 handler 广播 Web 刷新
 *  rewind 判据）。ackAt 落 metadata.nativeAckAt（与 nativeId/nativeSessionId 同族 JSON）。 */
export function markMessagesAcked(
    db: Database,
    sessionId: string,
    nativeId: string,
    ackAt: number,
): StoredMessage | null {
    const result = db.prepare(`
        UPDATE messages
        SET metadata = json_set(COALESCE(metadata, '{}'), '$.nativeAckAt', @ackAt)
        WHERE session_id = @sid AND native_id = @nativeId
          AND json_extract(COALESCE(metadata, '{}'), '$.nativeAckAt') IS NULL
    `).run({ ackAt, sid: sessionId, nativeId })
    if (result.changes === 0) return null
    const row = db.prepare(
        'SELECT * FROM messages WHERE session_id = ? AND native_id = ? LIMIT 1'
    ).get(sessionId, nativeId) as DbMessageRow | undefined
    return row ? toStoredMessage(row) : null
}

/** attach 补写：该会话所有缺 nativeSessionId 的行补上新 session id。幂等（重复上报无行可补）。
 *  含误补旧行（/clear 前消息）——设计如此：deploy 后存量自愈靠它，误判可 rewind 的行由 CLI 预检拒绝。
 *  返回补写后的行（供 handler 广播消息更新，Web 端刷新 rewind 判据）。 */
export function attachNativeSessionId(
    db: Database,
    sessionId: string,
    nativeSessionId: string,
): StoredMessage[] {
    const run = db.transaction((): StoredMessage[] => {
        const rows = db.prepare(`
            SELECT * FROM messages
            WHERE session_id = ? AND json_extract(COALESCE(metadata, '{}'), '$.nativeSessionId') IS NULL
        `).all(sessionId) as DbMessageRow[]
        if (rows.length === 0) return []
        const stmt = db.prepare(
            `UPDATE messages SET metadata = json_set(COALESCE(metadata, '{}'), '$.nativeSessionId', ?) WHERE id = ?`
        )
        return rows.map(row => {
            stmt.run(nativeSessionId, row.id)
            // 事务内行未被并发修改，TS 侧合并 overlay 避免二次回读
            const merged = { ...parseMetadata(row.metadata), nativeSessionId }
            return { ...toStoredMessage(row), metadata: merged }
        })
    })
    return run()
}

/** 软删除：seq >= fromSeq 且未删的行打 deleted_at（rewind 截断；行保留兜底可找回）。
 *  幂等：已删行不再计入。返回删除行数。 */
export function softDeleteMessagesFrom(
    db: Database,
    sessionId: string,
    fromSeq: number,
): number {
    const result = db.prepare(
        `UPDATE messages SET deleted_at = @now
         WHERE session_id = @sid AND seq >= @fromSeq AND deleted_at IS NULL`
    ).run({ now: Date.now(), sid: sessionId, fromSeq })
    return result.changes
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
        `SELECT * FROM messages WHERE session_id = ? AND queue_state = 'pending' ${NOT_DELETED_FILTER} ORDER BY seq ASC`
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
        `SELECT * FROM messages WHERE ${HISTORY_CATEGORY_FILTER} AND session_id = ? AND seq > ? ${NOT_DELETED_FILTER} ORDER BY seq ASC LIMIT ?`
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
        `SELECT * FROM messages WHERE ${HISTORY_CATEGORY_FILTER} AND session_id = ? AND parent_tool_use_id = ? ${NOT_DELETED_FILTER} ORDER BY seq DESC LIMIT ?`
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
