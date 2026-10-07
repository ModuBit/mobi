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

import axios from 'axios'
import { randomUUID } from 'node:crypto'
import { logger } from '@mobi/node-core/logger'
import { backoff } from '@mobi/node-core/utils/time'
import { apiValidationError } from '@mobi/node-core/utils/errorUtils'
import { AsyncLock } from '@mobi/node-core/utils/lock'
import { configuration } from '@mobi/node-core/configuration'
import { applyVersionedAck } from '@mobi/node-core/api/versionedUpdate'
import { cleanupUploadDir } from '@mobi/node-core/handlers/uploads'
import type { RawJSONLines } from '../claude/types'
import { ReliableRewindReportQueue } from '../claude/utils/reliableReport'
import type {
    AgentCreateSessionAck,
    AgentCreateSessionRequest,
    AgentSendMessageAck,
    AgentSendMessageRequest,
    AgentSessionsAck,
    AgentSessionsRequest,
    CacheStatus,
    ContextUsage,
    CrossSessionOrigin,
    DecryptedMessage,
    GoalStatus,
    MessageFact,
    SnapshotDeltaFrame,
    TurnOrigin,
    UiCommandAction,
    UiCommandAck,
    Update,
} from '@mobi/shared'
import { classifyMessage, isMobiSentCrossSession, toCrossSessionMeta } from '@mobi/shared'
import { AgentStateSchema, CliMessagesResponseSchema, MetadataSchema, UserMessageSchema } from '@mobi/node-core/api/types'
import type {
    AgentState,
    MessageContent,
    MessageMeta,
    Metadata,
    Session,
    SessionPermissionMode,
    UserMessage,
} from '@mobi/node-core/api/types'
import type { SessionTransport } from './sessionTransport'

/** rewind 回报 ack 等待上限（ms）：超时视为失败进可靠队列重试 */
const REWIND_REPORT_ACK_TIMEOUT_MS = 5_000
/** UI 命令 ack 等待上限（ms）：超时按连接故障处理（与离线 delivered:false 语义区分） */
const UI_COMMAND_ACK_TIMEOUT_MS = 5_000
/** Agent 会话操作 ack 等待上限（ms）：同 UI 命令口径，超时按连接故障处理 */
const AGENT_OP_ACK_TIMEOUT_MS = 5_000
/** 建会话的 ack 等待上限（ms）：这一步在起真进程（见 createSessionForAgent 注释），
 *  5s 必然不够。取 45s = daemon 侧 RPC 30s 上限 + 余量 */
const AGENT_CREATE_SESSION_ACK_TIMEOUT_MS = 45_000
/** 投递消息的 ack 等待上限（ms）：daemon 侧并发扇出，卡住的目标最多吃掉一次 30s RPC 上限
 *  （见 sendMessageToSessionsForAgent 注释），60s 留一倍余量 */
const AGENT_SEND_MESSAGE_ACK_TIMEOUT_MS = 60_000
/** session-end ack 等待上限（ms） */
const SESSION_END_ACK_TIMEOUT_MS = 5_000

/**
 * 会话协议事件（深化候选③票①）：消息事实与运行状态上报收敛为单一 report 出口。
 * 传输层按 kind 映射回各 socket 事件名（messages-facts / context-usage / …），wire 协议不变。
 */
export type SessionChannelReport =
    /** 消息事实批次（pushed/bound/attached/acked/lifecycle/withdrawn，daemon messages-facts 单事件） */
    | { kind: 'facts'; facts: MessageFact[] }
    /** 上下文用量（null = 清空，/clear 后新会话从 0 开始） */
    | { kind: 'context-usage'; contextUsage: ContextUsage | null }
    /** 轮次起点（running 翻转 false→true 时上报，StatusBar 计时权威） */
    | { kind: 'run-started'; runStartedAt: number }
    /** 「此刻能不能收消息」的事实（状态翻转才报；写端在 inboundChannel） */
    | { kind: 'receive-readiness'; canReceive: boolean }
    /** goal 状态（null = 清空） */
    | { kind: 'goal-status'; goalStatus: GoalStatus | null }
    /** prompt cache 状态（null = 清空，首个 result 帧统一清） */
    | { kind: 'cache-status'; cacheStatus: CacheStatus | null }

