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

import { MessageContentSchema, MetadataSchema, isObject, sessionOpenLink, unwrapRoleWrappedRecordEnvelope, type ContentBlock, type ForkFromMetadata, type ForkedFromMetadata } from '@mobi/shared'

import { isContextBoundaryContent } from './messages'
import { CONTEXT_BOUNDARY_SEQ_KEY } from './contextBoundary'
import { safeJsonParse } from './json'
import { getSession, updateSessionMetadata } from './sessions'
import type { StoredMessage, StoredSession } from './types'

/**
 * fork 会话创建的存储层（fork-session spec §5.1，hub 侧点 fork 时）：
 * 单事务内完成「新建待激活会话行 + 复制锚点所在 turn 的消息行 + 插入溯源自定义消息」，
 * 建行与复制要么全成要么全不成——半成品 fork 行（有行无消息）会以空会话形态污染列表。
 */

/**
 * turn 起点判定（fork 复制切割的切割点判据，fork-session spec §2）。
 *
 * ⚠️ 与 web `packages/web/src/domain/chat/turnBoundary.ts` 的 isTurnStart **同语义、两端各自实现**
 * （web 端用于窗口裁剪、hub 端用于 fork 切割），改动信封结构时须两端同步：
 * 三种消息开启新 turn——user 信封（用户发言）、system:compact_boundary（压缩后即新上下文）、
 * context-cleared 事件（/clear 完成）。边界半边复用 isContextBoundaryContent（边界指针同判据）。
 */
export function isTurnStartContent(content: unknown): boolean {
    const record = unwrapRoleWrappedRecordEnvelope(content)
    if (!record) return false
    if (record.role === 'user') return true
    return isContextBoundaryContent(content)
}

/** 向 seq 下方找锚点所在 turn 的最近起点（主链 persistent 未删行）。
 *  sidechain 行不参与判定——侧链可能嵌 user 信封，但 turn 归组只看主链（与 web trimByTurnBoundary 同前提：
 *  sidechain 全部落在 user turn 之内不跨 turn）。找不到返回 null（理论不可达：任何锚点下方必有 user 或边界）。
 *  iterate 流式逐行判定、命中即止——行 content 可达数十 KB，.all() 会把整段范围物化进内存。 */
export function findTurnStartSeq(db: Database, sessionId: string, upToSeq: number): number | null {
    const rows = db.prepare(
        `SELECT seq, content FROM messages
         WHERE session_id = ? AND seq <= ? AND deleted_at IS NULL
           AND is_sidechain = 0 AND category = 'persistent'
         ORDER BY seq DESC`
    ).iterate(sessionId, upToSeq)
    for (const row of rows as IterableIterator<{ seq: number; content: string }>) {
        // for..of 提前返回自动 IteratorClose，游标即止
        if (isTurnStartContent(safeJsonParse(row.content))) {
            return row.seq
        }
    }
    return null
}

/**
 * 会话冻结标题解析（写入侧文案的权威语义，对齐 web getSessionDisplayName 的稳定子集）：
 * name → path 基名 → id 前 8 位。刻意不含 summary.text——summary 是动态生成物，
 * 冻结文案（消息即快照，ADR 0003）要的是身份字段。hub/legacyRefMigration 共用。
 */
export function resolveSessionTitle(metadata: unknown, sessionId: string): string {
    if (isObject(metadata)) {
        const name = metadata.name
        if (typeof name === 'string' && name.length > 0) return name
        const path = metadata.path
        if (typeof path === 'string' && path.length > 0) {
            const base = path.split('/').filter(Boolean).pop()
            if (base) return base
        }
    }
    return sessionId.slice(0, 8)
}

export interface ForkSessionAtAnchorParams {
    /** parent 会话行（含 metadata / runtimeState，作为配置快照继承源） */
    parent: StoredSession
    /** 分叉锚点行（agent 回复，engine 层已校验存在 + 在边界后） */
    anchor: StoredMessage
    /** 锚点所在 turn 的起点 seq（engine 层经 findTurnStartSeq 求得） */
    turnStartSeq: number
    /** 预生成的 fork native id（SDK sessionId option 语义保证 CC 采用，spec §3） */
    forkNativeId: string
    /** parent 当前 native session id（激活时作 resumeToken；engine 层已校验存在） */
    parentNativeId: string
}

export interface ForkSessionAtAnchorResult {
    /** 新建的 fork 会话行 id（web 跳转用） */
    sessionId: string
    /** 复制的消息行数（不含溯源消息） */
    copiedCount: number
}

