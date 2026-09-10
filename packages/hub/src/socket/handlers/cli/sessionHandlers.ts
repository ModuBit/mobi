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

import { ContextUsageSchema, GoalStatusSchema, SnapshotDeltaFrameSchema, type ClientToServerEvents } from '@mobi/shared'
import type { MessageCategory } from '@mobi/shared'
import { z } from 'zod'
import { randomUUID } from 'node:crypto'
import { hubLogger } from '../../../logger'
import type { Store, StoredMessage, StoredSession } from '../../../store'
import type { SyncEvent } from '../../../sync/syncEngine'
import type { SessionFactsSink } from '../../../sync/sessionFacts'
import type { BackgroundTaskTracker } from '../../../sync/backgroundTaskTracker'
import type { RewindDeleteBoundTracker } from '../../../sync/rewindDeleteBoundTracker'
import type { SnapshotSync } from '../../../sync/snapshotSync'
import { toDecryptedMessage } from '../../../sync/messageService'
import { isContextBoundaryContent } from '../../../store/messages'
import {
    SessionMessageFactsProcessor,
    type MessageFactsPublication,
} from '../../../sync/sessionMessageFactsProcessor'
import { SessionMessageRuntimeProjector } from '../../../sync/sessionMessageRuntimeProjector'
import type { CliSocketWithData } from '../../socketTypes'
import type { AccessErrorReason, AccessResult } from './types'

type ResolveSessionAccess = (sessionId: string) => AccessResult<StoredSession>

type EmitAccessError = (scope: 'session' | 'machine', id: string, reason: AccessErrorReason) => void

type UpdateMetadataHandler = ClientToServerEvents['update-metadata']
type UpdateStateHandler = ClientToServerEvents['update-state']

const messageSchema = z.object({
    sid: z.string(),
    // message 任意形状（内容信封）；增量帧（snapshotDelta 路径）下可为 undefined
    message: z.union([z.string(), z.unknown()]).optional(),
    localId: z.string().optional(),
    /** 上游 native 事实（rewind 锚点）：CLI 在 SDK 下发消息时自带，两者无时序问题 */
    metadata: z.object({
        nativeId: z.string().optional(),
        nativeSessionId: z.string().optional()
    }).optional(),
    snapshot: z.boolean().optional(),
    /** 全量帧的 rev 标记（delta 协议）：新 CLI 携带，缺省 = legacy 全量（直通不建链） */
    frame: z.object({ rev: z.number().int().nonnegative(), baseRev: z.null() }).optional(),
    /** 增量帧（delta 协议）：携带时 message 缺省，走拼接器 apply 路径 */
    snapshotDelta: SnapshotDeltaFrameSchema.optional(),
    category: z.enum(['discard', 'ephemeral', 'persistent']).optional()
})

const updateMetadataSchema = z.object({
    sid: z.string(),
    expectedVersion: z.number().int(),
    metadata: z.unknown()
})

const updateStateSchema = z.object({
    sid: z.string(),
    expectedVersion: z.number().int(),
    agentState: z.unknown().nullable()
})

export type SessionHandlersDeps = {
    store: Store
    resolveSessionAccess: ResolveSessionAccess
    emitAccessError: EmitAccessError
    /** 活跃后台任务集合（写侧：background_tasks_changed replace；读侧：rewind API 闸门） */
    backgroundTaskTracker: BackgroundTaskTracker
    /** 快照同步 module：接收已校验的全量/增量帧并维护流生命周期。 */
    snapshotSync: SnapshotSync
    /** rewind 软删除上界（读侧：rewind-truncated 消费；写侧：SyncEngine 受理时 mark，共用实例） */
    rewindDeleteBoundTracker?: RewindDeleteBoundTracker
    /** 会话事实上报落库入口（深化候选③：单一声明源见 sync/sessionFacts.ts，
     *  实现方为 SyncEngine/SessionCache——此前五个 onXxx 回调在此/在 CliHandlersDeps/
     *  SocketServerDeps 手写三遍且已漂移） */
    factsSink?: SessionFactsSink
    onWebappEvent?: (event: SyncEvent) => void
}

