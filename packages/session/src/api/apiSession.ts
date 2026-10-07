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
import { logger } from '@mobi/node-core/logger'
import { configuration } from '@mobi/node-core/configuration'
import type { RawJSONLines } from '../claude/types'
import type {
    AgentCreateSessionAck,
    AgentCreateSessionRequest,
    AgentSendMessageAck,
    AgentSendMessageRequest,
    AgentSessionsAck,
    AgentSessionsRequest,
    CacheStatus,
    CommandLifecycleState,
    ContextUsage,
    CrossSessionOrigin,
    DecryptedMessage,
    EffortLevel,
    GoalStatus,
    MessageFact,
    SnapshotDeltaFrame,
    TurnOrigin,
    UiCommandAction,
    UiCommandAck,
} from '@mobi/shared'
import type {
    AgentState,
    MessageMeta,
    Metadata,
    Session,
    SessionModel,
    SessionPermissionMode,
    UserMessage,
} from '@mobi/node-core/api/types'
import { RpcHandlerManager } from '@mobi/node-core/rpc/RpcHandlerManager'
import { registerCommandHandlers } from '@mobi/node-core/handlers/commands'
import { IdleTimer } from '../modules/common/idleTimer'
import { SessionTransport } from './sessionTransport'
import { SessionChannel, type SessionEventPayload } from './sessionChannel'

/**
 * CLI↔daemon 会话通道门面（深化候选③票①）。
 *
 * 实现拆为两个深 module，本类只做装配与转发（消费方零迁移）：
 * - {@link SessionTransport} 会话传输：连接/重连/退避/ack 超时/心跳——传输保活语义
 * - {@link SessionChannel} 会话协议：消息收发五族/快照/事实与状态上报/rewind 回报/
 *   agent 编排 RPC/版本化 CAS 更新——会话语义
 *
 * 留在门面的：生命周期编排（IdleTimer + rpcHandlerManager 接线、flush 排空顺序、
 * close 次序）与对消费者的 EventEmitter 事件（'reconnected'/'message'/'idle-timeout' 等）。
 */
export class ApiSessionClient extends EventEmitter {
    readonly sessionId: string
    private readonly transport: SessionTransport
    private readonly channel: SessionChannel
    readonly rpcHandlerManager: RpcHandlerManager
    private idleTimer: IdleTimer | null = null
    /**
     * 休眠 gate 判定（dormancy spec）：false = 有阻塞事务（审批/排队/turn/终端/后台任务），
     * 空闲到点不退出、进入 IdleTimer 阻塞复查。由 runClaude 装配完成后安装。
     */
    private dormancyDecide: (() => boolean) | null = null

    // 原 ApiClient.sessionSyncClient 工厂（ticket-12：ApiClient 归 node-core 后跨包无法直接构造本类）
    static create(token: string, session: Session): ApiSessionClient {
        return new ApiSessionClient(token, session)
    }