/**
 * 单事务建 fork 会话：建行（预生成 native id + forkFrom/forkedFrom + 配置快照继承）
 * → 复制 [turnStartSeq..anchor.seq] 的未删行（seq 1 起按原序保序）→ 溯源自定义消息
 * 追加在复制行之后（seq = 复制行数 + 1，时间线最新位置——溯源「fork 自会话 x」
 * 紧跟被复制的内容，而非置顶最前）。
 *
 * 复制行语义（spec §5.1）：
 * - id 重新生成（messages.id 全局唯一）、session_id 改写为 fork 行
 * - lifecycle/lifecycle_at 重置中性值 null（避免 fork 会话的 ack 推进误命中 parent 时代的排队状态）
 * - metadata（nativeId/nativeSessionId 等 native 事实）原样保留——链溯源与 rewind 锚点依据
 * - local_id 保留（UNIQUE 限 session 内，fork 链上 uuid 依然有效，spec §3）
 * - category / is_sidechain / parent_tool_use_id 原样（侧链嵌套引用随整 turn 切割保持闭合）
 */
export function forkSessionAtAnchor(db: Database, params: ForkSessionAtAnchorParams): ForkSessionAtAnchorResult {
    const { parent, anchor, turnStartSeq, forkNativeId, parentNativeId } = params

    const forkFrom: ForkFromMetadata = {
        parentSessionId: parent.id,
        parentNativeId,
        anchorNativeId: anchor.metadata?.nativeId ?? anchor.id,
    }
    const forkedFrom: ForkedFromMetadata = { sessionId: parent.id }

    // 会话 metadata 继承 parent（path/host/machineId/flavor 等身份字段随行），叠加 fork 专属字段。
    // contextBoundarySeq 刻意剥离：指针语义锚定 parent 的 seq 序列，残留在 fork 行上会让 fork 消息
    // 全部误判「边界之前」（rewind 入口被锁死）——剥离后由读侧 resolve 按 fork 自身行惰性回填。
    const baseMetadata = { ...((parent.metadata ?? {}) as Record<string, unknown>) }
    delete baseMetadata[CONTEXT_BOUNDARY_SEQ_KEY]
    const forkMetadata = {
        ...baseMetadata,
        // 标题落库即区分（用户裁决：DB 里就是不同的，web 不做运行时拼接）：
        // 「〈parent 标题〉 · 分叉」，parent 标题与溯源消息同用 resolveSessionTitle 冻结语义
        // （name → path 基名 → id 前 8 位）——parent 改名后 fork 标题不跟随
        name: `${resolveSessionTitle(parent.metadata, parent.id)} · 分叉`,
        nativeSessionId: forkNativeId,
        forkFrom,
        forkedFrom,
    }
    // 声明守卫：fork 字段必须能通过 shared MetadataSchema（sessionCache 刷新按它 safeParse，
    // 未声明的字段会被 zod strip 裁掉——ticket 02 的 contextBoundarySeq 先例）
    const parsed = MetadataSchema.safeParse(forkMetadata)
    if (!parsed.success) {
        throw new Error(`fork session metadata failed MetadataSchema validation: ${parsed.error.message}`)
    }

    // 溯源消息 content（ADR 0003：mobi URI 动作链接，ref block 已退场）——文案写入时冻结
    // （消息即快照：parent 改名不跟随、删除不影响文案只影响点击落点），落库前经 shared schema 校验
    const provenanceBlocks = [
        { type: 'text', text: `fork 自会话 ${sessionOpenLink(parent.id, resolveSessionTitle(parent.metadata, parent.id))}` },
    ] satisfies ContentBlock[]
    const provenanceParsed = MessageContentSchema.safeParse(provenanceBlocks)
    if (!provenanceParsed.success) {
        throw new Error(`fork provenance message failed MessageContentSchema validation: ${provenanceParsed.error.message}`)
    }
    const provenanceContent = { role: 'custom', content: provenanceParsed.data }

    const now = Date.now()
    const run = db.transaction((): ForkSessionAtAnchorResult => {
        // 1. 新建 fork 会话行。tag 必须非空：resume spawn 后 CLI bootstrapSession 以
        //    「nativeSessionId 查行 → 复用行 tag」绑定既有行，tag NULL 会让 CLI 判定
        //    「未找到」另建新行 → hub mergeSessions 摧毁 fork 行（E2E P0 实证）。
        //    namespace / machine_id / project_id / runtime_state 继承 parent——配置快照含
        //    model/effort/outputStyle/permissionMode，激活后 CLI keep-alive 回流同值
        const forkSessionId = randomUUID()
        db.prepare(`
            INSERT INTO sessions (
                id, tag, namespace, machine_id, created_at, updated_at,
                metadata, metadata_version,
                agent_state, agent_state_version,
                runtime_state, runtime_state_updated_at,
                project_id, seq
            ) VALUES (
                @id, @tag, @namespace, @machine_id, @now, @now,
                @metadata, 1,
                NULL, 1,
                @runtime_state, @runtime_state_updated_at,
                @project_id, 0
            )
        `).run({
            id: forkSessionId,
            tag: randomUUID(),
            namespace: parent.namespace,
            machine_id: parent.machineId,
            now,
            metadata: JSON.stringify(forkMetadata),
            runtime_state: parent.runtimeState === null ? null : JSON.stringify(parent.runtimeState),
            runtime_state_updated_at: parent.runtimeState === null ? null : now,
            project_id: parent.projectId,
        })

        // 2. 复制 [turnStartSeq..anchor.seq] 的未删行：seq 从 1 起按原序保序
        type CopyRow = {
            content: string
            local_id: string | null
            metadata: string | null
            is_sidechain: number
            parent_tool_use_id: string | null
            category: string
        }
        const rows = db.prepare(
            `SELECT * FROM messages
             WHERE session_id = ? AND seq >= ? AND seq <= ? AND deleted_at IS NULL
             ORDER BY seq ASC`
        ).all(parent.id, turnStartSeq, anchor.seq) as unknown as CopyRow[]

        const insert = db.prepare(`
            INSERT INTO messages (
                id, session_id, content, created_at, seq, local_id, metadata, is_sidechain,
                parent_tool_use_id, category, lifecycle, lifecycle_at, position_at
            ) VALUES (
                @id, @session_id, @content, @created_at, @seq, @local_id, @metadata, @is_sidechain,
                @parent_tool_use_id, @category, NULL, NULL, @position_at
            )
        `)
        let seq = 1
        for (const row of rows) {
            insert.run({
                id: randomUUID(),
                session_id: forkSessionId,
                content: row.content,
                created_at: now,
                seq,
                local_id: row.local_id,
                metadata: row.metadata,
                is_sidechain: row.is_sidechain,
                parent_tool_use_id: row.parent_tool_use_id,
                category: row.category,
                position_at: now,
            })
            seq += 1
        }

        // 3. 溯源自定义消息：category='persistent'，seq 排在复制行之后（时间线最新位置，
        //    「fork 自会话 x」紧跟被复制的内容而非置顶最前）
        db.prepare(`
            INSERT INTO messages (
                id, session_id, content, created_at, seq, local_id, metadata, is_sidechain,
                parent_tool_use_id, category, lifecycle, lifecycle_at, position_at
            ) VALUES (
                @id, @session_id, @content, @created_at, @seq, NULL, NULL, 0,
                NULL, 'persistent', NULL, NULL, @position_at
            )
        `).run({
            id: randomUUID(),
            session_id: forkSessionId,
            content: JSON.stringify(provenanceContent),
            created_at: now,
            seq,
            position_at: now,
        })

        return { sessionId: forkSessionId, copiedCount: rows.length }
    })

    return run()
}

