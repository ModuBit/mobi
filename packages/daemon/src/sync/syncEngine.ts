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

import type { DecryptedMessage, EffortLevel, PermissionMode, SDKMetadata, Session, SyncEvent } from '@mobi/shared/types'
import type { ExecutorState } from '@mobi/node-core/api/types'
import { DEFAULT_STOP_KIND, isCancelQueued, type DiffTarget, type PermissionAnswers, type PermissionUpdate, type ReviewActionResult, type ReviewCommitsResult, type ReviewContentsResult, type ReviewFilesResult, type ReviewOverview, type ReviewPatchResult, type Workspace, type WorkspaceFolder, type StopKind } from '@mobi/shared'
import type { Server } from 'socket.io'
import type { Store } from '../store'
import type { ForkCreationFailureReason } from '../store/sessionFork'
import type { WorkspaceSessionsResult } from '../store/sessions'
import { RewindDeleteBoundTracker } from './rewindDeleteBoundTracker'
import type { SessionFactsSink } from './sessionFacts'
import type { RpcRegistry } from '../socket/rpcRegistry'
import type { SSEManager } from '../sse/sseManager'
import { EventPublisher, type SyncEventListener } from './eventPublisher'
import { LocalExecutor } from '../executor/localExecutor'
import {
    isUnexpectedAlreadyRunning,
    UNEXPECTED_ALREADY_RUNNING,
    type ExecutorHost,
    type RpcDeleteUploadResponse,
    type RpcGetWebToolsConfigResponse,
    type RpcListDirectoryResponse,
    type RpcReadFileMetaResponse,
    type RpcReadFileRangeResponse,
    type RpcRefreshMetadataResponse,
    type RpcReplaceUploadResponse,
    type RpcSaveFileResponse,
    type RpcSetWebToolsConfigResponse,
    type RpcVerifyWebToolsProviderResponse,
    type RpcWriteFileRangeResponse,
    type SpawnSessionOptions
} from '../executor/executorHost'
import { getExecutorState } from './executorRuntime'
import { buildHostMetadata } from '@mobi/node-core/hostMetadata'
import { AgentSessionService } from './agentSessionService'
import { MessageService, type SendMessagePayload } from './messageService'
import { WorkspaceCache } from './workspaceCache'
import { RpcGateway } from './rpcGateway'
import { SessionCache } from './sessionCache'
import { readRpcFailure } from './rpcFailure'
import { SessionReceiveReadiness } from './sessionReceiveReadiness'
import { daemonLogger } from '../logger'

export type { Session, SyncEvent } from '@mobi/shared/types'
export type { SyncEventListener } from './eventPublisher'
export type {
    RpcDeleteUploadResponse,
    RpcGetWebToolsConfigResponse,
    RpcListDirectoryResponse,
    RpcPathExistsResponse,
    RpcReadFileMetaResponse,
    RpcReadFileRangeResponse,
    RpcRefreshMetadataResponse,
    RpcReplaceUploadResponse,
    RpcSaveFileResponse,
    RpcSetWebToolsConfigResponse,
    RpcVerifyWebToolsProviderResponse,
    RpcWriteFileRangeResponse
} from '../executor/executorHost'

export type ResumeSessionResult =
    | { type: 'success'; sessionId: string }
    | { type: 'error'; message: string; code: 'session_not_found' | 'access_denied' | 'executor_not_ready' | 'resume_unavailable' | 'resume_failed' }

/**
 * fork 会话创建（POST /api/sessions/:id/fork）的结构化结果：
 * 各失败 reason 由路由映射 HTTP 状态（session-not-found/access-denied → 404/403，
 * 锚点与 turn 起点校验 → 400，parent-native-missing → 409）。
 */
export type ForkSessionResult =
    | { ok: true; sessionId: string }
    | {
        ok: false
        /** access-denied 属于引擎的 namespace 协调；其余资格失败由 SessionForkStore 定义。 */
        reason: 'access-denied' | ForkCreationFailureReason
    }

/**
 * output style 切换的结构化结果（深化候选⑥）：在 CLI 的 RpcAcceptResult 之上叠加
 * confirmed（RPC 是否得到 CLI 明确回答），路由据此区分 409（confirmed：副作用确定
 * 未发生）与 502 + accepted:'unknown'（unconfirmed：副作用未知，引导刷新确认）。
 */
export type OutputStyleSwitchOutcome =
    | { accepted: true }
    | { accepted: false; reason: string; confirmed: true }
    | { accepted: false; reason: string; confirmed: false; cause?: string }

export class SyncEngine {
    private readonly eventPublisher: EventPublisher
    private readonly sessionCache: SessionCache
    /** Agent 会话操作（B 类工具族）的业务规则入口；socket handler 经此取用，不重新实现一遍规则 */
    readonly agentSessions: AgentSessionService
    private readonly workspaceCache: WorkspaceCache
    private readonly messageService: MessageService
    private readonly rpcGateway: RpcGateway
    /** 执行层（ticket-15 起）：文件/spawn 等本机执行调用收拢点；ticket-20 起 socket 实现退场，
     *  LocalExecutor 是唯一实现（public 供装配与契约测试注入边界）。401 起字段名去 machine
     *  （类型名 ExecutorHost 与目录改名随 602） */
    readonly executor: ExecutorHost
    private readonly store: Store
    /**
     * 「这个会话此刻能不能收消息」的事实（不落库——它随会话进程生灭）。
     *
     * 与 `active` / `running` 都不同：那两个各自回答「进程在不在」与「这一轮在不在干活」，
     * 而建完会话到真能收消息之间隔着上百毫秒，正是这个事实要填的缝。为什么必须由 CLI 报
     * 而不是 daemon 猜，见 SessionReceiveReadiness 的说明。
     */
    private readonly receiveReadiness = new SessionReceiveReadiness()
    /** rewind 软删除上界（受理时写 / 截断回报消费；与 CLI socket handler 共用实例，index.ts 注入） */
    private readonly rewindDeleteBounds: RewindDeleteBoundTracker
    private inactivityTimer: NodeJS.Timeout | null = null
    /** 唤醒防重入：在途 resume spawn 的会话集合（wakeSession 单源读写） */
    private readonly wakeInFlight = new Set<string>()
    /**
     * executor（同进程 spawn 管线）就绪标志：bridge 注入即置位（server.setExecutorBridge）。
     * 取代旧 machineCache online 检查作为「能否 spawn/resume」的判据——旧判据依赖 machines 表
     * 行状态，新判据直接反映执行层接线事实：bridge 未注入时 spawn 必报「bridge 未接线」。
     */
    private executorReady = false
    /** daemon 主 namespace（setDaemonNamespace 由 hubServer 盖章）：daemon-status 事件无
     *  sessionId 可解析，投递路由（SSE shouldSend namespace 匹配）靠它 */
    private daemonNamespace: string | null = null