export function registerSessionHandlers(socket: CliSocketWithData, deps: SessionHandlersDeps): void {
    const { store, resolveSessionAccess, emitAccessError, backgroundTaskTracker, rewindDeleteBoundTracker, snapshotSync, factsSink, onWebappEvent } = deps

    // runtimeState 投影内部持有跨消息配对状态，故每个 Socket 连接独立实例化。
    const runtimeProjector = new SessionMessageRuntimeProjector(store, backgroundTaskTracker)
    // attached 事实同样建立连接级 native session 上下文，每个 Socket 独立实例化。
    const messageFactsProcessor = new SessionMessageFactsProcessor(store)

    /** 事实处理 module 只返回领域 publication；Socket adapter 在此翻译为 room + SSE 通知。 */
    const broadcastStoredMessages = (
        sid: string,
        msgs: StoredMessage[],
        options?: { backfill?: boolean },
    ): void => {
        const backfillFlag = options?.backfill ? { backfill: true as const } : undefined
        for (const msg of msgs) {
            const base = toDecryptedMessage(msg)
            const message = { ...base, seq: msg.seq }
            socket.to(`session:${sid}`).emit('session-update', {
                id: randomUUID(),
                seq: msg.seq,
                createdAt: Date.now(),
                body: {
                    t: 'new-message' as const,
                    sid,
                    message,
                    ...backfillFlag,
                },
            })
            onWebappEvent?.({
                type: 'message-received',
                sessionId: sid,
                message: base,
                ...backfillFlag,
            })
        }
    }

    const publishMessageFacts = (publications: MessageFactsPublication[]): void => {
        for (const publication of publications) {
            if (publication.type === 'stored-messages') {
                broadcastStoredMessages(publication.sessionId, publication.messages, {
                    backfill: publication.backfill,
                })
            } else {
                onWebappEvent?.(publication)
            }
        }
    }

    socket.on('session-message', (data: unknown) => {
        const parsed = messageSchema.safeParse(data)
        if (!parsed.success) {
            // 帧被拒即流断（后续 delta 全失配），必须留痕——静默丢弃会让冻死无法归因
            hubLogger.warn(`[snapshot-delta] session-message 载荷校验失败: ${parsed.error.issues[0]?.path.join('.') ?? '?'} ${parsed.error.issues[0]?.message ?? ''}`)
            return
        }

        const { sid, localId, snapshot } = parsed.data

        // 增量帧与全量基线：Socket adapter 只负责载荷与访问校验；版本衔接和缓存推进由 SnapshotSync 决定。
        if (parsed.data.snapshotDelta || snapshot) {
            const sessionAccess = resolveSessionAccess(sid)
            if (!sessionAccess.ok) {
                emitAccessError('session', sid, sessionAccess.reason)
                return
            }
            const result = snapshotSync.ingest(parsed.data.snapshotDelta
                ? { kind: 'delta', sessionId: sid, frame: parsed.data.snapshotDelta }
                : {
                    kind: 'full',
                    sessionId: sid,
                    localId: localId ?? null,
                    content: parsed.data.message,
                    rev: parsed.data.frame?.rev ?? null,
                })
            if (result.status === 'accepted') onWebappEvent?.(result.publication)
            return
        }

        const raw = parsed.data.message

        const content = typeof raw === 'string'
            ? (() => {
                try {
                    return JSON.parse(raw) as unknown
                } catch {
                    return raw
                }
            })()
            : raw

        const sessionAccess = resolveSessionAccess(sid)
        if (!sessionAccess.ok) {
            emitAccessError('session', sid, sessionAccess.reason)
            return
        }
        const session = sessionAccess.value

        // 使用 CLI 传来的 category（CLI 已在发送端分类），降级为 persistent
        const category: MessageCategory = parsed.data.category ?? 'persistent'

        // 落库自动补 nsid：CLI 本地合成行（!bash 工具对、sendSessionEvent 事件行）不经 SDK、
        // 无 session_id 可抄，落库后滞留 attach 孤儿池——每次 CLI 进程重启（resume）首条消息
        // 触发 attach 时整池重播，窗口外旧行被 web 误当新消息 append（ghost 气泡）。
        // 取「本连接已上报」的 nsid 补上；本轮未上报（resume 的 pre-SDK 窗口 / 首条消息前）
        // 保持缺省，仍由 attach 兜底——绝不读 session.metadata（跨时代残留旧值）
        const metadata = messageFactsProcessor.enrichMetadata(sid, parsed.data.metadata ?? null)

        const msg = store.messages.addMessage(sid, content, localId, category, metadata)

        // 终态已持久化：兼容清理同 localId 的流式快照。
        snapshotSync.messagePersisted(sid, localId ?? null)

        // 边界指针推进（fork/rewind 入口判据，fork-session spec §2）。两个写入时机：
        // compact_boundary 落库 → 该行 seq；context-cleared 事件到达 → 当前 MAX(seq)。
        // 二者刚落库后 MAX 恒含该行 seq，统一取 MAX 兼容 resume 重放去重路径下
        // msg.seq 落后于当前 MAX 的情况；单调守卫在 advance 内部（不回退、幂等）
        if (isContextBoundaryContent(content)) {
            store.contextBoundary.advance(sid, store.messages.getMaxSeq(sid))
            // 指针写在 session metadata 上，必须广播 session-updated 驱动 web 缓存失效——
            // web 的 fork/rewind 入口读 SessionMetadataSummary.contextBoundarySeq，
            // 不广播则 compact/clear 后不刷新页面时入口不消失（陈旧缓存放行，前端实测坑）
            onWebappEvent?.({ type: 'session-updated', sessionId: sid, data: store.sessions.getSession(sid) })
        }

        for (const runtimeState of runtimeProjector.project({
            sessionId: sid,
            namespace: session.namespace,
            content,
        })) {
            onWebappEvent?.({
                type: 'session-updated',
                sessionId: sid,
                data: { sid, runtimeState },
            })
        }

        // update 事件的 new-message 体受 shared UpdateNewMessageBodySchema 约束（seq: number）——
        // 刚落库的行 seq 恒为 number，此处显式收窄，其余字段复用统一 DTO 映射
        const message = { ...toDecryptedMessage(msg), seq: msg.seq }
        const update = {
            id: randomUUID(),
            seq: msg.seq,
            createdAt: Date.now(),
            body: {
                t: 'new-message' as const,
                sid,
                message
            }
        }
        socket.to(`session:${sid}`).emit('session-update', update)

        onWebappEvent?.({
            type: 'message-received',
            sessionId: sid,
            message: toDecryptedMessage(msg)
        })
    })

    // snapshot 流结束（delta 协议）：full message 已持久化，精确清理该流的缓存与全部订阅游标。
    // full 的 localId（jsonl uuid）与流的 sdkUuid 不同，hub 无法自行映射——信号由 CLI 在
    // 标记 fullDelivered 时附带发出（老 hub 无此 handler，静默忽略，零兼容风险）
    socket.on('snapshot-stream-end', (data: { sid?: unknown; localId?: unknown }) => {
        if (!data || typeof data.sid !== 'string' || typeof data.localId !== 'string' || data.localId.length === 0) {
            return
        }
        const sessionAccess = resolveSessionAccess(data.sid)
        if (!sessionAccess.ok) {
            emitAccessError('session', data.sid, sessionAccess.reason)
            return
        }
        snapshotSync.endStream(data.sid, data.localId)
    })

    const handleUpdateMetadata: UpdateMetadataHandler = (data, cb) => {
        const parsed = updateMetadataSchema.safeParse(data)
        if (!parsed.success) {
            cb({ result: 'error' })
            return
        }

        const { sid, metadata, expectedVersion } = parsed.data
        const sessionAccess = resolveSessionAccess(sid)
        if (!sessionAccess.ok) {
            cb({ result: 'error', reason: sessionAccess.reason })
            return
        }

        const result = store.sessions.updateSessionMetadata(
            sid,
            metadata,
            expectedVersion,
            sessionAccess.value.namespace
        )
        if (result.result === 'success') {
            cb({ result: 'success', version: result.version, metadata: result.value })
        } else if (result.result === 'version-mismatch') {
            cb({ result: 'version-mismatch', version: result.version, metadata: result.value })
        } else {
            cb({ result: 'error' })
        }

        if (result.result === 'success') {
            const update = {
                id: randomUUID(),
                seq: Date.now(),
                createdAt: Date.now(),
                body: {
                    t: 'update-session' as const,
                    sid,
                    metadata: { version: result.version, value: metadata },
                    agentState: null
                }
            }
            socket.to(`session:${sid}`).emit('session-update', update)
            onWebappEvent?.({ type: 'session-updated', sessionId: sid, data: { sid, metadata } })
        }
    }

    socket.on('update-metadata', handleUpdateMetadata)

    const handleUpdateState: UpdateStateHandler = (data, cb) => {
        const parsed = updateStateSchema.safeParse(data)
        if (!parsed.success) {
            cb({ result: 'error' })
            return
        }

        const { sid, agentState, expectedVersion } = parsed.data
        const sessionAccess = resolveSessionAccess(sid)
        if (!sessionAccess.ok) {
            cb({ result: 'error', reason: sessionAccess.reason })
            return
        }

        const result = store.sessions.updateSessionAgentState(
            sid,
            agentState,
            expectedVersion,
            sessionAccess.value.namespace
        )
        if (result.result === 'success') {
            cb({ result: 'success', version: result.version, agentState: result.value })
        } else if (result.result === 'version-mismatch') {
            cb({ result: 'version-mismatch', version: result.version, agentState: result.value })
        } else {
            cb({ result: 'error' })
        }

        if (result.result === 'success') {
            const update = {
                id: randomUUID(),
                seq: Date.now(),
                createdAt: Date.now(),
                body: {
                    t: 'update-session' as const,
                    sid,
                    metadata: null,
                    agentState: { version: result.version, value: agentState }
                }
            }
            socket.to(`session:${sid}`).emit('session-update', update)
            onWebappEvent?.({ type: 'session-updated', sessionId: sid, data: { sid, agentState: result.value, agentStateVersion: result.version } })
        }
    }

    socket.on('update-state', handleUpdateState)

    // ===== 会话事实上报（深化候选③）：公共前置收口 =====
    // 载荷 schema 表：统一 Zod 校验（此前各 handler 手写 typeof / Zod / isFinite 三种风格并存）。
    // session-alive / session-end / run-started 只严格校验鉴权与关键标量字段（历史行为：
    // 其余字段透传，CLI 是其值权威）；context-usage / goal-status 的非空载荷必须是合法
    // schema（防 malformed 落库 + SSE 推 web 崩溃）
    const factSchemas = {
        'session-alive': z.object({ sid: z.string(), time: z.number() }).passthrough(),
        'context-usage': z.object({ sid: z.string(), contextUsage: ContextUsageSchema.nullable() }),
        'goal-status': z.object({ sid: z.string(), goalStatus: GoalStatusSchema.nullable() }),
        'run-started': z.object({ sid: z.string(), runStartedAt: z.number().finite().positive() }).passthrough(),
        'session-end': z.object({ sid: z.string(), time: z.number() }).passthrough(),
    } as const

    /** 事实上报公共前置：payload 校验 → session 鉴权 → sink 分发。
     *  新增一种事实 = schema 表加一项 + SessionFactsSink 加一个方法 + 一行转发，不再复制样板 */
    const validateAndForward = <S extends z.ZodType<{ sid: string }>>(
        schema: S,
        raw: unknown,
        deliver: (data: z.infer<S>) => void
    ): void => {
        const parsed = schema.safeParse(raw)
        if (!parsed.success) return
        const sessionAccess = resolveSessionAccess(parsed.data.sid)
        if (!sessionAccess.ok) {
            emitAccessError('session', parsed.data.sid, sessionAccess.reason)
            return
        }
        deliver(parsed.data)
    }

    // CLI 离线收尾：把仍排队的本地 user 消息全部 invoke，防悬浮条卡死（通知性副作用，
    // 不属「落库事实」，故独立于 sink——挂 session-end 转发之后）。
    // 通过同一事实 module 处理，避免保留第二份 pushed 推进规则。
    const forcePushUnsubmittedAfterEnd = (sid: string): void => {
        const unsubmitted = store.messages.getUnsubmittedLocalMessages(sid)
        if (unsubmitted.length === 0) return
        const lids = unsubmitted.map(m => m.localId).filter((l): l is string => Boolean(l))
        publishMessageFacts(messageFactsProcessor.process({
            sessionId: sid,
            facts: [{ kind: 'pushed', localIds: lids, at: Date.now() }],
        }))
    }

    socket.on('session-alive', (raw) => validateAndForward(factSchemas['session-alive'], raw, (data) => factsSink?.handleSessionAlive?.(data)))
    socket.on('context-usage', (raw) => validateAndForward(factSchemas['context-usage'], raw, (data) => factsSink?.handleContextUsage?.(data)))
    socket.on('goal-status', (raw) => validateAndForward(factSchemas['goal-status'], raw, (data) => factsSink?.handleGoalStatus?.(data)))
    socket.on('run-started', (raw) => validateAndForward(factSchemas['run-started'], raw, (data) => factsSink?.handleRunStarted?.(data)))
    socket.on('session-end', (raw) => validateAndForward(factSchemas['session-end'], raw, (data) => {
        factsSink?.handleSessionEnd?.(data)
        forcePushUnsubmittedAfterEnd(data.sid)
    }))

    socket.on('idle-timeout-warning', (data: { sid?: unknown; timeoutAt?: unknown; remainingMs?: unknown }) => {
        if (!data || typeof data.sid !== 'string' || typeof data.timeoutAt !== 'number' || typeof data.remainingMs !== 'number') {
            return
        }
        const sessionAccess = resolveSessionAccess(data.sid)
        if (!sessionAccess.ok) {
            emitAccessError('session', data.sid, sessionAccess.reason)
            return
        }
        onWebappEvent?.({
            type: 'idle-timeout-warning',
            sessionId: data.sid,
            data: {
                timeoutAt: data.timeoutAt,
                remainingMs: data.remainingMs
            }
        })
    })

    // Socket adapter 只校验批次外层和会话访问权；每种 fact 的语义由 module 内部收窄。
    socket.on('messages-facts', (data: { sid?: unknown; facts?: unknown }) => {
        if (!data || typeof data.sid !== 'string' || !Array.isArray(data.facts)) return
        const sessionAccess = resolveSessionAccess(data.sid)
        if (!sessionAccess.ok) {
            emitAccessError('session', data.sid, sessionAccess.reason)
            return
        }
        publishMessageFacts(messageFactsProcessor.process({
            sessionId: data.sid,
            facts: data.facts,
        }))
    })

    // rewind 两段回报 SSE 事件（shared SyncEventSchema 已收录 rewind-truncated / rewind-completed）
    const emitRewindEvent = (event: Extract<SyncEvent, { type: 'rewind-truncated' | 'rewind-completed' }>) => {
        onWebappEvent?.(event)
    }

    // rewind 截断成功（CLI 两段回报第一段，含 CLI 反查的锚点批首行 seq）：
    // Hub 即刻软删除（先 CLI 截断成功再 Hub 删），随即转 SSE 过渡态。
    // 软删除带上界（M3）：只删 rewind 受理时点已存在的行——回报迟到时，受理后新发的消息不被误删。
    // ack 确认制（M5）：CLI 可靠队列据此出队；去重后重放回报仅回 ack（软删除/SSE 不重复执行）
    socket.on('rewind-truncated', (data: { sid: string; nativeId: string; deleteFromSeq: number }, ack?: () => void) => {
        // deleteFromSeq 须为正整数（seq 从 1 起）：Hub 是软删除的执行端，CLI 端 reportRewindCompletion
        // 的 >0 防御不足以兜底异常载荷——0/负数会让 seq >= fromSeq 命中全部行，整会话历史被软删除
        if (!data || typeof data.sid !== 'string'
            || typeof data.nativeId !== 'string' || data.nativeId.length === 0
            || !Number.isInteger(data.deleteFromSeq) || data.deleteFromSeq <= 0) {
            ack?.()
            return
        }
        const sessionAccess = resolveSessionAccess(data.sid)
        if (!sessionAccess.ok) {
            emitAccessError('session', data.sid, sessionAccess.reason)
            ack?.()
            return
        }
        // CLI 可靠队列的重放（ack 丢失后原样重发）→ 幂等跳过：软删除/SSE 均已执行过
        if (rewindDeleteBoundTracker?.isDuplicateTruncated(data.sid, data.nativeId, data.deleteFromSeq)) {
            ack?.()
            return
        }
        // 受理时记录的上界（一次性消费；无记录 = hub 重启丢内存 → 回退无上界删除，旧行为）
        const bound = rewindDeleteBoundTracker?.consume(data.sid) ?? undefined
        store.messages.softDeleteMessagesFrom(data.sid, data.deleteFromSeq, bound)
        emitRewindEvent({ type: 'rewind-truncated', sessionId: data.sid, deleteFromSeq: data.deleteFromSeq })
        ack?.()
    })

    // rewind 终态（CLI 两段回报第二段）：filesRestored false 时 error 携带原因，转 SSE。
    // 重放安全（web 无进行中态即忽略），ack 确认制同上
    socket.on('rewind-completed', (data: { sid: string; filesRestored: boolean; error?: string; skippedLinks?: number }, ack?: () => void) => {
        if (!data || typeof data.sid !== 'string' || typeof data.filesRestored !== 'boolean'
            || (data.error !== undefined && typeof data.error !== 'string')
            || (data.skippedLinks !== undefined && typeof data.skippedLinks !== 'number')) {
            ack?.()
            return
        }
        const sessionAccess = resolveSessionAccess(data.sid)
        if (!sessionAccess.ok) {
            emitAccessError('session', data.sid, sessionAccess.reason)
            ack?.()
            return
        }
        emitRewindEvent({ type: 'rewind-completed', sessionId: data.sid, filesRestored: data.filesRestored, error: data.error, skippedLinks: data.skippedLinks })
        ack?.()
    })
}