    constructor(token: string, session: Session) {
        super()
        this.sessionId = session.id

        this.rpcHandlerManager = new RpcHandlerManager({
            scopePrefix: this.sessionId,
            logger: (msg, data) => logger.debug(msg, data)
        })

        if (session.metadata?.path) {
            // 深化候选②票②：socket 注册只剩 refreshMetadata（唯一活 wire——daemon rpcGateway
            // 经 'rpc-request' 调用）；文件/上传/审查族 handler 注册已死（ticket-20 起 daemon
            // 全走 LocalExecutor 直调），不再上线
            registerCommandHandlers(this.rpcHandlerManager, session.metadata.path)
        }

        // 初始化 IdleTimer。休眠 gate 的复查判定经 onIdleTimeoutBlockedRecheck 注入
        // （单一接线：到点查 gate → 阻塞则 IdleTimer 自主进入复查节奏），provider 在
        // 构造后才由 runClaude 安装（installDormancyDecide），未安装时放行（同旧版语义）
        this.idleTimer = new IdleTimer({
            disconnectTimeoutMs: configuration.disconnectTimeoutMs,
            idleTimeoutMs: configuration.idleTimeoutMs,
            warningMs: configuration.timeoutWarningMs,
            onWarning: () => this.handleIdleWarning(),
            onDisconnectTimeout: () => this.handleDisconnectTimeout(),
            onIdleTimeout: () => this.handleIdleTimeout(),
            onIdleTimeoutBlockedRecheck: () => this.dormancyDecide?.() ?? true
        })

        // 设置 RPC 调用回调
        this.rpcHandlerManager.setOnRpcCalled(() => {
            this.idleTimer?.reset()
        })

        const rpcHandlerManager = this.rpcHandlerManager
        this.transport = new SessionTransport(token, this.sessionId, {
            onConnected: ({ first }) => {
                this.emit('reconnected')
                rpcHandlerManager.onSocketConnect(this.transport.socket)
                this.idleTimer?.onReconnect()
                // 协议层连接反应：rewind 补发、snapshot 重基线、断窗补拉、存活上报
                this.channel.handleConnected(first)
            },
            onDisconnected: () => {
                rpcHandlerManager.onSocketDisconnect()
                this.idleTimer?.onDisconnect()
                this.channel.handleDisconnected()
            },
            onRpcRequest: (data) => rpcHandlerManager.handleRequest(data),
            onSessionUpdate: (update) => this.channel.handleSessionUpdate(update),
        })

        this.channel = new SessionChannel({
            token,
            session,
            transport: this.transport,
            onMessage: (content) => this.emit('message', content),
            // 版本化更新等协议活动重置空闲计时器（生命周期语义留在门面）
            onActivity: () => this.idleTimer?.reset(),
        })
    }

    // ── 入站 ──

    onUserMessage(callback: (data: UserMessage) => void): void {
        this.channel.onUserMessage(callback)
    }

    // ── 出站消息五族（会话协议）──

    sendClaudeSessionMessage(body: RawJSONLines): void {
        this.channel.sendClaudeSessionMessage(body)
    }

    sendUserMessage(text: string, meta?: MessageMeta): void {
        this.channel.sendUserMessage(text, meta)
    }

    /** 落库入站 turn（UserPromptSubmit hook 观测到的 peer / scheduled / loop）——语义详见 SessionChannel */
    sendInboundCrossSessionMessage(text: string, kind: TurnOrigin, origin: CrossSessionOrigin | null, nativeId: string): void {
        this.channel.sendInboundCrossSessionMessage(text, kind, origin, nativeId)
    }

    sendAgentMessage(body: unknown): void {
        this.channel.sendAgentMessage(body)
    }

    sendSessionEvent(event: SessionEventPayload, id?: string): void {
        this.channel.sendSessionEvent(event, id)
    }

    // ── 流式快照三方法 ──

    /** 注册 snapshot 流重基线回调（delta 协议，socket 重连时触发全量重发） */
    setSnapshotTransportReset(fn: (() => void) | null): void {
        this.channel.setSnapshotTransportReset(fn)
    }

    /** 发送流式内容快照——全量帧（delta 协议基线）。语义详见 SessionChannel */
    sendContentSnapshot(message: DecryptedMessage, frame?: { rev: number }): void {
        this.channel.sendContentSnapshot(message, frame)
    }

    /** 发送流式内容快照——增量帧（首帧全量基线之后，仅携带增量 op） */
    sendSnapshotDelta(frame: SnapshotDeltaFrame): void {
        this.channel.sendSnapshotDelta(frame)
    }

    /** snapshot 流结束信号：full message 已持久化，daemon 据此精确清该流缓存与订阅游标 */
    sendSnapshotStreamEnd(localId: string): void {
        this.channel.sendSnapshotStreamEnd(localId)
    }

    // ── 消息事实六合一（旧接口翻译为 channel.report，wire 仍是 messages-facts 单事件）──