    constructor(
        store: Store,
        io: Server,
        rpcRegistry: RpcRegistry,
        sseManager: SSEManager,
        rewindDeleteBounds?: RewindDeleteBoundTracker,
        executor?: ExecutorHost
    ) {        this.eventPublisher = new EventPublisher(sseManager, (event) => this.resolveNamespace(event))
        this.sessionCache = new SessionCache(store, this.eventPublisher)
        this.agentSessions = new AgentSessionService({
            getSessionsByNamespace: (namespace) => this.sessionCache.getSessionsByNamespace(namespace),
            // 与 Web 侧 spawn 路由共用同一个实现——工作区归属规则只写一份
            checkWorkspaceAssignable: (workspaceId, namespace) => checkWorkspaceAssignable(this, workspaceId, namespace),
            spawnSession: async (directory, options) => {
                // agent 会话创建不走 resume（无 resume 目标，already-running 不可达），收窄回既有契约
                const result = await this.executor.spawnSession(directory, options)
                return isUnexpectedAlreadyRunning(result)
                    ? { type: 'error', message: UNEXPECTED_ALREADY_RUNNING, failure: 'other' }
                    : result
            },
            getSessionByNamespace: (sessionId, namespace) => this.sessionCache.getSessionByNamespace(sessionId, namespace),
            // 投递（RPC）与落库（DB）是两个独立步骤，顺序由服务决定：先投递成功才落库，
            // 失败不落库——Web 上不该出现一条永远不会被处理的消息
            pushAgentMessage: (sessionId, delivery) => this.rpcGateway.pushAgentMessage(sessionId, delivery),
            storeAgentMessage: (sessionId, delivery) => this.messageService.sendMessage(sessionId, {
                content: delivery.blocks,
                localId: delivery.messageId,
                // sentFrom 只写存量形状：跨会话行一直是 'cli'，而它**不承担语义**——
                // 「不进投递队列」现在由下面那行带下去的跨会话标注决定（判据见
                // shared 的 isQueueableUserSubmission 判据②，改这个取值弄不坏它）
                sentFrom: 'cli',
                // 来源身份交给 concept 去摊成 meta 形状（哪个键放 name、哪个放 id 不再在此决定）；
                // 它同时就是「这条不是待消费的用户提交」的判据点，messageService 也据此
                // 省掉向 CLI 房间的回灌（投递已经发生，别再回灌一次让目标 CLI 二次入队）
                origin: { fromName: delivery.fromName, fromSessionId: delivery.fromSessionId },
            }),
            // 初始名字（create_session 的 title）只写 mobi 侧，不走本类的 renameSession。
            // 那条路要多发一个 rename-session RPC 给会话进程，而此刻新会话的 RPC 还没装好
            // （它在 spawn 回执之后才注册）——必然撞空，且这里要的本来就是 mobi 侧的名字。
            // 先按 id 刷一次缓存：行是 CLI 连上来时建的，spawn 返回时通常已在缓存里，
            // 但这里不赌时序——刷新是便宜的，且 renameSession 找不到行会直接抛
            renameSession: async (sessionId, name) => {
                this.sessionCache.refreshSession(sessionId)
                await this.sessionCache.renameSession(sessionId, name)
            },
            waitUntilCanReceive: (sessionId, timeoutMs) => this.receiveReadiness.waitUntilCanReceive(sessionId, timeoutMs),
            canReceiveNow: (sessionId) => this.receiveReadiness.get(sessionId),
        })
        this.workspaceCache = new WorkspaceCache(store, this.eventPublisher)
        this.messageService = new MessageService(store, io, this.eventPublisher)
        this.rpcGateway = new RpcGateway(io, rpcRegistry)
        // socket 版实现已随 machine 通道删除（ticket-20）；缺省给无 bridge 的本地实现——
        // 非直调路径全可用，spawn 会报「bridge 未接线」（生产由 hubServer 注入带 bridge 的实例）
        this.executor = executor ?? new LocalExecutor(() => null)
        this.store = store
        this.rewindDeleteBounds = rewindDeleteBounds ?? new RewindDeleteBoundTracker()
        this.factsSink = {
            handleSessionAlive: (payload) => this.handleSessionAlive(payload),
            handleSessionEnd: (payload) => {
                this.sessionCache.handleSessionEnd(payload)
                // 进程没了，这条「此刻」的事实跟着作废（回到没定论，而不是留个 false，见 clear 说明）
                this.receiveReadiness.clear(payload.sid)
            },
            handleContextUsage: (payload) => this.sessionCache.handleContextUsage(payload),
            handleGoalStatus: (payload) => this.sessionCache.handleGoalStatus(payload),
            handleRunStarted: (payload) => this.sessionCache.handleRunStarted(payload),
            handleCacheStatus: (payload) => this.sessionCache.handleCacheStatus(payload),
            handleReceiveReadiness: (payload) => this.receiveReadiness.set(payload.sid, payload.canReceive),
        }
        this.warmupCache()
        this.inactivityTimer = setInterval(() => this.expireInactive(), 5_000)
    }

    stop(): void {
        if (this.inactivityTimer) {
            clearInterval(this.inactivityTimer)
            this.inactivityTimer = null
        }
    }

    subscribe(listener: SyncEventListener): () => void {
        return this.eventPublisher.subscribe(listener)
    }

    /** UI 命令发布入口（CLI socket handler 用）：统一走 handleRealtimeEvent 发布——
     *  未来加在它上面的横切关注点（缓存刷新等）不会绕过 ui-command */
    publishUiCommand(event: Extract<SyncEvent, { type: 'ui-command' }>): void {
        this.handleRealtimeEvent(event)
    }

    /** CLI 房间 new-message 广播出口（socket handler 经 deps 惰性取用）。
     *  过渡透传：信封构造权已收归 messageService 单一构造点，socket 侧 handler 只传参；
     *  消息受理 module（SessionMessageIntakeProcessor）落地后由其 publication 翻译直调 */
    emitCliNewMessage(...args: Parameters<MessageService['emitNewMessageToCli']>): void {
        this.messageService.emitNewMessageToCli(...args)
    }

    private resolveNamespace(event: SyncEvent): string | undefined {
        if (event.namespace) {
            return event.namespace
        }
        if ('sessionId' in event && event.sessionId) {
            return this.getSession(event.sessionId)?.namespace
        }
        // daemon-status 等无 sessionId 事件不带 namespace：广播层不过滤（全连接可见）
        return undefined
    }

    getSessions(): Session[] {
        return this.sessionCache.getSessions()
    }

    getSessionsByNamespace(namespace: string): Session[] {
        return this.sessionCache.getSessionsByNamespace(namespace)
    }

    getSession(sessionId: string): Session | undefined {
        return this.sessionCache.getSession(sessionId) ?? this.sessionCache.refreshSession(sessionId) ?? undefined
    }

    getSessionByNamespace(sessionId: string, namespace: string): Session | undefined {
        const session = this.sessionCache.getSessionByNamespace(sessionId, namespace)
            ?? this.sessionCache.refreshSession(sessionId)
        if (!session || session.namespace !== namespace) {
            return undefined
        }
        return session
    }

    resolveSessionAccess(
        sessionId: string,
        namespace: string
    ): { ok: true; sessionId: string; session: Session } | { ok: false; reason: 'not-found' | 'access-denied' } {
        return this.sessionCache.resolveSessionAccess(sessionId, namespace)
    }

