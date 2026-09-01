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

import { EventEmitter } from 'node:events'
import { randomUUID } from 'node:crypto'
import { io, type Socket } from 'socket.io-client'
import axios from 'axios'
import type { ZodType } from 'zod'
import { logger } from '@/ui/logger'
import { backoff } from '@/utils/time'
import { apiValidationError } from '@/utils/errorUtils'
import { AsyncLock } from '@/utils/lock'
import type { RawJSONLines } from '@/claude/types'
import { configuration } from '@/configuration'
import type { ClientToServerEvents, CommandLifecycleState, ContextUsage, DecryptedMessage, EffortLevel, GoalStatus, MessageFact, ServerToClientEvents, TerminalErrorPayload, TerminalExitPayload, TerminalOutputPayload, TerminalReadyPayload, Update } from '@mobi/shared'
import {
    TerminalClosePayloadSchema,
    TerminalOpenPayloadSchema,
    TerminalResizePayloadSchema,
    TerminalWritePayloadSchema,
    classifyMessage
} from '@mobi/shared'
import type {
    AgentState,
    MessageContent,
    MessageMeta,
    Metadata,
    Session,
    SessionModel,
    SessionPermissionMode,
    UserMessage
} from './types'
import { AgentStateSchema, CliMessagesResponseSchema, MetadataSchema, UserMessageSchema } from './types'
import { RpcHandlerManager } from './rpc/RpcHandlerManager'
import { registerCommonHandlers } from '../modules/common/registerCommonHandlers'
import { cleanupUploadDir } from '../modules/common/handlers/uploads'
import { TerminalManager } from '@/terminal/TerminalManager'
import { applyVersionedAck } from './versionedUpdate'
import { IdleTimer } from '@/modules/common/idleTimer'
import { ReliableRewindReportQueue } from '../claude/utils/reliableReport'
import type { InboundTurnKind } from '../claude/utils/inboundCrossSession'

/** 兜底重连初始退避（ms），上限 30s */
const MANUAL_RECONNECT_BASE_DELAY_MS = 1_000
const MANUAL_RECONNECT_MAX_DELAY_MS = 30_000
/** connect_error 落盘节流窗口（ms） */
const CONNECT_ERROR_LOG_WINDOW_MS = 60_000
/** rewind 回报 ack 等待上限（ms）：超时视为失败进可靠队列重试 */
const REWIND_REPORT_ACK_TIMEOUT_MS = 5_000

export class ApiSessionClient extends EventEmitter {
    private readonly token: string
    readonly sessionId: string
    private metadata: Metadata | null
    private metadataVersion: number
    private agentState: AgentState | null
    private agentStateVersion: number
    private readonly socket: Socket<ServerToClientEvents, ClientToServerEvents>
    private pendingMessages: UserMessage[] = []
    private pendingMessageCallback: ((message: UserMessage) => void) | null = null
    private lastSeenMessageSeq: number | null = null
    private backfillInFlight: Promise<void> | null = null
    private needsBackfill = false
    private hasConnectedOnce = false
    readonly rpcHandlerManager: RpcHandlerManager
    private readonly terminalManager: TerminalManager
    private idleTimer: IdleTimer | null = null
    private agentStateLock = new AsyncLock()
    private metadataLock = new AsyncLock()
    /** 服务端主动断开的兜底重连定时器（socket.io v4 对 'io server disconnect' 不自动重连） */
    private manualReconnectTimer: ReturnType<typeof setTimeout> | null = null
    /** 兜底重连退避（连续被服务端断开时指数增长，connect 成功复位） */
    private manualReconnectDelayMs = MANUAL_RECONNECT_BASE_DELAY_MS
    /** connect_error 落盘节流：重连循环每 1-5s 触发一次，窗口内只记首条防刷屏 */
    private lastConnectErrorLogAt = 0
    /** rewind 两段回报的可靠上报队列（ack 确认制，M5） */
    private readonly rewindReportQueue: ReliableRewindReportQueue