    /** 通知 daemon：这批 localId 的消息已推给 Claude Code（pushed 转换，写入 lifecycle/lifecycle_at） */
    emitMessagesSubmitted(localIds: string[]): void {
        if (localIds.length === 0) return
        this.channel.report({ kind: 'facts', facts: [{ kind: 'pushed', localIds, at: Date.now() }] })
    }

    /** 通知 daemon：这批 localId 的用户消息已绑定 native 锚点（push 给 SDK 时生成，批内同值）。
     * nativeSessionId 在 push 时已知（非首条消息）则直接带上，省去 attach 补写往返；
     * 首条消息 push 时 session id 未知，留空由 attach 补写 */
    emitMessagesBound(bindings: { localId: string; nativeId: string }[], nativeSessionId?: string): void {
        if (bindings.length === 0) return
        this.channel.report({
            kind: 'facts',
            facts: bindings.map((b): MessageFact => ({
                kind: 'bound',
                localId: b.localId,
                nativeId: b.nativeId,
                ...(nativeSessionId ? { nativeSessionId } : {})
            })),
        })
    }

    /** 通知 daemon：native session 已切换（onSessionFound 变化），补写该会话缺 nativeSessionId 的消息行 */
    emitNativeAttached(nativeSessionId: string): void {
        this.channel.report({ kind: 'facts', facts: [{ kind: 'attached', nativeSessionId }] })
    }

    /** 通知 daemon：CC 已回显接收该 nativeId 的用户消息（acked 转换，rewind 判据） */
    emitMessagesAcked(nativeId: string): void {
        this.channel.report({ kind: 'facts', facts: [{ kind: 'acked', nativeId, at: Date.now() }] })
    }

    /** 上报 command_lifecycle 终态信号（CC 排队消息生命周期回执转译，见 commandLifecycleToFact）。
     *  state 含 refused（跨会话 peer 消息被拒收）；terminalReason 开放透传（上游 Open set，U-13） */
    emitLifecycleFact(
        nativeId: string,
        state: CommandLifecycleState,
        at?: number,
        terminalReason?: string,
    ): void {
        this.channel.report({
            kind: 'facts',
            facts: [{ kind: 'lifecycle', nativeId, state, at: at ?? Date.now(), ...(terminalReason ? { terminalReason } : {}) }],
        })
    }

    /** 上报撤回（#53：最后一条 user 无输出即停）——daemon 据此软删除并广播 message-withdrawn 回填 */
    emitWithdrawnFact(nativeId: string): void {
        this.channel.report({ kind: 'facts', facts: [{ kind: 'withdrawn', nativeId, at: Date.now() }] })
    }

    // ── 运行状态上报（旧接口翻译为 channel.report）──

    /**
     * 上报上下文用量（事件驱动采集）。
     * daemon 落库到 runtimeState.contextUsage + SSE 推 web。
     */
    reportContextUsage(usage: ContextUsage): void {
        this.channel.report({ kind: 'context-usage', contextUsage: usage })
    }

    /**
     * 清空上下文用量（/clear 后新会话从 0 开始）。
     * 复用 context-usage 通道，contextUsage 传 null：daemon 据此清 runtimeState.contextUsage + SSE 推，
     * web 端用量线隐藏，直到下次真实 turn 的 result 到达。
     */
    clearContextUsage(): void {
        this.channel.report({ kind: 'context-usage', contextUsage: null })
    }

    /**
     * 上报当前轮次起点（running 翻转 false→true 时，SessionBase.onRunningChange 触发）。
     * daemon 落库到 runtimeState.runStartedAt + SSE 推 web——StatusBar 计时的权威来源，
     * 不随 web 消息窗口化丢失（docs/pending.md #55）。
     */
    reportRunStarted(at: number): void {
        this.channel.report({ kind: 'run-started', runStartedAt: at })
    }