    getActiveSessions(): Session[] {
        return this.sessionCache.getActiveSessions()
    }

    // ============ Agent 会话操作（B 类工具族）============
    // 实例见 `agentSessions` 字段

    // ============ 工作区（workspace entity）============

    getWorkspaces(namespace: string): Workspace[] {
        return this.workspaceCache.getWorkspaces(namespace)
    }

    getWorkspace(id: string): Workspace | undefined {
        return this.workspaceCache.getWorkspace(id)
    }

    createWorkspace(namespace: string, input: { name: string; folders: WorkspaceFolder[] }): Workspace {
        return this.workspaceCache.createWorkspace(namespace, input)
    }

    updateWorkspace(id: string, namespace: string, patch: { name?: string; folders?: WorkspaceFolder[] }): Workspace | null {
        return this.workspaceCache.updateWorkspace(id, namespace, patch)
    }

    deleteWorkspace(id: string, namespace: string): boolean {
        // 返回值 = 被解绑的 session ID 列表（null = 删除失败）；
        // 只对这些 id 刷新内存缓存，避免丢弃返回值的 O(namespace) 全量扫描
        const affected = this.workspaceCache.deleteWorkspace(id, namespace)
        if (affected === null) return false
        for (const sessionId of affected) {
            this.sessionCache.refreshSession(sessionId)
        }
        return true
    }

    getSessionsByWorkspace(namespace: string, workspaceId: string, cursor: number | null, limit?: number): WorkspaceSessionsResult {
        return this.store.sessions.getSessionsByWorkspace(namespace, workspaceId, cursor, limit)
    }

    getUnboundSessions(namespace: string, cursor: number | null, limit?: number): WorkspaceSessionsResult {
        return this.store.sessions.getUnboundSessions(namespace, cursor, limit)
    }

    getPinnedSessions(namespace: string, cursor: number | null, limit?: number): WorkspaceSessionsResult {
        return this.store.sessions.getPinnedSessions(namespace, cursor, limit)
    }

    /**
     * 置顶 / 取消置顶（纯展示维度分组，不改归属）。置顶态变化时刷新内存缓存并广播
     * session-updated，Web 端连带失效「置顶」「工作区」「最近」三个分组视图；
     * 幂等置顶（态未变）视为成功但不广播，避免无意义的 SSE 扰动。
     */
    setSessionPinned(sessionId: string, pinned: boolean, namespace: string): boolean {
        const result = this.store.sessions.setSessionPinned(sessionId, pinned, namespace)
        if (result === 'not_found') return false
        if (result === 'noop') return true
        const session = this.sessionCache.refreshSession(sessionId)
        if (session) {
            this.eventPublisher.emit({ type: 'session-updated', sessionId, data: session })
        }
        return true
    }

    /**
     * 归入工作区 / 解绑（移回「最近」）。workspaceId 须存在且同 namespace（store 层校验）。
     * 归属变化时刷新内存缓存并广播 session-updated，Web 端感知归属变化；
     * 幂等重归入（归属未变）视为成功但不广播，避免无意义的 SSE 扰动。
     */
    setSessionWorkspace(sessionId: string, workspaceId: string | null, namespace: string): boolean {
        const result = this.store.sessions.setSessionWorkspace(sessionId, workspaceId, namespace)
        if (result === 'not_found') return false
        if (result === 'noop') return true
        const session = this.sessionCache.refreshSession(sessionId)
        if (session) {
            this.eventPublisher.emit({ type: 'session-updated', sessionId, data: session })
        }
        return true
    }

    getMessagesPage(sessionId: string, options: { limit: number; beforeSeq: number | null }): {
        messages: DecryptedMessage[]
        page: {
            limit: number
            beforeSeq: number | null
            nextBeforeSeq: number | null
            hasMore: boolean
        }
    } {
        return this.messageService.getMessagesPage(sessionId, options)
    }

    getMessagesAfter(sessionId: string, options: { afterSeq: number; limit: number }): DecryptedMessage[] {
        return this.messageService.getMessagesAfter(sessionId, options)
    }

    getSidechainMessages(sessionId: string, parentToolUseId: string): DecryptedMessage[] {
        return this.messageService.getSidechainMessages(sessionId, parentToolUseId)
    }

    handleRealtimeEvent(event: SyncEvent): void {
        if (event.type === 'session-updated' && event.sessionId) {
            this.sessionCache.refreshSession(event.sessionId)
        } else if (event.type === 'message-received' && event.sessionId) {
            if (!this.getSession(event.sessionId)) {
                this.sessionCache.refreshSession(event.sessionId)
            }
        }

        this.eventPublisher.emit(event)
    }

    /**
     * 会话追踪同步钩子（ticket-18 Q8）：会话 socket 重连/心跳到达时，把会话行
     * metadata（hostPid + 当前 nativeSessionId）同步给 executor 追踪表——daemon
     * 重启后的补登与查重键刷新都从这里驱动。由 server 在 executor bridge 就绪
     * 后注入；未注入（daemon 单独跑、测试）时为 no-op。
     */
    private sessionTrackingSync: ((sid: string) => void) | null = null

    setSessionTrackingSync(fn: ((sid: string) => void) | null): void {
        this.sessionTrackingSync = fn
    }

    handleSessionAlive(payload: {
        sid: string
        time: number
        running?: boolean
        mode?: 'local' | 'remote'
        permissionMode?: PermissionMode
        model?: string | null
        effort?: EffortLevel
        outputStyle?: string
    }): void {
        // 追踪同步先行（补登/查重键刷新，fire-and-forget；失败不影响激活语义）
        try {
            this.sessionTrackingSync?.(payload.sid)
        } catch (error) {
            daemonLogger.debug('[SYNC] Session tracking sync failed:', error)
        }
        // 激活翻转入参快照：handleSessionAlive 同步更新 sessionCache，前后各读一次即可判定翻转
        const wasActive = this.sessionCache.getSession(payload.sid)?.active ?? false
        this.sessionCache.handleSessionAlive(payload)
        const isActive = this.sessionCache.getSession(payload.sid)?.active ?? false

        // 首次激活补拉 sdkMetadata：新会话 web 打开页面的首次 metadata GET 常早于 CLI 就绪，
        // 阻塞 RPC 失败留空后此前再无补拉信号（模型选择一直默认列表，刷新页面才恢复）。
        // CLI connect 时先重放注册全部 RPC handler 再发首个心跳（apiSession.ts），此点 RPC 必可达；
        // fire-and-forget 幂等：已提取过则 CAS 内容相等即静默，不会形成 refetch↔SSE 循环。
        if (!wasActive && isActive) {
            void this.refreshSDKMetadataBackground(payload.sid)
            // 待激活 fork 首条消息补投：入队广播落在 CLI 进房之前（web 发送侧先触发 resume
            // spawn），无补发路径会永久滞留 queued——激活翻转即 CLI 已在房内，此时补发必达
            this.messageService.redeliverQueued(payload.sid)
        }
    }