/**
 * fork 行激活失败的 hub 侧标记（spec §5.3「CLI 离线 / 机器关机」场景：CLI 进程内的
 * forkError 上报通道不可达，错误态由 hub 直接落 metadata）。保留 forkFrom（未激活判定
 * 与删除守卫的依据，shared FORK_ERROR_METADATA 契约），叠加 forkError。
 * 走 metadata_version CAS 重试一次即放弃（尽力而为，对齐 advanceContextBoundarySeq）。
 *
 * @returns 是否写入成功（会话不存在 / 并发放弃为 false，调用方仅 warn）
 */
export function markForkActivationError(
    db: Database,
    sessionId: string,
    code: string,
    detail?: string,
): boolean {
    for (let attempt = 0; attempt < 2; attempt++) {
        const stored = getSession(db, sessionId)
        if (!stored) return false

        // StoredSession.metadata 已是解析后的对象（unknown | null），直接叠加
        const baseMetadata = isObject(stored.metadata) ? stored.metadata : {}
        const result = updateSessionMetadata(
            db,
            sessionId,
            { ...baseMetadata, forkError: { code, at: Date.now(), ...(detail ? { detail } : {}) } },
            stored.metadataVersion,
            stored.namespace,
            // 纯簿记标记：不动 updated_at（对齐 advanceContextBoundarySeq）
            { touchUpdatedAt: false }
        )
        if (result.result === 'success') return true
        if (result.result === 'error') return false
        // version-mismatch → 循环重试一次
    }
    return false
}

/** fork 会话创建领域存储（Store 聚合的子 Store，见 hub 编码规范；ContextBoundaryStore 同例） */
export class SessionForkStore {
    private readonly db: Database

    constructor(db: Database) {
        this.db = db
    }

    /** 向 seq 下方找锚点所在 turn 的最近起点（见 findTurnStartSeq）；null = 找不到（防御分支） */
    findTurnStartSeq(sessionId: string, upToSeq: number): number | null {
        return findTurnStartSeq(this.db, sessionId, upToSeq)
    }

    /** 单事务建 fork 会话（见 forkSessionAtAnchor） */
    forkSessionAtAnchor(params: ForkSessionAtAnchorParams): ForkSessionAtAnchorResult {
        return forkSessionAtAnchor(this.db, params)
    }

    /** 激活失败落 forkError（spec §5.3 CLI 离线场景，见 markForkActivationError） */
    markForkActivationError(sessionId: string, code: string, detail?: string): boolean {
        return markForkActivationError(this.db, sessionId, code, detail)
    }
}