    /**
     * 上报「本会话此刻能不能收消息」（sink 接通 / 断开时各一次，**状态翻转才报**）。
     *
     * daemon 用它等「建完即可用」：从 spawn 回执到 sink 接通隔着 130–550ms，回执那一刻只有
     * 「进程上线了」。也用它把投递失败说准——「还没接上」和「已经退出」是两回事。
     *
     * 它是**此刻**的事实，不是稳定属性：sink 在每轮收尾被清空、下一轮再接上，所以这个值
     * 会反复翻转（见 daemon 侧 SessionReceiveReadiness 的说明）。
     *
     * 这里是唯一的出口，但**写端不在这里**：谁在什么时候翻，由
     * [`claude/utils/inboundChannel.ts`](../claude/utils/inboundChannel.ts) 的 InboundChannel 决定
     * （sink 生死与上报必须同步，两者分开在两个文件里就是靠人记着配对）。
     */
    reportReceiveReadiness(canReceive: boolean): void {
        this.channel.report({ kind: 'receive-readiness', canReceive })
    }

    /**
     * 上报 goal 状态（daemon 落库到 runtimeState.goalStatus + SSE 推 web）。
     * goalStatus 为 null 表示清空（达成 10s 后自动清空 / 手动清理）。
     */
    reportGoalStatus(goalStatus: GoalStatus | null): void {
        this.channel.report({ kind: 'goal-status', goalStatus })
    }

    /**
     * 上报会话恢复时的 prompt cache 状态（daemon 落库到 runtimeState.cacheStatus + SSE 推 web）。
     * 仅 SessionStart(resume/fork) 且缓存过期时调用；首个 result 帧到达时由
     * sendClaudeSessionMessage 统一清空（过期提示只在首轮前有意义）。
     */
    reportCacheStatus(cacheStatus: CacheStatus): void {
        this.channel.report({ kind: 'cache-status', cacheStatus })
    }

    // ── rewind（会话协议）──

    /**
     * 反查 rewind 截断边界：同 metadata.nativeId 的最小 seq 行（锚点批首行，1:N 批整批同删的定界）。
     * 未找到返回 0，调用方按边界反查失败处理（跳过 truncated 上报，completed 带 error 收尾）。
     */
    fetchRewindBoundary(nativeId: string): Promise<number> {
        return this.channel.fetchRewindBoundary(nativeId)
    }

    /** rewind 截断成功上报（CLI → daemon，ack 确认制）：daemon 即刻软删除 seq ∈ [deleteFromSeq, 受理上界] 的行并转 SSE */
    emitRewindTruncated(nativeId: string, deleteFromSeq: number): void {
        this.channel.emitRewindTruncated(nativeId, deleteFromSeq)
    }

    /** rewind 终态上报（CLI → daemon，ack 确认制）：转 SSE；filesRestored=false 时 error 携带原因；skippedLinks 为安全护栏跳过的文件数（spec E2） */
    emitRewindCompleted(filesRestored: boolean, error?: string, skippedLinks?: number): void {
        this.channel.emitRewindCompleted(filesRestored, error, skippedLinks)
    }

    // ── agent 编排 RPC（B 类工具族 / UI 命令）──

    /**
     * 发送 UI 命令到 daemon（agent-apps，A 类 UI 呈现）。
     * ack 回执（{ delivered } 是 open_in_mobi 等工具的核心语义，不用 fire-and-forget）；
     * 超时/断连 reject，由调用方按连接故障处理（与离线 delivered:false 语义区分）。
     */
    sendUiCommand(action: UiCommandAction): Promise<UiCommandAck> {
        return this.channel.sendUiCommand(action)
    }

    /**
     * 列出会话供 agent 挑选派活目标（B 类工具族）。
     * 业务失败（入参非法 / 无权限）走 ack 的 ok:false，连接故障走 reject——语义详见 SessionChannel。
     */
    listSessionsForAgent(query: Omit<AgentSessionsRequest, 'sid'>): Promise<AgentSessionsAck> {
        return this.channel.listSessionsForAgent(query)
    }