    constructor(token: string, session: Session) {
        super()
        this.token = token
        this.sessionId = session.id
        this.metadata = session.metadata
        this.metadataVersion = session.metadataVersion
        this.agentState = session.agentState
        this.agentStateVersion = session.agentStateVersion

        this.rpcHandlerManager = new RpcHandlerManager({
            scopePrefix: this.sessionId,
            logger: (msg, data) => logger.debug(msg, data)
        })

        if (this.metadata?.path) {
            registerCommonHandlers(this.rpcHandlerManager, this.metadata.path)
        }

        this.socket = io(`${configuration.apiUrl}/cli`, {
            auth: {
                token: this.token,
                clientType: 'session-scoped' as const,
                sessionId: this.sessionId
            },
            path: '/socket.io/',
            reconnection: true,
            reconnectionAttempts: Infinity,
            reconnectionDelay: 1000,
            reconnectionDelayMax: 5000,
            transports: ['websocket'],
            autoConnect: false
        })

        this.terminalManager = new TerminalManager({
            sessionId: this.sessionId,
            getSessionPath: () => this.metadata?.path ?? null,
            onReady: (payload: TerminalReadyPayload) => this.socket.emit('terminal:ready', payload),
            onOutput: (payload: TerminalOutputPayload) => this.socket.emit('terminal:output', payload),
            onExit: (payload: TerminalExitPayload) => this.socket.emit('terminal:exit', payload),
            onError: (payload: TerminalErrorPayload) => this.socket.emit('terminal:error', payload),
            onTerminalInput: () => this.idleTimer?.reset()
        })

        // 初始化 IdleTimer
        this.idleTimer = new IdleTimer({
            disconnectTimeoutMs: configuration.disconnectTimeoutMs,
            idleTimeoutMs: configuration.idleTimeoutMs,
            warningMs: configuration.timeoutWarningMs,
            onWarning: () => this.handleIdleWarning(),
            onDisconnectTimeout: () => this.handleDisconnectTimeout(),
            onIdleTimeout: () => this.handleIdleTimeout()
        })

        // 设置 RPC 调用回调
        this.rpcHandlerManager.setOnRpcCalled(() => {
            this.idleTimer?.reset()
        })

        // rewind 两段回报改走可靠队列（M5）：ack 确认 + 失败重试 + 重连补发，
        // 断线窗口内 fire-and-forget 丢事件会造成 CLI transcript / Hub DB 永久分叉
        const sock = this.socket
        this.rewindReportQueue = new ReliableRewindReportQueue({
            get connected() { return sock.connected },
            emitAck: (event, body, callback) => {
                (sock.timeout(REWIND_REPORT_ACK_TIMEOUT_MS) as unknown as {
                    emit: (e: string, b: unknown, cb: (err: unknown, res?: unknown) => void) => void
                }).emit(event, body, callback)
            },
        })

        this.socket.on('connect', () => {
            logger.debug('Socket connected successfully')
            this.rpcHandlerManager.onSocketConnect(this.socket)
            this.idleTimer?.onReconnect()
            this.clearManualReconnect()
            // 补发未确认的 rewind 回报（ack 制：断线期间的回报在此重放，hub 幂等消化）
            this.rewindReportQueue.onConnected()
            if (this.hasConnectedOnce) {
                this.needsBackfill = true
            }
            void this.backfillIfNeeded()
            this.hasConnectedOnce = true
            this.socket.emit('session-alive', {
                sid: this.sessionId,
                time: Date.now(),
                running: false
            })
        })

        this.socket.on('rpc-request', async (data: { method: string; params: unknown }, callback: (response: unknown) => void) => {
            callback(await this.rpcHandlerManager.handleRequest(data))
        })

        this.socket.on('disconnect', (reason) => {
            // 断开原因落盘（WARN）：hub 重启/换血后会话退出的定位证据——曾因 debug 不落盘而无从排查
            logger.warn('[API] Socket disconnected:', reason)
            this.scheduleManualReconnect(reason)
            this.rpcHandlerManager.onSocketDisconnect()
            this.terminalManager.closeAll()
            this.idleTimer?.onDisconnect()
            if (this.hasConnectedOnce) {
                this.needsBackfill = true
            }
        })

        this.socket.on('connect_error', (error) => {
            // 节流落盘：错误文案是「重连为何失败」的直接证据（鉴权拒绝 / 网络不可达 / 握手失败）
            const now = Date.now()
            if (now - this.lastConnectErrorLogAt > CONNECT_ERROR_LOG_WINDOW_MS) {
                this.lastConnectErrorLogAt = now
                logger.warn('[API] Socket connection error:', error instanceof Error ? error.message : String(error))
            }
            this.rpcHandlerManager.onSocketDisconnect()
            this.idleTimer?.onDisconnect()
        })

        this.socket.on('error', (payload) => {
            logger.debug('[API] Socket error:', payload)
        })

        const handleTerminalEvent = <T extends { sessionId: string }>(
            schema: ZodType<T>,
            handler: (payload: T) => void
        ) => (data: unknown) => {
            const parsed = schema.safeParse(data)
            if (!parsed.success) {
                return
            }
            if (parsed.data.sessionId !== this.sessionId) {
                return
            }
            handler(parsed.data)
        }

        this.socket.on('terminal:open', handleTerminalEvent(TerminalOpenPayloadSchema, (payload) => {
            this.terminalManager.create(payload.terminalId, payload.cols, payload.rows)
        }))

        this.socket.on('terminal:write', handleTerminalEvent(TerminalWritePayloadSchema, (payload) => {
            this.terminalManager.write(payload.terminalId, payload.data)
        }))

        this.socket.on('terminal:resize', handleTerminalEvent(TerminalResizePayloadSchema, (payload) => {
            this.terminalManager.resize(payload.terminalId, payload.cols, payload.rows)
        }))

        this.socket.on('terminal:close', handleTerminalEvent(TerminalClosePayloadSchema, (payload) => {
            this.terminalManager.close(payload.terminalId)
        }))

        this.socket.on('update', (data: Update) => {
            try {
                if (!data.body) return

                if (data.body.t === 'new-message') {
                    this.handleIncomingMessage(data.body.message)
                    return
                }

                if (data.body.t === 'update-session') {
                    if (data.body.metadata && data.body.metadata.version > this.metadataVersion) {
                        const parsed = MetadataSchema.safeParse(data.body.metadata.value)
                        if (parsed.success) {
                            this.metadata = parsed.data
                        } else {
                            logger.debug('[API] Ignoring invalid metadata update', { version: data.body.metadata.version })
                        }
                        this.metadataVersion = data.body.metadata.version
                    }
                    if (data.body.agentState && data.body.agentState.version > this.agentStateVersion) {
                        const next = data.body.agentState.value
                        if (next == null) {
                            this.agentState = null
                        } else {
                            const parsed = AgentStateSchema.safeParse(next)
                            if (parsed.success) {
                                this.agentState = parsed.data
                            } else {
                                logger.debug('[API] Ignoring invalid agentState update', { version: data.body.agentState.version })
                            }
                        }
                        this.agentStateVersion = data.body.agentState.version
                    }
                    return
                }

                this.emit('message', data.body)
            } catch (error) {
                logger.debug('[SOCKET] [UPDATE] [ERROR] Error handling update', { error })
            }
        })

        this.socket.connect()
    }