    /**
     * CLI 会话事实上报 sink（深化候选③）：socket 层校验/鉴权后的落库入口，单一声明源见
     * sync/sessionFacts.ts。session-alive 走本类编排版（激活翻转补拉 sdkMetadata），
     * 其余直连 sessionCache——此前这里是四个一行透传方法，逐个暴露在 SyncEngine 公共
     * interface 上；收敛为 sink 后新增事实不再扩门面面积。
     */
    readonly factsSink: SessionFactsSink

    /**
     * daemon 状态读数（ticket 205）：host 静态身份 + executor 运行时内存单例。
     * GET /api/daemon/status 与 daemon-status SSE 共用本投影，保证两通道同形。
     */
    getDaemonStatus(): {
        status: 'ok'
        host: { hostname: string; platform: string; displayName?: string; homeDir?: string }
        executor: ExecutorState | null
    } {
        const metadata = buildHostMetadata()
        return {
            status: 'ok',
            host: {
                hostname: metadata.host,
                platform: metadata.platform,
                ...(metadata.displayName !== undefined && { displayName: metadata.displayName }),
                ...(metadata.homeDir !== undefined && { homeDir: metadata.homeDir }),
            },
            executor: getExecutorState(),
        }
    }

    /** daemon 状态变化广播（发射点唯一：updateExecutorState 的写路径经此出网） */
    publishDaemonStatus(): void {
        this.eventPublisher.emit({
            type: 'daemon-status',
            data: this.getDaemonStatus(),
            namespace: this.daemonNamespace ?? undefined,
        })
    }

    /**
     * daemon 主 namespace 盖章（401 起 registerLocalMachine 的 machines 行写入退场，
     * 唯一残留职责）：daemon-status 事件无 sessionId 可解析，SSE 投递路由
     * （shouldSend namespace 匹配）靠它。
     */
    setDaemonNamespace(namespace: string): void {
        this.daemonNamespace = namespace
    }

    private expireInactive(): void {
        // 心跳过期 = 这个会话已经不在了。顺带抹掉挂在它生命周期上的进程内事实——CLI 被强杀
        // 或崩溃时不会上报 session-end，这里是「它没了」唯一的兜底判据，否则那些事实只增不减。
        // （machineCache 的 expireInactive 已随 ticket-25 多机分支收敛删除：machines 表恒本机，
        // 常驻 active、无过期语义）
        for (const sessionId of this.sessionCache.expireInactive()) {
            this.receiveReadiness.clear(sessionId)
        }
    }

    private warmupCache(): void {
        this.sessionCache.warmupCache()
        this.workspaceCache.warmupCache()
    }

    getOrCreateSession(tag: string, metadata: unknown, agentState: unknown, namespace: string, mode?: 'local' | 'remote', runtimeState?: unknown, workspaceId?: string | null): Session {
        return this.sessionCache.getOrCreateSession(tag, metadata, agentState, namespace, mode, runtimeState, workspaceId)
    }

    getSessionByClaudeSessionId(nativeSessionId: string, namespace: string): Session | null {
        return this.sessionCache.getSessionByClaudeSessionId(nativeSessionId, namespace)
    }

    async sendMessage(
        sessionId: string,
        payload: SendMessagePayload
    ): Promise<void> {
        await this.messageService.sendMessage(sessionId, payload)
    }

    /** 取消仍排队的消息（物理删除）；已 invoke 的不动 */
    cancelQueuedMessage(sessionId: string, localId: string): { cancelled: boolean; submitted: boolean } {
        return this.messageService.cancelQueuedMessage(sessionId, localId)
    }

    /** 通知 CLI 从内存队列移除排队消息（两阶段取消的 CLI 侧 RPC） */
    async cancelCliQueuedMessage(sessionId: string, localId: string): Promise<{ status: 'cancelled' | 'submitted' }> {
        return await this.rpcGateway.cancelCliQueuedMessage(sessionId, localId)
    }

    /** 通知 CLI 把仍排队的消息 steer（立即提交 SDK input stream） */
    async steerCliQueuedMessage(sessionId: string, localId: string): Promise<{ status: 'steered' | 'submitted' }> {
        return await this.rpcGateway.steerCliQueuedMessage(sessionId, localId)
    }

    /** 查询某 localId 消息的提交状态（非破坏性） */
    getMessageSubmitState(sessionId: string, localId: string): { exists: boolean, submitted: boolean } {
        return this.messageService.getMessageSubmitState(sessionId, localId)
    }

    async approvePermission(
        sessionId: string,
        requestId: string,
        mode?: PermissionMode,
        decision?: 'approved' | 'approved_for_session' | 'denied' | 'abort',
        answers?: PermissionAnswers,
        updatedPermissions?: PermissionUpdate[]
    ): Promise<void> {
        await this.rpcGateway.approvePermission(sessionId, requestId, mode, decision, answers, updatedPermissions)
    }

    async denyPermission(
        sessionId: string,
        requestId: string,
        decision?: 'approved' | 'approved_for_session' | 'denied' | 'abort',
        reason?: string
    ): Promise<void> {
        await this.rpcGateway.denyPermission(sessionId, requestId, decision, reason)
    }

    async abortSession(sessionId: string, stopKind: StopKind = DEFAULT_STOP_KIND): Promise<void> {
        // 先 RPC 后批删：CLI 已收到（受理）才成立，此刻才删 daemon 层排队消息——RPC 抛错
        // （CLI 离线/超时）则不删（安全方向：少删不误删，重试后仍有得删）。
        // 取舍：result 回拉竞态（CLI 中断 result 先于批删到达、pump 拉走 queued 消息）窗口
        // 极小可接受，且 CC 层消息由 cancelQueued 兜底。store 在本层持有（同 rewind 的
        // this.store.messages 用法），web 路由层不接触 store。
        await this.rpcGateway.abortSession(sessionId, stopKind)
        if (isCancelQueued(stopKind)) {
            this.store.messages.cancelAllQueuedMessages(sessionId)
        }
    }

    // 停止后台任务：转发 CLI 执行 + 受理成功即落 stopped 终态（跨重启后 CLI 侧任务已不存在、
    // SDK stopTask 静默 no-op，终态事件不会再有——不等事件，见 sessionCache.markBackgroundTaskStopped）
    async stopTask(sessionId: string, taskId: string): Promise<void> {
        await this.rpcGateway.stopTask(sessionId, taskId)
        const namespace = this.getSession(sessionId)?.namespace
        if (namespace) this.sessionCache.markBackgroundTaskStopped(sessionId, taskId, namespace)
    }

    // rewind 预检（Web → daemon → CLI RPC 转发）：锚点存在性 + rewindFiles(dryRun)，结果原样透传给 Web
    async rewindDryRun(sessionId: string, nativeId: string): Promise<unknown> {
        return await this.rpcGateway.rewindDryRun(sessionId, nativeId)
    }