export type SessionChannelOptions = {
    token: string
    session: Session
    transport: SessionTransport
    /** 非用户内容入站（session-update 事件体 / 无法解析的消息 content）向上冒泡 */
    onMessage: (content: unknown) => void
    /** 协议活动信号（版本化更新等——调用方据此重置空闲计时器） */
    onActivity?: () => void
}

/**
 * 会话协议 module（深化候选③票①）：CLI↔daemon 的会话语义收发。
 *
 * 职责：入站消息（用户消息回调 + seq 记账 + 断线 HTTP 补拉）、出站消息五族
 * （SDK 消息咽喉 / 用户 / agent / 事件 / 入站跨会话转记）、流式快照三方法、
 * 事实与状态上报（单一 report 出口）、rewind 两段回报（可靠队列）、
 * agent 编排 RPC、metadata/agentState 版本化 CAS 更新。
 * **不含连接语义**（建连/重连/保活在 SessionTransport）——传输与协议分离，各自可测。
 */
export class SessionChannel {
    readonly sessionId: string
    private readonly token: string
    private readonly transport: SessionTransport
    private readonly onMessage: (content: unknown) => void
    private readonly onActivity?: () => void

    private metadata: Metadata | null
    private metadataVersion: number
    private agentState: AgentState | null
    private agentStateVersion: number
    private readonly metadataLock = new AsyncLock()
    private readonly agentStateLock = new AsyncLock()

    private pendingMessages: UserMessage[] = []
    private pendingMessageCallback: ((message: UserMessage) => void) | null = null
    private lastSeenMessageSeq: number | null = null
    private backfillInFlight: Promise<void> | null = null
    private needsBackfill = false
    private hasConnectedOnce = false

    /** rewind 两段回报的可靠上报队列（ack 确认制，M5） */
    private readonly rewindReportQueue: ReliableRewindReportQueue
    /**
     * snapshot 流重基线回调（delta 协议）：socket 重连建立后调用，让进行中消息的
     * snapshot 发送器立即重发全量帧（断线期间的增量帧已丢，daemon 链必断档，全量重建基线）。
     * 由 claudeRemoteLauncher 在创建发送器时注入。
     */
    private onSnapshotTransportReset: (() => void) | null = null

    constructor(opts: SessionChannelOptions) {
        this.token = opts.token
        this.sessionId = opts.session.id
        this.transport = opts.transport
        this.onMessage = opts.onMessage
        this.onActivity = opts.onActivity
        this.metadata = opts.session.metadata
        this.metadataVersion = opts.session.metadataVersion
        this.agentState = opts.session.agentState
        this.agentStateVersion = opts.session.agentStateVersion

        // rewind 两段回报改走可靠队列（M5）：ack 确认 + 失败重试 + 重连补发，
        // 断线窗口内 fire-and-forget 丢事件会造成 CLI transcript / daemon DB 永久分叉
        const transport = this.transport
        this.rewindReportQueue = new ReliableRewindReportQueue({
            get connected() { return transport.connected },
            emitAck: (event, body, callback) => {
                transport.emitAckCallback(event, body, REWIND_REPORT_ACK_TIMEOUT_MS, callback)
            },
        })
    }

    // ── 连接状态反应（由门面在传输回调里驱动）──

    /** 连接建立（first = 首连）：重放未确认回报、snapshot 重基线、断窗补拉、上报存活 */
    handleConnected(first: boolean): void {
        this.rewindReportQueue.onConnected()
        // snapshot delta 流重基线：断线期间的增量帧已丢，重发全量帧重建 daemon 侧基线
        this.onSnapshotTransportReset?.()
        if (!first) {
            this.needsBackfill = true
        }
        this.hasConnectedOnce = true
        void this.backfillIfNeeded()
        this.transport.emit('session-alive', {
            sid: this.sessionId,
            time: Date.now(),
            running: false,
        })
    }

    /** 连接断开：标记需要补拉（下次连接建立时兑现） */
    handleDisconnected(): void {
        if (this.hasConnectedOnce) {
            this.needsBackfill = true
        }
    }

    // ── 入站 ──

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