    onUserMessage(callback: (data: UserMessage) => void): void {
        this.pendingMessageCallback = callback
        while (this.pendingMessages.length > 0) {
            callback(this.pendingMessages.shift()!)
        }
    }

    private enqueueUserMessage(message: UserMessage): void {
        if (this.pendingMessageCallback) {
            this.pendingMessageCallback(message)
        } else {
            this.pendingMessages.push(message)
        }
    }

    private handleIncomingMessage(message: { seq?: number; localId?: string | null; content: unknown }): void {
        const seq = typeof message.seq === 'number' ? message.seq : null
        if (seq !== null) {
            if (this.lastSeenMessageSeq !== null && seq <= this.lastSeenMessageSeq) {
                return
            }
            this.lastSeenMessageSeq = seq
        }

        const userResult = UserMessageSchema.safeParse(message.content)
        if (userResult.success) {
            // localId 由 Hub 放在 message 外层（与 content 信封同级），合并进 UserMessage
            // 供 runClaude 入队 → collectBatch → emitMessagesSubmitted 追踪 consume
            this.enqueueUserMessage({ ...userResult.data, localId: message.localId ?? userResult.data.localId ?? undefined })
            return
        }

        this.emit('message', message.content)
    }

    private async backfillIfNeeded(): Promise<void> {
        if (!this.needsBackfill) {
            return
        }
        try {
            await this.backfillMessages()
            this.needsBackfill = false
        } catch (error) {
            logger.debug('[API] Backfill failed', error)
            this.needsBackfill = true
        }
    }