    // rewind 执行（RPC 只做受理；CLI 闸门复检，结果经 socket 两段回报 → SSE 推 Web）
    async rewind(sessionId: string, nativeId: string, restoreFiles: boolean): Promise<unknown> {
        // 受理时点上界在 RPC 前采样：CLI handler 在回 ack 前要 await 文件回滚（大仓库可超
        // rpcGateway 30s 超时）——daemon 侧 RPC 抛错但 CLI 已受理并继续截断，迟到回报仍需上界防御，
        // 故结果未知（抛错）与受理成功两条路径都标记（fail-safe，M3）
        const maxSeq = this.store.messages.getMaxSeq(sessionId)
        let result: unknown
        try {
            result = await this.rpcGateway.rewind(sessionId, nativeId, restoreFiles)
        } catch (err) {
            this.rewindDeleteBounds.markAccepted(sessionId, maxSeq)
            throw err
        }
        // 受理成功 → 记录软删除上界（受理时点最大 seq，M3：迟到截断回报不得吞掉受理后新行）。
        // CLI socket handler 的 rewind-truncated 消费此上界收窄软删除范围；
        // CLI 干净拒绝（accepted:false）不标记——rewind 不会执行，无迟到回报可防御
        if (!result || typeof result !== 'object' || (result as { accepted?: unknown }).accepted !== false) {
            this.rewindDeleteBounds.markAccepted(sessionId, maxSeq)
        }
        return result
    }

    /**
     * fork 会话创建（web 点 fork → 建行 + 复制锚点 turn + 溯源消息，fork-session spec §5.1）。
     * namespace 访问协调留在引擎；锚点资格、复制范围与原子建行由 sessionFork module 收口。
     * 成功后 refreshSession 使 fork 行进缓存并发 session-added SSE，
     * web 列表即时出现「待激活」项。CLI 离线时点 fork 允许（复制是 daemon 侧动作）。
     */
    forkSession(sessionId: string, anchorNativeId: string, namespace: string): ForkSessionResult {
        const access = this.sessionCache.resolveSessionAccess(sessionId, namespace)
        if (!access.ok) {
            return { ok: false, reason: access.reason === 'access-denied' ? 'access-denied' : 'session-not-found' }
        }

        const result = this.store.sessionFork.createFork(sessionId, anchorNativeId)
        if (!result.ok) return result

        // fork 行进内存缓存（首次新增触发 session-added SSE）
        this.sessionCache.refreshSession(result.sessionId)

        return { ok: true, sessionId: result.sessionId }
    }

    /**
     * 手动休眠（dormancy spec §D.11）：CLI gate 自查 → 通过即走既有退出路径
     * （killSession = cleanupAndExit，与空闲超时退出同款）；阻塞则原样返回逐项
     * blocker 给 web toast。RPC 失败（超时/断连）按阻塞处理——不确定状态下宁可不休眠
     */
    async dormantSession(sessionId: string): Promise<{ ok: boolean; blockers?: string[] }> {
        // 幂等：会话已休眠（web 点击与 CLI 退出竞态窗口）直接成功，不问 gate 也
        // 不报「RPC handler not registered」这类与语义无关的错
        const session = this.sessionCache.getSession(sessionId) ?? this.sessionCache.refreshSession(sessionId)
        if (!session || !session.active) return { ok: true }
        // DB 终态已 archived（CLI 自行归档但 session-end 丢失）→ 幂等成功：再走 RPC
        // 必然 unreachable，还会把传输故障伪装成 "work in progress"（2026-09-30 事故）
        if (this.isArchivedInDb(sessionId)) return { ok: true }
        let check: { ok: boolean; blockers: string[] }
        try {
            check = await this.rpcGateway.dormancyCheck(sessionId)
        } catch (error) {
            // unreachable/timeout 是框架句子，不透给 web；分类语义 = 会话此刻不可达
            const { kind, message } = readRpcFailure(error)
            return { ok: false, blockers: [kind === 'other' ? message : 'Session is not reachable'] }
        }
        if (!check.ok) return check
        await this.archiveSession(sessionId)
        return { ok: true }
    }

    /** DB 里的生命周期终态：CLI 自行归档后 metadata 落 archived，daemon 缓存可能仍悬挂 active */
    private isArchivedInDb(sessionId: string): boolean {
        const session = this.sessionCache.getSession(sessionId) ?? this.sessionCache.refreshSession(sessionId)
        return session?.metadata?.lifecycleState === 'archived'
    }

    async archiveSession(sessionId: string): Promise<void> {
        // DB 终态已 archived → 跳过必然 unreachable 的 killSession，只补收尾
        // （handleSessionEnd 翻掉悬挂的 active）；RPC 失败由调用方收口，这里不吞
        if (!this.isArchivedInDb(sessionId)) {
            await this.rpcGateway.killSession(sessionId)
        }
        this.factsSink.handleSessionEnd?.({ sid: sessionId, time: Date.now() })
    }
    async switchSession(sessionId: string, to: 'remote' | 'local'): Promise<void> {
        await this.rpcGateway.switchSession(sessionId, to)
    }

    /**
     * 清除 session runtimeState 中的指定字段并推送 SSE 更新
     */
    clearRuntimeStateFields(sessionId: string, fields: string[], namespace: string): boolean {
        return this.sessionCache.clearRuntimeStateFields(sessionId, fields, namespace)
    }

    async renameSession(sessionId: string, name: string): Promise<void> {
        await this.sessionCache.renameSession(sessionId, name)
        // fire-and-forget：不 await RPC，避免阻塞 Web rename HTTP 响应。
        // CLI 忙时 RPC 可能等长达 30s（emitWithAck timeout），而 sessionCache 已更新，
        // 应让调用方立即拿到结果；RPC 失败（CLI 离线 / 会话未就绪）仅 warn 不影响本地一致性
        void this.rpcGateway.requestRename(sessionId, name).catch(error => {
            daemonLogger.warn(`[renameSession] 同步 CC 标题失败 (best-effort，忽略): ${(error as Error).message}`)
        })
    }

    async deleteSession(sessionId: string): Promise<void> {
        // 删除前读执行定位（删后 sessionCache 无行可查）；metadata 缺失不阻塞删除
        const located = (() => {
            try {
                return this.resolveSessionFileExecution(sessionId)
            } catch {
                return null
            }
        })()
        await this.sessionCache.deleteSession(sessionId)
        // best-effort 清理轮次快照引用（ADR 0008 refs 治理 / pending #87）：CLI 离线时
        // 引用暂留——不消费不转发，仅占本机 .git 空间，不影响正确性
        if (located) {
            void this.executor.clearTurnSnapshots(located.cwd, sessionId).catch((error) => {
                daemonLogger.warn(`[deleteSession] 清理轮次快照引用失败 (best-effort，忽略): ${(error as Error).message}`)
            })
        }
    }

    async applySessionConfig(
        sessionId: string,
        config: {
            permissionMode?: PermissionMode
            model?: string | null
            effort?: EffortLevel
        }
    ): Promise<void> {
        const result = await this.rpcGateway.requestSessionConfig(sessionId, config)
        if (!result || typeof result !== 'object') {
            throw new Error('Invalid response from session config RPC')
        }
        const obj = result as { applied?: { permissionMode?: Session['permissionMode']; model?: string | null; effort?: EffortLevel } }
        const applied = obj.applied
        if (!applied || typeof applied !== 'object') {
            throw new Error('Missing applied session config')
        }

        this.sessionCache.applySessionConfig(sessionId, applied)
    }