    /** 会话下行更新分流：new-message → 入站消息；update-session → 版本化缓存；其余冒泡 */
    handleSessionUpdate(data: Update): void {
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

            this.onMessage(data.body)
        } catch (error) {
            logger.debug('[SOCKET] [UPDATE] [ERROR] Error handling update', { error })
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

        // mobi 自发投递的跨会话消息**不由落库行回灌**：它的投递通道是 push-agent-message RPC
        // （daemon 刻意不回灌 CLI 房间），落库行只供 Web 展示与历史回放。但断线重连后的
        // backfillMessages 会照 seq 把这行读回来——不跳过就会被二次入队，同一句话投两遍。
        // seq 记账已在上方完成：这行仍是会话序列的一部分，重连时不能被当成「没见过的」。
        if (isMobiSentCrossSession(message.content)) {
            return
        }

        const userResult = UserMessageSchema.safeParse(message.content)
        if (userResult.success) {
            // localId 由 daemon 放在 message 外层（与 content 信封同级），合并进 UserMessage
            // 供 runClaude 入队 → collectBatch → emitMessagesSubmitted 追踪 consume
            this.enqueueUserMessage({ ...userResult.data, localId: message.localId ?? userResult.data.localId ?? undefined })
            return
        }

        this.onMessage(message.content)
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
                            'Content-Type': 'application/json',
                        },
                        timeout: 15_000,
                    },
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
                        observedSeq,
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

    // ── 出站消息五族 ──

    sendClaudeSessionMessage(body: RawJSONLines): void {
        // mobi 合成事件信封（turnDiffReporter 等非 SDK 消息，mobiCustomEvent 标记）：
        // custom role 原样落库（ADR 0002 自定义事件形态），不经 agent output 包装。
        // localId 无 native 语义（随机生成仅供 daemon 去重）；结构性合成消息不携带 native 锚点
        if ((body as { mobiCustomEvent?: unknown }).mobiCustomEvent === true) {
            this.transport.emit('session-message', {
                sid: this.sessionId,
                message: body,
                localId: randomUUID(),
                category: 'persistent',
                // 位置声明（turnDiffReporter 卡片）：归属 result 行的 nativeId——daemon 据
                // 该行定位 position_at（result 前 -1ms），早于 queue 投喂的 position 地板，
                // 卡片不输给下一轮用户气泡
                positionBeforeResultId: (body as { positionBeforeResultId?: string }).positionBeforeResultId,
            })
            return
        }

        // 在发送端分类，避免 daemon 重复分类
        const subtype = body.type === 'system' ? body.subtype : undefined
        const category = classifyMessage(body.type, subtype)

        // discard 统一在此拦截：remote 循环入口（claudeRemoteLauncher）虽已过滤，
        // 但 local 模式 scanner（转录 JSONL 含 command_lifecycle 等控制帧）等旁路
        // 直接调用本方法——发送端唯一咽喉点，保证 discard 消息不进 daemon 不落库
        if (category === 'discard') return

        // 恢复后缓存过期提示的生命周期终点：首个 result 帧（两模式共用咽喉点）即清，
        // 提示只在「恢复后首轮前」有意义。RawJSONLines 无 'result' discriminant
        // （见 sdkToLogConverter case 'result'），走开放形状断言（同 claudeRemoteLauncher 先例）
        if ((body as { type?: string }).type === 'result') {
            this.report({ kind: 'cache-status', cacheStatus: null })
        }

        let content: MessageContent

        if (body.type === 'user' && typeof body.message.content === 'string' && body.isSidechain !== true && body.isMeta !== true) {
            content = {
                role: 'user',
                content: {
                    type: 'text',
                    text: body.message.content,
                },
                meta: {
                    sentFrom: 'cli',
                },
            }
        } else {
            content = {
                role: 'agent',
                content: {
                    type: 'output',
                    data: body,
                },
                meta: {
                    sentFrom: 'cli',
                },
            }
        }

        this.transport.emit('session-message', {
            sid: this.sessionId,
            message: content,
            // 使用 Claude Code 的 uuid 作为 localId，供 daemon DB 去重
            // resume 场景下同一消息的 uuid 保持不变，daemon 可通过 localId 避免重复存储
            localId: body.uuid,
            // SDK 消息自带 uuid 与 session id，一并写入 metadata（rewind 锚点）
            metadata: { nativeId: body.uuid, nativeSessionId: body.session_id || undefined },
            category,
        })

        if (body.type === 'summary' && 'summary' in body && 'leafUuid' in body) {
            this.updateMetadata((metadata) => ({
                ...metadata,
                name: body.summary,
                summary: {
                    text: body.summary,
                    updatedAt: Date.now(),
                },
            }))
        }
    }

    sendUserMessage(text: string, meta?: MessageMeta): void {
        if (!text) {
            return
        }

        const content: MessageContent = {
            role: 'user',
            content: {
                type: 'text',
                text,
            },
            meta: {
                sentFrom: 'cli',
                ...(meta ?? {}),
            },
        }

        this.transport.emit('session-message', {
            sid: this.sessionId,
            message: content,
        })
    }

    /**
     * 落库入站 turn（UserPromptSubmit hook 观测到的 peer / scheduled / loop）。
     * 该消息未经 daemon 发送通道，此处是它唯一的持久化入口；
     * sentFrom 保留 'cli' 是存量行形状（这条是 CLI 转记的不假），**不入队由下面的
     * crossSession 标注决定**——见 shared 的 isQueueableUserSubmission 判据②。
     *
     * `origin` 就是信封读侧归一出来的来源身份（与原消息同一 concept）；scheduled / loop
     * 不是别的会话发来的，传 null——**来源身份照样写**（crossSession 键恒在，名字空串），
     * 只是没有 id。
     */
    sendInboundCrossSessionMessage(text: string, kind: TurnOrigin, origin: CrossSessionOrigin | null, nativeId: string): void {
        const content: MessageContent = {
            role: 'user',
            content: {
                type: 'text',
                text,
            },
            meta: {
                sentFrom: 'cli',
                // 跨会话来源形状单源（shared 的 origin concept）。`origin` 为 null 就是
                // 「这条 turn 没有来源会话」（scheduled / loop）——投影照写空名字，键仍然恒在，
                // web 端判空后显示「来自 其他会话」；键缺失会让 web 的 compact 误判守卫失效，
                // 降级消息会被误渲染成 compact-summary
                ...toCrossSessionMeta(origin),
                // turnOrigin 区分入站来源（spec 批次 D）：peer/scheduled/loop
                turnOrigin: kind,
            },
        }
        this.transport.emit('session-message', {
            sid: this.sessionId,
            message: content,
            // hook 输入无稳定 native 锚，localId 仅作唯一标识（随机 uuid）；
            // SDK 重试重放的理论重复观测无去重，概率低可接受
            localId: nativeId,
            metadata: { nativeId },
            category: classifyMessage('user'),
        })
    }

    sendAgentMessage(body: unknown): void {
        const content = {
            role: 'agent',
            content: {
                type: 'agent',
                data: body,
            },
            meta: {
                sentFrom: 'cli',
            },
        }
        this.transport.emit('session-message', {
            sid: this.sessionId,
            message: content,
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
        /** 压缩开始（手动 /compact 与自动压缩统一 started 信号，launcher 幂等收口后发出） */
        type: 'compact-started'
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
                data: event,
            },
        }

        this.transport.emit('session-message', {
            sid: this.sessionId,
            message: content,
        })
    }

    // ── 流式快照三方法 ──

    /** 注册 snapshot 流重基线回调（delta 协议，socket 重连时触发全量重发） */
    setSnapshotTransportReset(fn: (() => void) | null): void {
        this.onSnapshotTransportReset = fn
    }

    /**
     * 发送流式内容快照——全量帧（delta 协议基线）。frame 携带 rev（baseRev=null）；
     * 缺省时为 legacy 全量（老协议直通，daemon 不建链）。
     */
    sendContentSnapshot(message: DecryptedMessage, frame?: { rev: number }): void {
        this.transport.emit('session-message', {
            sid: this.sessionId,
            message: message.content,
            localId: message.localId ?? undefined,
            snapshot: true,
            frame: frame ? { rev: frame.rev, baseRev: null } : undefined,
        })
    }

    /** 发送流式内容快照——增量帧（首帧全量基线之后，仅携带增量 op）。
     *  带 snapshot:true——老 daemon（无 delta 分支）按快照透传而非误落库（混版本防 transcript 污染） */
    sendSnapshotDelta(frame: SnapshotDeltaFrame): void {
        this.transport.emit('session-message', {
            sid: this.sessionId,
            message: undefined,
            localId: frame.localId,
            snapshot: true,
            snapshotDelta: frame,
        })
    }

    /** snapshot 流结束信号：full message 已持久化，daemon 据此精确清该流缓存与订阅游标
     *  （full 的 localId 与流的 sdkUuid 不同，daemon 无法自行映射）。老 daemon 无 handler 静默忽略 */
    sendSnapshotStreamEnd(localId: string): void {
        this.transport.emit('snapshot-stream-end', { sid: this.sessionId, localId })
    }

    // ── 事实与状态上报：单一 report 出口（传输层按 kind 映射 socket 事件名）──

    report(event: SessionChannelReport): void {
        switch (event.kind) {
            case 'facts':
                if (event.facts.length === 0) return
                this.transport.emit('messages-facts', { sid: this.sessionId, facts: event.facts })
                return
            case 'context-usage':
                this.transport.emit('context-usage', { sid: this.sessionId, contextUsage: event.contextUsage })
                return
            case 'run-started':
                this.transport.emit('run-started', { sid: this.sessionId, runStartedAt: event.runStartedAt })
                return
            case 'receive-readiness':
                this.transport.emit('receive-readiness', { sid: this.sessionId, canReceive: event.canReceive })
                return
            case 'goal-status':
                this.transport.emit('goal-status', { sid: this.sessionId, goalStatus: event.goalStatus })
                return
            case 'cache-status':
                this.transport.emit('cache-status', { sid: this.sessionId, cacheStatus: event.cacheStatus })
                return
        }
    }

    // ── rewind 两段回报（ack 确认制可靠队列）──

    /** 反查 rewind 截断边界：同 metadata.nativeId 的最小 seq 行（锚点批首行，1:N 批整批同删的定界）。
     *  走既有 GET /cli/sessions/:id/messages 接口正向分页（afterSeq 游标递进，对齐 backfillMessages）；
     *  消息按 seq 升序返回，首个命中即最小 seq。未找到（行已删 / daemon DTO 未含 metadata）返回 0，
     *  调用方按边界反查失败处理（跳过 truncated 上报，completed 带 error 收尾）。 */
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
                        'Content-Type': 'application/json',
                    },
                    timeout: 15_000,
                },
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

    /** rewind 截断成功上报（CLI → daemon，ack 确认制）：daemon 即刻软删除 seq ∈ [deleteFromSeq, 受理上界] 的行并转 SSE */
    emitRewindTruncated(nativeId: string, deleteFromSeq: number): void {
        this.rewindReportQueue.enqueue({ event: 'rewind-truncated', body: { sid: this.sessionId, nativeId, deleteFromSeq } })
    }

    /** rewind 终态上报（CLI → daemon，ack 确认制）：转 SSE；filesRestored=false 时 error 携带原因；skippedLinks 为安全护栏跳过的文件数（spec E2） */
    emitRewindCompleted(filesRestored: boolean, error?: string, skippedLinks?: number): void {
        this.rewindReportQueue.enqueue({ event: 'rewind-completed', body: { sid: this.sessionId, filesRestored, error, skippedLinks } })
    }

    // ── agent 编排 RPC（B 类工具族 / UI 命令）──

    /**
     * 发送 UI 命令到 daemon（agent-apps，A 类 UI 呈现）。
     * ack 回执（{ delivered } 是 open_in_mobi 等工具的核心语义，不用 fire-and-forget）；
     * 超时/断连 reject，由调用方按连接故障处理（与离线 delivered:false 语义区分）。
     */
    async sendUiCommand(action: UiCommandAction): Promise<UiCommandAck> {
        return await this.transport.emitWithAck<UiCommandAck>('sendUiCommand', { sid: this.sessionId, action }, UI_COMMAND_ACK_TIMEOUT_MS)
    }

    /**
     * 列出会话供 agent 挑选派活目标（B 类工具族）。
     *
     * 与 sendUiCommand 同口径：业务失败（入参非法 / 无权限）走 ack 的
     * ok:false，连接故障走 reject，两者语义不同。
     * 查询条件从 wire 类型派生（去掉 sid）——CLI 只填 sid，其余原样透传。
     */
    async listSessionsForAgent(query: Omit<AgentSessionsRequest, 'sid'>): Promise<AgentSessionsAck> {
        return await this.transport.emitWithAck<AgentSessionsAck>('listSessionsForAgent', { sid: this.sessionId, ...query }, AGENT_OP_ACK_TIMEOUT_MS)
    }

    /**
     * 起一个新会话（B 类工具族）。
     *
     * 等待上限比列表类长得多：这一步真的在起进程——daemon 要等会话 webhook
     * （最多 15s），daemon 的 RPC 自身也有 30s 上限，所以 ack 可能几秒后才回。
     * 口径仍与列表类一致：业务失败走 ack 的 ok:false（文案已由 daemon 翻译好），
     * 连接故障走 reject。
     */
    async createSessionForAgent(input: Omit<AgentCreateSessionRequest, 'sid'>): Promise<AgentCreateSessionAck> {
        return await this.transport.emitWithAck<AgentCreateSessionAck>('createSessionForAgent', { sid: this.sessionId, ...input }, AGENT_CREATE_SESSION_ACK_TIMEOUT_MS)
    }

    /**
     * 把一条消息投给若干会话（B 类工具族）。
     *
     * 等待上限比列表类长：daemon 侧每个目标一次 RPC 往返（单次上限 30s），扇出并发但要等
     * 最慢的那个回来。60s = 一次卡住的 30s 上限 + 一倍余量。
     *
     * 口径与列表类一致：业务失败（入参非法 / 无权限）走 ack 的 ok:false，
     * 连接故障走 reject。**进了扇出顶层恒 ok:true**，成败逐条看 results。
     */
    async sendMessageToSessionsForAgent(input: Omit<AgentSendMessageRequest, 'sid'>): Promise<AgentSendMessageAck> {
        return await this.transport.emitWithAck<AgentSendMessageAck>('sendMessageToSessionForAgent', { sid: this.sessionId, ...input }, AGENT_SEND_MESSAGE_ACK_TIMEOUT_MS)
    }

    // ── 会话结束 ──

    /**
     * 会话结束上报（ack 制）：确认 daemon 落达（或超时兜底）才返回，调用方（cleanup
     * 流程）据此再关 socket——裸 emit + 立即 close 会把事件丢在本地缓冲，daemon 收不到
     * session-end，active 永久悬挂（2026-09-30 事故）。超时/断连时关闭照常进行，
     * daemon 侧由心跳过期清扫收敛 active。
     */
    async sendSessionDeath(): Promise<void> {
        void cleanupUploadDir(this.sessionId)
        try {
            await this.transport.emitWithAck('session-end', { sid: this.sessionId, time: Date.now() }, SESSION_END_ACK_TIMEOUT_MS)
        } catch {
            // 上报失败不阻塞退出流程
        }
    }

    // ── 版本化 CAS 更新（metadata / agentState）──

    updateMetadata(handler: (metadata: Metadata) => Metadata): void {
        this.metadataLock.inLock(async () => {
            this.onActivity?.()

            await backoff(async () => {
                const current = this.metadata ?? ({} as Metadata)
                const updated = handler(current)

                const answer = await this.transport.emitWithAck<unknown>('update-metadata', {
                    sid: this.sessionId,
                    expectedVersion: this.metadataVersion,
                    metadata: updated,
                }, 5_000)

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
                    versionMismatchMessage: 'Metadata version mismatch',
                })
            })
        })
    }

    updateAgentState(handler: (state: AgentState) => AgentState): void {
        this.agentStateLock.inLock(async () => {
            this.onActivity?.()

            await backoff(async () => {
                const current = this.agentState ?? ({} as AgentState)
                const updated = handler(current)

                const answer = await this.transport.emitWithAck<unknown>('update-state', {
                    sid: this.sessionId,
                    expectedVersion: this.agentStateVersion,
                    agentState: updated,
                }, 5_000)

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
                    versionMismatchMessage: 'Agent state version mismatch',
                })
            })
        })
    }

    // ── flush 支撑：等待在途版本化更新排空 ──

    /** 排空 metadata/agentState 在途更新（deadline 语义：超时放弃，不抛） */
    async drainPendingUpdates(remainingMs: () => number): Promise<void> {
        await this.drainLock(this.metadataLock, remainingMs())
        await this.drainLock(this.agentStateLock, remainingMs())
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
}