    private async backfillMessages(): Promise<void> {
        if (this.backfillInFlight) {
            await this.backfillInFlight
            return
        }

        const startSeq = this.lastSeenMessageSeq
        if (startSeq === null) {
            logger.debug('[API] Skipping backfill because no last-seen message sequence is available')
            return
        }

        const limit = 200
        const run = async () => {
            let cursor = startSeq
            while (true) {
                const response = await axios.get(
                    `${configuration.apiUrl}/cli/sessions/${encodeURIComponent(this.sessionId)}/messages`,
                    {
                        params: { afterSeq: cursor, limit },
                        headers: {
                            Authorization: `Bearer ${this.token}`,
                            'Content-Type': 'application/json'
                        },
                        timeout: 15_000
                    }
                )

                const parsed = CliMessagesResponseSchema.safeParse(response.data)
                if (!parsed.success) {
                    throw apiValidationError('Invalid /cli/sessions/:id/messages response', response)
                }

                const messages = parsed.data.messages
                if (messages.length === 0) {
                    break
                }

                let maxSeq = cursor
                for (const message of messages) {
                    if (typeof message.seq === 'number') {
                        if (message.seq > maxSeq) {
                            maxSeq = message.seq
                        }
                    }
                    this.handleIncomingMessage(message)
                }

                const observedSeq = this.lastSeenMessageSeq ?? maxSeq
                const nextCursor = Math.max(maxSeq, observedSeq)
                if (nextCursor <= cursor) {
                    logger.debug('[API] Backfill stopped due to non-advancing cursor', {
                        cursor,
                        maxSeq,
                        observedSeq
                    })
                    break
                }

                cursor = nextCursor
                if (messages.length < limit) {
                    break
                }
            }
        }

        this.backfillInFlight = run().finally(() => {
            this.backfillInFlight = null
        })

        await this.backfillInFlight
    }

    sendClaudeSessionMessage(body: RawJSONLines): void {
        // 在发送端分类，避免 Hub 重复分类
        const subtype = body.type === 'system' ? body.subtype : undefined
        const category = classifyMessage(body.type, subtype)

        // discard 统一在此拦截：remote 循环入口（claudeRemoteLauncher）虽已过滤，
        // 但 local 模式 scanner（转录 JSONL 含 command_lifecycle 等控制帧）等旁路
        // 直接调用本方法——发送端唯一咽喉点，保证 discard 消息不进 Hub 不落库
        if (category === 'discard') return

        let content: MessageContent

        if (body.type === 'user' && typeof body.message.content === 'string' && body.isSidechain !== true && body.isMeta !== true) {
            content = {
                role: 'user',
                content: {
                    type: 'text',
                    text: body.message.content
                },
                meta: {
                    sentFrom: 'cli'
                }
            }
        } else {
            content = {
                role: 'agent',
                content: {
                    type: 'output',
                    data: body
                },
                meta: {
                    sentFrom: 'cli'
                }
            }
        }

        this.socket.emit('message', {
            sid: this.sessionId,
            message: content,
            // 使用 Claude Code 的 uuid 作为 localId，供 Hub DB 去重
            // resume 场景下同一消息的 uuid 保持不变，Hub 可通过 localId 避免重复存储
            localId: body.uuid,
            // SDK 消息自带 uuid 与 session id，一并写入 metadata（rewind 锚点）
            metadata: { nativeId: body.uuid, nativeSessionId: body.session_id || undefined },
            category
        })

        if (body.type === 'summary' && 'summary' in body && 'leafUuid' in body) {
            this.updateMetadata((metadata) => ({
                ...metadata,
                name: body.summary,
                summary: {
                    text: body.summary,
                    updatedAt: Date.now()
                }
            }))
        }
    }

    /** 发送流式内容快照（不落库，Hub 直接透传给 Web） */
    sendContentSnapshot(message: DecryptedMessage): void {
        this.socket.emit('message', {
            sid: this.sessionId,
            message: message.content,
            localId: message.localId ?? undefined,
            snapshot: true,
        })
    }

    sendUserMessage(text: string, meta?: MessageMeta): void {
        if (!text) {
            return
        }

        const content: MessageContent = {
            role: 'user',
            content: {
                type: 'text',
                text
            },
            meta: {
                sentFrom: 'cli',
                ...(meta ?? {})
            }
        }

        this.socket.emit('message', {
            sid: this.sessionId,
            message: content
        })
    }