    /** 休眠会话配置暂存（dormancy spec §C.9）：只落 DB runtimeState，不做进程推送（无从推起）；
     *  唤醒 resume 时经 spawn 选项带回（resumeSession 组装处已读 runtimeState） */
    applyDormantSessionConfig(
        sessionId: string,
        config: {
            permissionMode?: PermissionMode
            model?: string | null
            effort?: EffortLevel
            outputStyle?: string
        }
    ): void {
        this.sessionCache.applyDormantConfig(sessionId, config)
    }

    /**
     * 切换 output style（/clear 语义）：受理转发 CLI，权威值由重启后 init 上报的
     * metadata.sdkMetadata.outputStyle 与 keep-alive 的 runtimeState.outputStyle 回流，此处不写 sessionCache。
     *
     * 结构化受理结果（深化候选⑥，rewind 先例——CLI 拒绝不走 throw，分层不再依赖
     * 错误文案子串匹配），路由据 confirmed 区分 409 / 502：
     * - confirmed: true = CLI 明确回答（accepted:false 业务拒绝，或 handler throw 的
     *   {error} 包装——受理段同步无 await，throw 即未受理），副作用确定未发生
     * - confirmed: false = RPC 层异常（超时 / 断连 / 响应畸形），CLI 可能已受理并重启，
     *   副作用未知（路由 502 + accepted:'unknown'，引导刷新确认而非盲目重试——重试 =
     *   再触发一次 /clear 多丢一轮上下文）
     */
    async switchOutputStyle(sessionId: string, style: string): Promise<OutputStyleSwitchOutcome> {
        let result: unknown
        try {
            result = await this.rpcGateway.switchOutputStyle(sessionId, style)
        } catch (error) {
            return {
                accepted: false,
                reason: 'output style switch unconfirmed',
                confirmed: false,
                cause: error instanceof Error ? error.message : String(error),
            }
        }
        if (result && typeof result === 'object' && (result as { accepted?: unknown }).accepted === true) {
            return { accepted: true }
        }
        if (result && typeof result === 'object' && (result as { accepted?: unknown }).accepted === false) {
            // CLI 结构化拒绝（RpcAcceptResult）：副作用确定未发生
            const reason = (result as { reason?: unknown }).reason
            return {
                accepted: false,
                reason: typeof reason === 'string' && reason.length > 0 ? reason : 'output style switch rejected',
                confirmed: true,
            }
        }
        // handler throw 的 {error} 包装（Method not found 等）：受理段同步，throw 即未受理
        const rpcError = typeof (result as { error?: unknown } | null)?.error === 'string'
            ? (result as { error: string }).error
            : null
        return {
            accepted: false,
            reason: rpcError ?? 'Output style switch was not accepted',
            confirmed: rpcError !== null,
        }
    }

    /** executor 就绪标志接线（见 executorReady 字段说明）：bridge 注入时调用，幂等 */
    markExecutorReady(): void {
        this.executorReady = true
    }

    isExecutorReady(): boolean {
        return this.executorReady
    }

    async spawnSession(
        directory: string,
        options: SpawnSessionOptions = {},
    ): Promise<{ type: 'success'; sessionId: string } | { type: 'error'; message: string }> {
        const result = await this.executor.spawnSession(directory, options)
        // Web 新会话路径无 resume 目标，already-running 不可达；防御性按错误处理
        if (isUnexpectedAlreadyRunning(result)) {
            return { type: 'error', message: UNEXPECTED_ALREADY_RUNNING }
        }
        if (result.type === 'error') {
            // 传输分类是 daemon 内部的说法（给 agent 的失败翻译用，见 rpcFailure），
            // 不进 HTTP body：Web 只读 message，多带一个字段等于悄悄改了一处对外契约
            return { type: 'error', message: result.message }
        }
        return result
    }

    /**
     * fork 行激活失败的 daemon 侧标记（spec §5.3「CLI 离线 / 机器关机」场景：CLI 进程内的
     * forkError 上报通道不可达，错误态由 daemon 直接落档）。仅 forkFrom 在场的行生效；
     * best-effort，写失败仅 warn（下次激活重试路径会重新标记）。
     */
    private markForkActivationErrorIfPending(sessionId: string, code: string, detail?: string): void {
        const session = this.getSession(sessionId)
        if (!session?.metadata?.forkFrom) return
        const ok = this.store.sessionFork.markForkActivationError(sessionId, code, detail)
        if (!ok) {
            daemonLogger.warn(`[forkSession] forkError 落档放弃（并发竞争或会话消失）: ${sessionId}`)
        }
    }

    /**
     * 休眠会话唤醒（dormancy spec §B）：非活跃会话入队消息后 fire-and-forget 触发
     * resume spawn（与 fork 激活同管线）。防重入：同一会话只允许一个在途 spawn——
     * 短窗口多条消息只触发一次，唤醒失败（无机器在线/spawn 失败）时在途即释放，
     * 后续消息或手动唤醒可重试；消息不因唤醒失败丢失（queued 已落库，上线后
     * handleSessionAlive → redeliverQueued 补投）。
     */
    wakeSession(sessionId: string): void {
        const session = this.sessionCache.getSession(sessionId) ?? this.sessionCache.refreshSession(sessionId)
        if (!session || session.active) return
        if (this.wakeInFlight.has(sessionId)) return
        this.wakeInFlight.add(sessionId)
        void this.resumeSession(sessionId, session.namespace)
            // resumeSession 的 RPC 层（spawn/ack 超时）会 throw 而非返回 error result；
            // 唤醒是 fire-and-forget，异常必须就地消化——unhandled rejection 在 Bun 下
            // 默认终止进程（= 整个 daemon 下线），且对休眠会话发消息即可触发
            .catch((error) => {
                daemonLogger.warn(`[dormancy] wakeSession spawn failed (session=${sessionId}): ${error instanceof Error ? error.message : String(error)}`)
            })
            .finally(() => {
                this.wakeInFlight.delete(sessionId)
            })
    }