    /**
     * 起一个新会话（B 类工具族）。等待上限 45s：这一步真的在起进程（daemon 等会话 webhook
     * 最多 15s + RPC 自身 30s 上限），ack 可能几秒后才回——口径详见 SessionChannel。
     */
    createSessionForAgent(input: Omit<AgentCreateSessionRequest, 'sid'>): Promise<AgentCreateSessionAck> {
        return this.channel.createSessionForAgent(input)
    }

    /**
     * 把一条消息投给若干会话（B 类工具族）。等待上限 60s：daemon 侧每个目标一次 30s RPC 往返，
     * 扇出并发但要等最慢的回来。**进了扇出顶层恒 ok:true**，成败逐条看 results——详见 SessionChannel。
     */
    sendMessageToSessionsForAgent(input: Omit<AgentSendMessageRequest, 'sid'>): Promise<AgentSendMessageAck> {
        return this.channel.sendMessageToSessionsForAgent(input)
    }

    // ── 保活（会话传输）──

    keepAlive(
        running: boolean,
        mode: 'local' | 'remote',
        runtime?: { permissionMode?: SessionPermissionMode; model?: SessionModel; effort?: EffortLevel; outputStyle?: string },
    ): void {
        this.transport.keepAlive(this.sessionId, running, mode, runtime)
    }

    // ── 会话结束 ──

    /**
     * 会话结束上报（ack 制）：确认 daemon 落达（或超时兜底）才返回，调用方（cleanup
     * 流程）据此再关 socket——裸 emit + 立即 close 会把事件丢在本地缓冲，daemon 收不到
     * session-end，active 永久悬挂（2026-09-30 事故）。超时/断连时关闭照常进行，
     * daemon 侧由心跳过期清扫收敛 active。
     */
    sendSessionDeath(): Promise<void> {
        return this.channel.sendSessionDeath()
    }

    // ── 版本化 CAS 更新（会话协议）──

    updateMetadata(handler: (metadata: Metadata) => Metadata): void {
        this.channel.updateMetadata(handler)
    }

    updateAgentState(handler: (state: AgentState) => AgentState): void {
        this.channel.updateAgentState(handler)
    }

    // ── 生命周期（门面职责）──

    /** 排空在途更新 + 确认 daemon 落达（deadline 语义，超时放弃不抛） */
    async flush(options?: { timeoutMs?: number }): Promise<void> {
        const deadlineMs = Date.now() + (options?.timeoutMs ?? 5_000)
        const remainingMs = () => Math.max(0, deadlineMs - Date.now())

        await this.channel.drainPendingUpdates(remainingMs)

        if (remainingMs() === 0) {
            return
        }

        const connected = await this.transport.waitForConnected(remainingMs())
        if (!connected) {
            return
        }

        const pingTimeoutMs = remainingMs()
        if (pingTimeoutMs === 0) {
            return
        }

        await this.transport.ping(pingTimeoutMs)
    }

    close(): void {
        this.rpcHandlerManager.setOnRpcCalled(undefined)
        this.rpcHandlerManager.onSocketDisconnect()
        this.idleTimer?.destroy()
        this.transport.disconnect()
    }

    /**
     * 安装休眠 gate 判定（IdleTimer 阻塞复查的数据源；构造后装配，见构造处注释）
     */
    installDormancyDecide(decide: () => boolean): void {
        this.dormancyDecide = decide
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
        if (!this.transport.connected) {
            logger.debug('[API] Socket not connected, skipping idle warning')
            return
        }
        this.transport.emit('idle-timeout-warning', {
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

    private handleIdleTimeout(): void {
        // 阻塞判定已内聚在 IdleTimer（onIdleTimeoutBlockedRecheck）：到达此回调即 gate 放行
        logger.debug('[API] Idle timeout, exiting')
        this.emit('idle-timeout')
    }
}