    /**
     * 落库入站跨会话消息（UserPromptSubmit hook 观测的 peer 消息）。
     * 该消息未经 hub 发送通道，此处是它唯一的持久化入口；
     * sentFrom 保留 'cli'（永不排队），来源标注放 meta.crossSession。
     */
    sendInboundCrossSessionMessage(text: string, kind: InboundTurnKind, fromName: string | null, nativeId: string): void {
        const content: MessageContent = {
            role: 'user',
            content: {
                type: 'text',
                text
            },
            meta: {
                sentFrom: 'cli',
                // crossSession 恒写入：fromName 降级（信封缺 from-name）时为空串，
                // web 端判空后显示「来自 其他会话」。键缺失会让 web 的 compact 误判守卫
                // （排除 crossSession 消息）失效，降级消息会被误渲染成 compact-summary
                crossSession: { from: fromName ?? '' },
                // turnOrigin 区分入站来源（spec 批次 D）：peer/scheduled/loop
                turnOrigin: kind
            }
        }
        this.socket.emit('message', {
            sid: this.sessionId,
            message: content,
            // hook 输入无稳定 native 锚，localId 仅作唯一标识（随机 uuid）；
            // SDK 重试重放的理论重复观测无去重，概率低可接受
            localId: nativeId,
            metadata: { nativeId },
            category: classifyMessage('user')
        })
    }

    sendAgentMessage(body: unknown): void {
        const content = {
            role: 'agent',
            content: {
                type: 'agent',
                data: body
            },
            meta: {
                sentFrom: 'cli'
            }
        }
        this.socket.emit('message', {
            sid: this.sessionId,
            message: content
        })
    }

    sendSessionEvent(event: {
        type: 'switch'
        mode: 'local' | 'remote'
    } | {
        type: 'message'
        message: string
    } | {
        type: 'context-cleared'
    } | {
        type: 'compact-completed'
    } | {
        type: 'permission-mode-changed'
        mode: SessionPermissionMode
    } | {
        type: 'ready'
    }, id?: string): void {
        const content = {
            role: 'agent',
            content: {
                id: id ?? randomUUID(),
                type: 'event',
                data: event
            }
        }

        this.socket.emit('message', {
            sid: this.sessionId,
            message: content
        })
    }

    /** 通知 Hub：这批 localId 的消息已推给 Claude Code（pushed 转换，写入 lifecycle/lifecycle_at） */
    emitMessagesSubmitted(localIds: string[]): void {
        if (localIds.length === 0) return
        this.emitFacts([{ kind: 'pushed', localIds, at: Date.now() }])
    }

    /** 通知 Hub：这批 localId 的用户消息已绑定 native 锚点（push 给 SDK 时生成，批内同值）。
     * nativeSessionId 在 push 时已知（非首条消息）则直接带上，省去 attach 补写往返；
     * 首条消息 push 时 session id 未知，留空由 attach 补写 */
    emitMessagesBound(bindings: { localId: string; nativeId: string }[], nativeSessionId?: string): void {
        if (bindings.length === 0) return
        this.emitFacts(bindings.map((b): MessageFact => ({
            kind: 'bound',
            localId: b.localId,
            nativeId: b.nativeId,
            ...(nativeSessionId ? { nativeSessionId } : {})
        })))
    }

    /** 通知 Hub：native session 已切换（onSessionFound 变化），补写该会话缺 nativeSessionId 的消息行 */
    emitNativeAttached(nativeSessionId: string): void {
        this.emitFacts([{ kind: 'attached', nativeSessionId }])
    }

    /** 通知 Hub：CC 已回显接收该 nativeId 的用户消息（acked 转换，rewind 判据） */
    emitMessagesAcked(nativeId: string): void {
        this.emitFacts([{ kind: 'acked', nativeId, at: Date.now() }])
    }

    /** 上报 command_lifecycle 终态信号（CC 排队消息生命周期回执转译，见 commandLifecycleToFact）。
     *  state 含 refused（跨会话 peer 消息被拒收）；terminalReason 开放透传（上游 Open set，U-13） */
    emitLifecycleFact(
        nativeId: string,
        state: CommandLifecycleState,
        at?: number,
        terminalReason?: string,
    ): void {
        this.emitFacts([{ kind: 'lifecycle', nativeId, state, at: at ?? Date.now(), ...(terminalReason ? { terminalReason } : {}) }])
    }