    async resumeSession(sessionId: string, namespace: string): Promise<ResumeSessionResult> {
        const access = this.sessionCache.resolveSessionAccess(sessionId, namespace)
        if (!access.ok) {
            return {
                type: 'error',
                message: access.reason === 'access-denied' ? 'Session access denied' : 'Session not found',
                code: access.reason === 'access-denied' ? 'access_denied' : 'session_not_found'
            }
        }

        const session = access.session
        if (session.active) {
            return { type: 'success', sessionId: access.sessionId }
        }

        const metadata = session.metadata
        if (!metadata || typeof metadata.path !== 'string') {
            return { type: 'error', message: 'Session metadata missing path', code: 'resume_unavailable' }
        }

        // Mobi 当前仅支持 Claude
        // nativeSessionId 可能为空（会话创建后未发送消息就退出），
        // 此时 fallback 为新会话而非 resume
        const resumeToken = metadata.nativeSessionId

        // 单机世界：executor（同进程 spawn 管线）就绪即可 resume——不再有「挑机器/
        // 匹配 metadata.machineId|host」这一层（machine 概念移除，ticket 201）
        if (!this.isExecutorReady()) {
            // fork 行：executor 未就绪也激活不了——daemon 侧落 forkError 错误态（spec §5.3）
            this.markForkActivationErrorIfPending(sessionId, 'activation-failed', 'executor not ready')
            return { type: 'error', message: 'Executor not ready', code: 'executor_not_ready' }
        }

        const spawnResult = await this.executor.spawnSession(
            metadata.path,
            {   // Mobi 当前仅支持 Claude（agent 缺省）；resume 无 sessionType/worktreeName/workspaceId
                model: session.runtimeState?.model ?? undefined,
                permissionMode: session.permissionMode,
                resumeSessionId: resumeToken,
                effort: session.runtimeState?.effort ?? undefined,
                outputStyle: session.runtimeState?.outputStyle ?? undefined,
            }
        )

        if (spawnResult.type === 'already-running') {
            // 唤醒去重（.scratch/wake-dedup）：executor 报告已有活 child 在 resume 该目标，
            // 未 spawn 新进程。旧进程断连中正无限重连（≤5s 间隔），恢复交给其重连 +
            // web 终端 create 重试 / handleSessionAlive 补投收敛——daemon 零等待：不得落到
            // waitForSessionActive，否则断连场景（重连遥遥无期）会干等满 15s
            return { type: 'success', sessionId: access.sessionId }
        }

        if (spawnResult.type !== 'success') {
            this.markForkActivationErrorIfPending(sessionId, 'activation-failed', spawnResult.message)
            return { type: 'error', message: spawnResult.message, code: 'resume_failed' }
        }

        const becameActive = await this.waitForSessionActive(spawnResult.sessionId)
        if (!becameActive) {
            this.markForkActivationErrorIfPending(sessionId, 'activation-failed', 'session failed to become active')
            return { type: 'error', message: 'Session failed to become active', code: 'resume_failed' }
        }

        if (spawnResult.sessionId !== access.sessionId) {
            try {
                await this.sessionCache.mergeSessions(access.sessionId, spawnResult.sessionId, namespace)
            } catch (error) {
                const message = error instanceof Error ? error.message : 'Failed to merge resumed session'
                return { type: 'error', message, code: 'resume_failed' }
            }
        }

        return { type: 'success', sessionId: spawnResult.sessionId }
    }

    async waitForSessionActive(sessionId: string, timeoutMs: number = 15_000): Promise<boolean> {
        const start = Date.now()
        while (Date.now() - start < timeoutMs) {
            const session = this.getSession(sessionId)
            if (session?.active) {
                return true
            }
            await new Promise((resolve) => setTimeout(resolve, 250))
        }
        return false
    }

    async checkPathsExist(paths: string[]): Promise<Record<string, boolean>> {
        return await this.executor.checkPathsExist(paths)
    }

    /**
     * 会话文件 RPC 的执行定位（ADR 0006）：session 寻址、本机执行，无条件单路径。
     * 文件/路径类 RPC 不再经会话进程——会话进程活不活不影响可达性（休眠特性的
     * 「冷可读」地基）。cwd 取会话工作目录，缺失显式报错，**不回退 session
     * socket**——双执行路径正是本决策要消灭的东西。save-file 亦 machine 化
     * （dormancy：冷编辑器自动保存不唤醒；写边界由 daemon 注入 cwd 锚定，不再依赖
     * daemon 进程自身 cwd）。machineId 入参已随 machine 概念移除退场
     * （remove-machine 302：本地实现忽略，空串占位，602 形参收窄时删）。
     */
    private resolveSessionFileExecution(sessionId: string): { cwd: string } {
        const session = this.sessionCache.getSession(sessionId) ?? this.sessionCache.refreshSession(sessionId)
        if (!session) {
            throw new Error(`Session not found: ${sessionId}`)
        }
        // metadata 已是 MetadataSchema 的解析产物（sessionCache safeParse），
        // path 类型由 schema 保证，无需再 cast + typeof 校验
        const cwd = session.metadata?.path
        if (!cwd) {
            throw new Error(`Session ${sessionId} metadata is missing cwd — file RPC cannot be routed (see ADR 0006)`)
        }
        return { cwd }
    }

    async readFileMeta(sessionId: string, path: string): Promise<RpcReadFileMetaResponse> {
        const { cwd } = this.resolveSessionFileExecution(sessionId)
        return await this.executor.hostReadFileMeta(cwd, path)
    }

    async readFileRange(sessionId: string, path: string, offset: number, length: number): Promise<RpcReadFileRangeResponse> {
        const { cwd } = this.resolveSessionFileExecution(sessionId)
        return await this.executor.hostReadFileRange(cwd, path, offset, length)
    }

    async saveFile(sessionId: string, path: string, content: Uint8Array, baseEtag: string): Promise<RpcSaveFileResponse> {
        const { cwd } = this.resolveSessionFileExecution(sessionId)
        return await this.executor.hostSaveFile(cwd, path, content, baseEtag)
    }

    async searchSessionFiles(sessionId: string, query: string, type?: 'file' | 'directory'): Promise<RpcListDirectoryResponse> {
        const { cwd } = this.resolveSessionFileExecution(sessionId)
        return await this.executor.hostSearchFiles(cwd, query, type)
    }

    async listSessionDirectory(sessionId: string, path: string, prefix?: string): Promise<RpcListDirectoryResponse> {
        const { cwd } = this.resolveSessionFileExecution(sessionId)
        return await this.executor.hostListSessionDirectory(cwd, path, prefix)
    }

    async listHostDirectory(path: string, homeDir: string): Promise<RpcListDirectoryResponse> {
        return await this.executor.listHostDirectory(path, homeDir)
    }

    async hostUploadFileRange(
        cwd: string,
        filename: string,
        path: string | undefined,
        offset: number,
        content: Uint8Array,
        totalSize?: number,
    ): Promise<RpcWriteFileRangeResponse> {
        return await this.executor.hostUploadFileRange(cwd, filename, path, offset, content, totalSize)
    }

    async hostDeleteUpload(cwd: string, path: string): Promise<RpcDeleteUploadResponse> {
        return await this.executor.hostDeleteUpload(cwd, path)
    }

    /** 同 path 原子替换 machine 上的已上传文件 */
    async hostReplaceUpload(cwd: string, path: string, content: Uint8Array): Promise<RpcReplaceUploadResponse> {
        return await this.executor.hostReplaceUpload(cwd, path, content)
    }

    /** machine 通道读文件元信息（跨会话存活的静态资源读取，见 ExecutorHost.hostReadFileMeta） */
    async hostReadFileMeta(cwd: string, path: string): Promise<RpcReadFileMetaResponse> {
        return await this.executor.hostReadFileMeta(cwd, path)
    }