    /** 上报撤回（#53：最后一条 user 无输出即停）——hub 据此软删除并广播 message-withdrawn 回填 */
    emitWithdrawnFact(nativeId: string): void {
        this.emitFacts([{ kind: 'withdrawn', nativeId, at: Date.now() }])
    }

    /** 消息事实上报统一出口：一批 fact 一次往返（messages-facts 事件） */
    private emitFacts(facts: MessageFact[]): void {
        this.socket.emit('messages-facts', {
            sid: this.sessionId,
            facts
        })
    }

    /**
     * 反查 rewind 截断边界：同 metadata.nativeId 的最小 seq 行（锚点批首行，1:N 批整批同删的定界）。
     * 走既有 GET /cli/sessions/:id/messages 接口正向分页（afterSeq 游标递进，对齐 backfillMessages）；
     * 消息按 seq 升序返回，首个命中即最小 seq。未找到（行已删 / Hub DTO 未含 metadata）返回 0，
     * 调用方按边界反查失败处理（跳过 truncated 上报，completed 带 error 收尾）。
     */
    async fetchRewindBoundary(nativeId: string): Promise<number> {
        let cursor = 0
        const limit = 200
        while (true) {
            const response = await axios.get(
                `${configuration.apiUrl}/cli/sessions/${encodeURIComponent(this.sessionId)}/messages`,
                {
                    params: { afterSeq: cursor, limit },
                    headers: {
                        Authorization: `Bearer ${this.token}`,
                        'Content-Type': 'application/json'
                    },
                    timeout: 15_000
                }
            )

            const parsed = CliMessagesResponseSchema.safeParse(response.data)
            if (!parsed.success) {
                throw apiValidationError('Invalid /cli/sessions/:id/messages response', response)
            }

            const messages = parsed.data.messages
            if (messages.length === 0) break

            let maxSeq = cursor
            for (const message of messages) {
                if (typeof message.seq === 'number' && message.seq > maxSeq) {
                    maxSeq = message.seq
                }
                if (message.metadata?.nativeId === nativeId && typeof message.seq === 'number') {
                    // 升序遍历，首个命中即批首行
                    return message.seq
                }
            }

            if (maxSeq <= cursor || messages.length < limit) break
            cursor = maxSeq
        }
        return 0
    }

    /** rewind 截断成功上报（CLI → Hub，ack 确认制）：Hub 即刻软删除 seq ∈ [deleteFromSeq, 受理上界] 的行并转 SSE */
    emitRewoundTruncated(nativeId: string, deleteFromSeq: number): void {
        this.rewindReportQueue.enqueue({ event: 'rewound-truncated', body: { sid: this.sessionId, nativeId, deleteFromSeq } })
    }

    /** rewind 终态上报（CLI → Hub，ack 确认制）：转 SSE；filesRestored=false 时 error 携带原因（部分失败如实报错） */
    emitRewindCompleted(filesRestored: boolean, error?: string): void {
        this.rewindReportQueue.enqueue({ event: 'rewind-completed', body: { sid: this.sessionId, filesRestored, error } })
    }

    /**
     * 上报上下文用量（事件驱动采集）。
     * Hub 落库到 runtimeState.contextUsage + SSE 推 web。
     */
    reportContextUsage(usage: ContextUsage): void {
        this.socket.emit('context-usage', {
            sid: this.sessionId,
            contextUsage: usage,
        })
    }

    /**
     * 清空上下文用量（/clear 后新会话从 0 开始）。
     * 复用 context-usage 通道，contextUsage 传 null：hub 据此清 runtimeState.contextUsage + SSE 推，
     * web 端用量线隐藏，直到下次真实 turn 的 result 到达。
     */
    clearContextUsage(): void {
        this.socket.emit('context-usage', {
            sid: this.sessionId,
            contextUsage: null,
        })
    }

    /**
     * 上报当前轮次起点（running 翻转 false→true 时，SessionBase.onRunningChange 触发）。
     * Hub 落库到 runtimeState.runStartedAt + SSE 推 web——StatusBar 计时的权威来源，
     * 不随 web 消息窗口化丢失（docs/pending.md #55）。
     */
    reportRunStarted(at: number): void {
        this.socket.emit('run-started', {
            sid: this.sessionId,
            runStartedAt: at,
        })
    }

    /**
     * 上报 goal 状态（hub 落库到 runtimeState.goalStatus + SSE 推 web）。
     * goalStatus 为 null 表示清空（达成 10s 后自动清空 / 手动清理）。
     */
    reportGoalStatus(goalStatus: GoalStatus | null): void {
        this.socket.emit('goal-status', {
            sid: this.sessionId,
            goalStatus,
        })
    }

    keepAlive(
        running: boolean,
        mode: 'local' | 'remote',
        runtime?: { permissionMode?: SessionPermissionMode; model?: SessionModel; effort?: EffortLevel }
    ): void {
        this.socket.volatile.emit('session-alive', {
            sid: this.sessionId,
            time: Date.now(),
            running,
            mode,
            ...(runtime ?? {})
        })
    }

    sendSessionDeath(): void {
        void cleanupUploadDir(this.sessionId)
        this.socket.emit('session-end', { sid: this.sessionId, time: Date.now() })
    }

    updateMetadata(handler: (metadata: Metadata) => Metadata): void {
        this.metadataLock.inLock(async () => {
            // 重置空闲计时器（状态更新）
            this.idleTimer?.reset()

            await backoff(async () => {
                const current = this.metadata ?? ({} as Metadata)
                const updated = handler(current)

                const answer = await this.socket.emitWithAck('update-metadata', {
                    sid: this.sessionId,
                    expectedVersion: this.metadataVersion,
                    metadata: updated
                }) as unknown

                applyVersionedAck(answer, {
                    valueKey: 'metadata',
                    parseValue: (value) => {
                        const parsed = MetadataSchema.safeParse(value)
                        return parsed.success ? parsed.data : null
                    },
                    applyValue: (value) => {
                        this.metadata = value
                    },
                    applyVersion: (version) => {
                        this.metadataVersion = version
                    },
                    logInvalidValue: (context, version) => {
                        const suffix = context === 'success' ? 'ack' : 'version-mismatch ack'
                        logger.debug(`[API] Ignoring invalid metadata value from ${suffix}`, { version })
                    },
                    invalidResponseMessage: 'Invalid update-metadata response',
                    errorMessage: 'Metadata update failed',
                    versionMismatchMessage: 'Metadata version mismatch'
                })
            })
        })
    }

    updateAgentState(handler: (state: AgentState) => AgentState): void {
        this.agentStateLock.inLock(async () => {
            // 重置空闲计时器（状态更新）
            this.idleTimer?.reset()

            await backoff(async () => {
                const current = this.agentState ?? ({} as AgentState)
                const updated = handler(current)

                const answer = await this.socket.emitWithAck('update-state', {
                    sid: this.sessionId,
                    expectedVersion: this.agentStateVersion,
                    agentState: updated
                }) as unknown

                applyVersionedAck(answer, {
                    valueKey: 'agentState',
                    parseValue: (value) => {
                        const parsed = AgentStateSchema.safeParse(value)
                        return parsed.success ? parsed.data : null
                    },
                    applyValue: (value) => {
                        this.agentState = value
                    },
                    applyVersion: (version) => {
                        this.agentStateVersion = version
                    },
                    logInvalidValue: (context, version) => {
                        const suffix = context === 'success' ? 'ack' : 'version-mismatch ack'
                        logger.debug(`[API] Ignoring invalid agentState value from ${suffix}`, { version })
                    },
                    invalidResponseMessage: 'Invalid update-state response',
                    errorMessage: 'Agent state update failed',
                    versionMismatchMessage: 'Agent state version mismatch'
                })
            })
        })
    }

    private async waitForConnected(timeoutMs: number): Promise<boolean> {
        if (this.socket.connected) {
            return true
        }

        this.socket.connect()

        return await new Promise<boolean>((resolve) => {
            let settled = false

            const cleanup = () => {
                this.socket.off('connect', onConnect)
                clearTimeout(timeout)
            }

            const onConnect = () => {
                if (settled) return
                settled = true
                cleanup()
                resolve(true)
            }

            const timeout = setTimeout(() => {
                if (settled) return
                settled = true
                cleanup()
                resolve(false)
            }, Math.max(0, timeoutMs))

            this.socket.on('connect', onConnect)
        })
    }