    // ── 审查重写 v2 六方法（DiffTarget 统一模型，同 resolveSessionFileExecution 寻址）──
    async gitReviewOverview(sessionId: string): Promise<ReviewOverview | { success: false; error: string }> {
        const { cwd } = this.resolveSessionFileExecution(sessionId)
        return await this.executor.hostGitReviewOverview(cwd, sessionId)
    }

    async gitReviewFiles(sessionId: string, target: DiffTarget): Promise<ReviewFilesResult | { success: false; error: string }> {
        const { cwd } = this.resolveSessionFileExecution(sessionId)
        return await this.executor.hostGitReviewFiles(cwd, sessionId, target)
    }

    async gitReviewDiff(sessionId: string, target: DiffTarget, path: string): Promise<ReviewPatchResult | { success: false; error: string }> {
        const { cwd } = this.resolveSessionFileExecution(sessionId)
        return await this.executor.hostGitReviewDiff(cwd, sessionId, target, path)
    }

    async gitReviewContents(sessionId: string, target: DiffTarget, path: string): Promise<ReviewContentsResult | { success: false; error: string }> {
        const { cwd } = this.resolveSessionFileExecution(sessionId)
        return await this.executor.hostGitReviewContents(cwd, sessionId, target, path)
    }

    async gitReviewCommits(sessionId: string, cursor?: string): Promise<ReviewCommitsResult | { success: false; error: string }> {
        const { cwd } = this.resolveSessionFileExecution(sessionId)
        return await this.executor.hostGitReviewCommits(cwd, cursor)
    }

    async gitReviewInit(sessionId: string): Promise<ReviewActionResult | { success: false; error: string }> {
        const { cwd } = this.resolveSessionFileExecution(sessionId)
        return await this.executor.hostGitReviewInit(cwd)
    }

    /** machine 通道分片读文件（同上） */
    async hostReadFileRange(cwd: string, path: string, offset: number, length: number): Promise<RpcReadFileRangeResponse> {
        return await this.executor.hostReadFileRange(cwd, path, offset, length)
    }

    async hostSearchFiles(cwd: string, query: string, type?: 'file' | 'directory'): Promise<RpcListDirectoryResponse> {
        return await this.executor.hostSearchFiles(cwd, query, type)
    }

    async hostListSessionDirectory(cwd: string, path: string, prefix?: string): Promise<RpcListDirectoryResponse> {
        return await this.executor.hostListSessionDirectory(cwd, path, prefix)
    }

    async hostRefreshMetadata(cwd: string): Promise<RpcRefreshMetadataResponse> {
        return await this.executor.hostRefreshMetadata(cwd)
    }

    // web 工具配置读写（纯透传，daemon 不存任何 web 工具状态）
    async getWebToolsConfig(): Promise<RpcGetWebToolsConfigResponse> {
        return await this.executor.getWebToolsConfig()
    }

    async setWebToolsConfig(config: unknown): Promise<RpcSetWebToolsConfigResponse> {
        return await this.executor.setWebToolsConfig(config)
    }

    /** Web 工具 provider 验证连接（透传 executor RPC；草稿凭据优先，不落盘） */
    async verifyWebToolsProvider(
        providerId: string,
        credentials?: Record<string, string>,
    ): Promise<RpcVerifyWebToolsProviderResponse> {
        return await this.executor.verifyWebToolsProvider(providerId, credentials)
    }

    async uploadFileRange(
        sessionId: string,
        filename: string,
        path: string | undefined,
        offset: number,
        content: Uint8Array,
        totalSize?: number,
    ): Promise<RpcWriteFileRangeResponse> {
        const { cwd } = this.resolveSessionFileExecution(sessionId)
        return await this.executor.hostUploadFileRange(cwd, filename, path, offset, content, totalSize)
    }

    async deleteUploadFile(sessionId: string, path: string): Promise<RpcDeleteUploadResponse> {
        const { cwd } = this.resolveSessionFileExecution(sessionId)
        return await this.executor.hostDeleteUpload(cwd, path)
    }

    /** 同 path 原子替换会话 machine 上的已上传文件（「编辑已有上传」场景） */
    async replaceUploadFile(sessionId: string, path: string, content: Uint8Array): Promise<RpcReplaceUploadResponse> {
        const { cwd } = this.resolveSessionFileExecution(sessionId)
        return await this.executor.hostReplaceUpload(cwd, path, content)
    }

    async refreshMetadata(sessionId: string): Promise<RpcRefreshMetadataResponse> {
        return await this.rpcGateway.refreshMetadata(sessionId)
    }

    updateSDKMetadata(sessionId: string, metadata: SDKMetadata): void {
        this.sessionCache.updateSDKMetadata(sessionId, metadata)
    }

    // 后台刷新并发去重：同一 session 同时只跑一个 refreshMetadata RPC。
    // 注意——这只是并发闸，不负责打破 refetch↔SSE 循环；循环终止完全靠
    // sessionCache.applyRefreshedSDKMetadata 的「内容相等则不写不发」语义。删除那个
    // 相等检查会重新引入无限循环，不要被此 Set 的存在误导。
    private readonly refreshingMetadata = new Set<string>()

    /**
     * 后台刷新 sdkMetadata（SWR 配套）。
     * 由 metadata 端点在命中缓存时 fire-and-forget 调用：
     * - 同 session 并发去重（Set）
     * - 交给 sessionCache.applyRefreshedSDKMetadata 做 CAS：仅当内容变化才写库 + 发 SSE
     * - 会话不活跃 / RPC 失败静默（web 仍用缓存，不退化）
     */
    async refreshSDKMetadataBackground(sessionId: string): Promise<void> {
        if (this.refreshingMetadata.has(sessionId)) return
        // CLI 不在线时 RPC 必失败/超时，且会占去重槽位直到超时——提前跳过省资源（web 仍用缓存）
        const sessionBefore = this.sessionCache.getSession(sessionId)
        if (!sessionBefore?.active) return
        // 快照发起时的 metadataVersion，apply 时比对——RPC 期间若有别处写入（version 变），放弃 stale 结果
        const versionBefore = sessionBefore.metadataVersion
        this.refreshingMetadata.add(sessionId)
        try {
            const result = await this.refreshMetadata(sessionId)
            if (!result.success || !result.metadata) return
            this.sessionCache.applyRefreshedSDKMetadata(sessionId, result.metadata, versionBefore)
        } catch {
            // RPC 失败 — 静默，web 继续用缓存
        } finally {
            this.refreshingMetadata.delete(sessionId)
        }
    }
}

/**
 * 工作区归属校验（web/cli 路由共用判定，收口在 engine 层避免各路由内联漂移）：
 * - not_found：工作区不存在或跨 namespace（调用方一般映射 404）
 * - ok：可归属。单机语义（ticket-25）下 workspace 与会话/请求恒同机，机器匹配判据
 *   随多机分支收敛删除，这里只判存在性与 namespace。
 */
export function checkWorkspaceAssignable(
    engine: SyncEngine,
    workspaceId: string,
    namespace: string
): 'ok' | 'not_found' {
    const workspace = engine.getWorkspace(workspaceId)
    if (!workspace || workspace.namespace !== namespace) {
        return 'not_found'
    }
    return 'ok'
}