    private async drainLock(lock: AsyncLock, timeoutMs: number): Promise<boolean> {
        if (timeoutMs <= 0) {
            return false
        }

        return await new Promise<boolean>((resolve) => {
            let settled = false
            let timeout: ReturnType<typeof setTimeout> | null = null

            const finish = (value: boolean) => {
                if (settled) return
                settled = true
                if (timeout) {
                    clearTimeout(timeout)
                }
                resolve(value)
            }

            timeout = setTimeout(() => finish(false), timeoutMs)

            lock.inLock(async () => { })
                .then(() => finish(true))
                .catch(() => finish(false))
        })
    }

    async flush(options?: { timeoutMs?: number }): Promise<void> {
        const deadlineMs = Date.now() + (options?.timeoutMs ?? 5_000)

        const remainingMs = () => Math.max(0, deadlineMs - Date.now())

        await this.drainLock(this.metadataLock, remainingMs())
        await this.drainLock(this.agentStateLock, remainingMs())

        if (remainingMs() === 0) {
            return
        }

        const connected = await this.waitForConnected(remainingMs())
        if (!connected) {
            return
        }

        const pingTimeoutMs = remainingMs()
        if (pingTimeoutMs === 0) {
            return
        }

        try {
            await this.socket.timeout(pingTimeoutMs).emitWithAck('ping')
        } catch {
            // best effort
        }
    }

    close(): void {
        this.rpcHandlerManager.setOnRpcCalled(undefined)
        this.rpcHandlerManager.onSocketDisconnect()
        this.terminalManager.closeAll()
        this.idleTimer?.destroy()
        this.clearManualReconnect()
        this.socket.disconnect()
    }

    /**
     * 启动空闲计时器（Remote 模式）
     */
    startIdleTimer(): void {
        this.idleTimer?.start()
    }

    /**
     * 停止空闲计时器（切换到 Local 模式）
     */
    stopIdleTimer(): void {
        this.idleTimer?.stop()
    }

    /**
     * 重置空闲计时器（有活动时）
     */
    resetIdleTimer(): void {
        this.idleTimer?.reset()
    }

    private handleIdleWarning(): void {
        if (!this.socket.connected) {
            logger.debug('[API] Socket not connected, skipping idle warning')
            return
        }
        this.socket.emit('idle-timeout-warning', {
            sid: this.sessionId,
            timeoutAt: Date.now() + configuration.timeoutWarningMs,
            remainingMs: configuration.timeoutWarningMs
        })
        logger.debug('[API] Idle timeout warning sent')
    }

    private handleDisconnectTimeout(): void {
        logger.debug('[API] Disconnect timeout, exiting')
        this.emit('disconnect-timeout')
    }

    /**
     * 服务端主动断开（'io server disconnect'）的兜底重连：socket.io v4 对该 reason
     * 不自动重连（hub 优雅关闭/单连接被踢都会走到），必须手动 connect() 恢复重连循环，
     * 否则 10 分钟 disconnect timeout 到期会话进程直接退出（2026-08-17 排查的根因链）。
     * transport 层断开（transport close/error/ping timeout）走 socket.io 内置自动重连，不干预；
     * 'io client disconnect' 是本进程主动断开（退出路径），禁止兜底——否则进程退不出去。
     */
    private scheduleManualReconnect(reason: string): void {
        if (reason !== 'io server disconnect' || this.manualReconnectTimer) return
        const delay = this.manualReconnectDelayMs
        this.manualReconnectDelayMs = Math.min(this.manualReconnectDelayMs * 2, MANUAL_RECONNECT_MAX_DELAY_MS)
        logger.warn(`[API] Server-initiated disconnect, manual reconnect in ${delay}ms`)
        this.manualReconnectTimer = setTimeout(() => {
            this.manualReconnectTimer = null
            if (!this.socket.connected) this.socket.connect()
        }, delay)
        this.manualReconnectTimer.unref?.()
    }

    /** connect 成功后清兜底定时器并复位退避 */
    private clearManualReconnect(): void {
        if (this.manualReconnectTimer) {
            clearTimeout(this.manualReconnectTimer)
            this.manualReconnectTimer = null
        }
        this.manualReconnectDelayMs = MANUAL_RECONNECT_BASE_DELAY_MS
    }

    private handleIdleTimeout(): void {
        logger.debug('[API] Idle timeout, exiting')
        this.emit('idle-timeout')
    }
}
