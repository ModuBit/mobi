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

import type { ContextUsage, DecryptedMessage, EffortLevel, GoalStatus, PermissionMode, SDKMetadata, Session, SyncEvent } from '@mobi/shared/types'
import type { PermissionUpdate, Project, ProjectFolder } from '@mobi/shared'
import type { Server } from 'socket.io'
import type { Store } from '../store'
import type { ProjectSessionsResult } from '../store/sessions'
import { RewindDeleteBoundTracker } from './rewindDeleteBoundTracker'
import type { RpcRegistry } from '../socket/rpcRegistry'
import type { SSEManager } from '../sse/sseManager'
import { EventPublisher, type SyncEventListener } from './eventPublisher'
import { MachineCache, type Machine } from './machineCache'
import { MessageService } from './messageService'
import { ProjectCache } from './projectCache'
import {
    RpcGateway,
    type RpcCommandResponse,
    type RpcDeleteUploadResponse,
    type RpcGetWebToolsConfigResponse,
    type RpcListDirectoryResponse,
    type RpcReadFileMetaResponse,
    type RpcReadFileRangeResponse,
    type RpcRefreshMetadataResponse,
    type RpcSaveFileResponse,
    type RpcSetWebToolsConfigResponse,
    type RpcVerifyWebToolsProviderResponse,
    type RpcWriteFileRangeResponse
} from './rpcGateway'
import { SessionCache } from './sessionCache'
import { hubLogger } from '../logger'

export type { Session, SyncEvent } from '@mobi/shared/types'
export type { Machine } from './machineCache'
export type { SyncEventListener } from './eventPublisher'
export type {
    RpcCommandResponse,
    RpcDeleteUploadResponse,
    RpcGetWebToolsConfigResponse,
    RpcListDirectoryResponse,
    RpcPathExistsResponse,
    RpcReadFileMetaResponse,
    RpcReadFileRangeResponse,
    RpcRefreshMetadataResponse,
    RpcSaveFileResponse,
    RpcSetWebToolsConfigResponse,
    RpcVerifyWebToolsProviderResponse,
    RpcWriteFileRangeResponse
} from './rpcGateway'

export type ResumeSessionResult =
    | { type: 'success'; sessionId: string }
    | { type: 'error'; message: string; code: 'session_not_found' | 'access_denied' | 'no_machine_online' | 'resume_unavailable' | 'resume_failed' }

export class SyncEngine {
    private readonly eventPublisher: EventPublisher
    private readonly sessionCache: SessionCache
    private readonly machineCache: MachineCache
    private readonly projectCache: ProjectCache
    private readonly messageService: MessageService
    private readonly rpcGateway: RpcGateway
    private readonly store: Store
    /** rewind 软删除上界（受理时写 / 截断回报消费；与 CLI socket handler 共用实例，index.ts 注入） */
    private readonly rewindDeleteBounds: RewindDeleteBoundTracker
    private inactivityTimer: NodeJS.Timeout | null = null

    constructor(
        store: Store,
        io: Server,
        rpcRegistry: RpcRegistry,
        sseManager: SSEManager,
        rewindDeleteBounds?: RewindDeleteBoundTracker
    ) {
        this.eventPublisher = new EventPublisher(sseManager, (event) => this.resolveNamespace(event))
        this.sessionCache = new SessionCache(store, this.eventPublisher)
        this.machineCache = new MachineCache(store, this.eventPublisher)
        this.projectCache = new ProjectCache(store, this.eventPublisher)
        this.messageService = new MessageService(store, io, this.eventPublisher)
        this.rpcGateway = new RpcGateway(io, rpcRegistry)
        this.store = store
        this.rewindDeleteBounds = rewindDeleteBounds ?? new RewindDeleteBoundTracker()
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

    private resolveNamespace(event: SyncEvent): string | undefined {
        if (event.namespace) {
            return event.namespace
        }
        if ('sessionId' in event) {
            return this.getSession(event.sessionId)?.namespace
        }
        if ('machineId' in event) {
            return this.machineCache.getMachine(event.machineId)?.namespace
        }
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

    getMachines(): Machine[] {
        return this.machineCache.getMachines()
    }

    getMachinesByNamespace(namespace: string): Machine[] {
        return this.machineCache.getMachinesByNamespace(namespace)
    }

    getMachine(machineId: string): Machine | undefined {
        return this.machineCache.getMachine(machineId)
    }

    getMachineByNamespace(machineId: string, namespace: string): Machine | undefined {
        return this.machineCache.getMachineByNamespace(machineId, namespace)
    }

    getOnlineMachines(): Machine[] {
        return this.machineCache.getOnlineMachines()
    }

    getOnlineMachinesByNamespace(namespace: string): Machine[] {
        return this.machineCache.getOnlineMachinesByNamespace(namespace)
    }

    // ============ 项目（project entity）============

    getProjects(namespace: string): Project[] {
        return this.projectCache.getProjects(namespace)
    }

    getProject(id: string): Project | undefined {
        return this.projectCache.getProject(id)
    }

    createProject(namespace: string, input: { machineId: string; name: string; folders: ProjectFolder[] }): Project {
        return this.projectCache.createProject(namespace, input)
    }

    updateProject(id: string, namespace: string, patch: { name?: string; folders?: ProjectFolder[] }): Project | null {
        return this.projectCache.updateProject(id, namespace, patch)
    }

    deleteProject(id: string, namespace: string): boolean {
        // 返回值 = 被解绑的 session ID 列表（null = 删除失败）；
        // 只对这些 id 刷新内存缓存，避免丢弃返回值的 O(namespace) 全量扫描
        const affected = this.projectCache.deleteProject(id, namespace)
        if (affected === null) return false
        for (const sessionId of affected) {
            this.sessionCache.refreshSession(sessionId)
        }
        return true
    }

    getSessionsByProject(namespace: string, projectId: string, cursor: number | null, limit?: number): ProjectSessionsResult {
        return this.store.sessions.getSessionsByProject(namespace, projectId, cursor, limit)
    }

    getUnboundSessions(namespace: string, cursor: number | null, limit?: number): ProjectSessionsResult {
        return this.store.sessions.getUnboundSessions(namespace, cursor, limit)
    }

    getPinnedSessions(namespace: string, cursor: number | null, limit?: number): ProjectSessionsResult {
        return this.store.sessions.getPinnedSessions(namespace, cursor, limit)
    }

    /**
     * 置顶 / 取消置顶（纯展示维度分组，不改归属）。置顶态变化时刷新内存缓存并广播
     * session-updated，Web 端连带失效「置顶」「项目」「最近」三个分组视图；
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
     * 归入项目 / 解绑（移回「最近」）。projectId 须存在且同 namespace（store 层校验）。
     * 归属变化时刷新内存缓存并广播 session-updated，Web 端感知归属变化；
     * 幂等重归入（归属未变）视为成功但不广播，避免无意义的 SSE 扰动。
     */
    setSessionProject(sessionId: string, projectId: string | null, namespace: string): boolean {
        const result = this.store.sessions.setSessionProject(sessionId, projectId, namespace)
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
        } else if (event.type === 'machine-updated' && event.machineId) {
            this.machineCache.refreshMachine(event.machineId)
        } else if (event.type === 'message-received' && event.sessionId) {
            if (!this.getSession(event.sessionId)) {
                this.sessionCache.refreshSession(event.sessionId)
            }
        }

        this.eventPublisher.emit(event)
    }

    handleSessionAlive(payload: {
        sid: string
        time: number
        running?: boolean
        mode?: 'local' | 'remote'
        permissionMode?: PermissionMode
        model?: string | null
        effort?: EffortLevel
    }): void {
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
        }
    }

    handleSessionEnd(payload: { sid: string; time: number }): void {
        this.sessionCache.handleSessionEnd(payload)
    }

    handleContextUsage(payload: { sid: string; contextUsage: ContextUsage | null }): void {
        this.sessionCache.handleContextUsage(payload)
    }

    handleGoalStatus(payload: { sid: string; goalStatus: GoalStatus | null }): void {
        this.sessionCache.handleGoalStatus(payload)
    }

    handleRunStarted(payload: { sid: string; runStartedAt: number }): void {
        this.sessionCache.handleRunStarted(payload)
    }

    handleMachineAlive(payload: { machineId: string; time: number }): void {
        this.machineCache.handleMachineAlive(payload)
    }

    private expireInactive(): void {
        this.sessionCache.expireInactive()
        this.machineCache.expireInactive()
    }

    private warmupCache(): void {
        this.sessionCache.warmupCache()
        this.machineCache.warmupCache()
        this.projectCache.warmupCache()
    }

    getOrCreateSession(tag: string, metadata: unknown, agentState: unknown, namespace: string, mode?: 'local' | 'remote', runtimeState?: unknown, projectId?: string | null): Session {
        return this.sessionCache.getOrCreateSession(tag, metadata, agentState, namespace, mode, runtimeState, projectId)
    }

    getSessionByClaudeSessionId(nativeSessionId: string, namespace: string): Session | null {
        return this.sessionCache.getSessionByClaudeSessionId(nativeSessionId, namespace)
    }

    getOrCreateMachine(id: string, metadata: unknown, runnerState: unknown, namespace: string): Machine {
        return this.machineCache.getOrCreateMachine(id, metadata, runnerState, namespace)
    }

    async sendMessage(
        sessionId: string,
        payload: {
            /** 内容三形态之一（string / 单 block / block 数组，或旧平铺对象），透传给 messageService 归一 */
            content: unknown
            localId?: string | null
            sentFrom?: 'webapp' | 'cli'
        }
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
        answers?: Record<string, string | string[]> | Record<string, { answers: string[] }>,
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

    async abortSession(sessionId: string): Promise<void> {
        await this.rpcGateway.abortSession(sessionId)
    }

    // 停止后台任务
    async stopTask(sessionId: string, taskId: string): Promise<void> {
        await this.rpcGateway.stopTask(sessionId, taskId)
    }

    // rewind 预检（Web → Hub → CLI RPC 转发）：锚点存在性 + rewindFiles(dryRun)，结果原样透传给 Web
    async rewindDryRun(sessionId: string, nativeId: string): Promise<unknown> {
        return await this.rpcGateway.rewindDryRun(sessionId, nativeId)
    }

    // rewind 执行（RPC 只做受理；CLI 闸门复检，结果经 socket 两段回报 → SSE 推 Web）
    async rewind(sessionId: string, nativeId: string, restoreFiles: boolean): Promise<unknown> {
        // 受理时点上界在 RPC 前采样：CLI handler 在回 ack 前要 await 文件回滚（大仓库可超
        // rpcGateway 30s 超时）——hub 侧 RPC 抛错但 CLI 已受理并继续截断，迟到回报仍需上界防御，
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
        // CLI socket handler 的 rewound-truncated 消费此上界收窄软删除范围；
        // CLI 干净拒绝（accepted:false）不标记——rewind 不会执行，无迟到回报可防御
        if (!result || typeof result !== 'object' || (result as { accepted?: unknown }).accepted !== false) {
            this.rewindDeleteBounds.markAccepted(sessionId, maxSeq)
        }
        return result
    }

    async archiveSession(sessionId: string): Promise<void> {
        await this.rpcGateway.killSession(sessionId)
        this.handleSessionEnd({ sid: sessionId, time: Date.now() })
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
            hubLogger.warn(`[renameSession] 同步 CC 标题失败 (best-effort，忽略): ${(error as Error).message}`)
        })
    }

    async deleteSession(sessionId: string): Promise<void> {
        await this.sessionCache.deleteSession(sessionId)
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

    async spawnSession(
        machineId: string,
        directory: string,
        agent: 'claude' = 'claude',  // Mobi 当前仅支持 Claude
        model?: string,
        permissionMode?: PermissionMode,
        sessionType?: 'simple' | 'worktree',
        worktreeName?: string,
        resumeSessionId?: string,
        effort?: EffortLevel,
        projectId?: string,
    ): Promise<{ type: 'success'; sessionId: string } | { type: 'error'; message: string }> {
        return await this.rpcGateway.spawnSession(
            machineId, directory, agent, model, permissionMode,
            sessionType, worktreeName, resumeSessionId, effort, projectId
        )
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

        const onlineMachines = this.machineCache.getOnlineMachinesByNamespace(namespace)
        if (onlineMachines.length === 0) {
            return { type: 'error', message: 'No machine online', code: 'no_machine_online' }
        }

        const targetMachine = (() => {
            if (metadata.machineId) {
                const exact = onlineMachines.find((machine) => machine.id === metadata.machineId)
                if (exact) return exact
            }
            if (metadata.host) {
                const hostMatch = onlineMachines.find((machine) => machine.metadata?.host === metadata.host)
                if (hostMatch) return hostMatch
            }
            return null
        })()

        if (!targetMachine) {
            return { type: 'error', message: 'No machine online', code: 'no_machine_online' }
        }

        const spawnResult = await this.rpcGateway.spawnSession(
            targetMachine.id,
            metadata.path,
            'claude',  // Mobi 当前仅支持 Claude
            session.runtimeState?.model ?? undefined,
            session.permissionMode,
            undefined,
            undefined,
            resumeToken,
            session.runtimeState?.effort ?? undefined
        )

        if (spawnResult.type !== 'success') {
            return { type: 'error', message: spawnResult.message, code: 'resume_failed' }
        }

        const becameActive = await this.waitForSessionActive(spawnResult.sessionId)
        if (!becameActive) {
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

    async checkPathsExist(machineId: string, paths: string[]): Promise<Record<string, boolean>> {
        return await this.rpcGateway.checkPathsExist(machineId, paths)
    }

    async getGitStatus(sessionId: string, cwd?: string): Promise<RpcCommandResponse> {
        return await this.rpcGateway.getGitStatus(sessionId, cwd)
    }

    async getGitDiffNumstat(sessionId: string, options: { cwd?: string; staged?: boolean }): Promise<RpcCommandResponse> {
        return await this.rpcGateway.getGitDiffNumstat(sessionId, options)
    }

    async getGitDiffFile(sessionId: string, options: { cwd?: string; filePath: string; staged?: boolean }): Promise<RpcCommandResponse> {
        return await this.rpcGateway.getGitDiffFile(sessionId, options)
    }

    async readFileMeta(sessionId: string, path: string): Promise<RpcReadFileMetaResponse> {
        return await this.rpcGateway.readFileMeta(sessionId, path)
    }

    async readFileRange(sessionId: string, path: string, offset: number, length: number): Promise<RpcReadFileRangeResponse> {
        return await this.rpcGateway.readFileRange(sessionId, path, offset, length)
    }

    async saveFile(sessionId: string, path: string, content: Uint8Array, baseEtag: string): Promise<RpcSaveFileResponse> {
        return await this.rpcGateway.saveFile(sessionId, path, content, baseEtag)
    }

    async listDirectory(sessionId: string, path: string): Promise<RpcListDirectoryResponse> {
        return await this.rpcGateway.listDirectory(sessionId, path)
    }

    async searchSessionFiles(sessionId: string, query: string, type?: 'file' | 'directory'): Promise<RpcListDirectoryResponse> {
        return await this.rpcGateway.searchSessionFiles(sessionId, query, type)
    }

    async listSessionDirectory(sessionId: string, path: string, prefix?: string): Promise<RpcListDirectoryResponse> {
        return await this.rpcGateway.listSessionDirectory(sessionId, path, prefix)
    }

    async listMachineDirectory(machineId: string, path: string, homeDir: string): Promise<RpcListDirectoryResponse> {
        return await this.rpcGateway.listMachineDirectory(machineId, path, homeDir)
    }

    async machineUploadFileRange(
        machineId: string,
        cwd: string,
        filename: string,
        path: string | undefined,
        offset: number,
        content: Uint8Array,
        totalSize?: number,
    ): Promise<RpcWriteFileRangeResponse> {
        return await this.rpcGateway.machineUploadFileRange(machineId, cwd, filename, path, offset, content, totalSize)
    }

    async machineDeleteUpload(machineId: string, cwd: string, path: string): Promise<RpcDeleteUploadResponse> {
        return await this.rpcGateway.machineDeleteUpload(machineId, cwd, path)
    }

    async machineSearchFiles(machineId: string, cwd: string, query: string): Promise<RpcListDirectoryResponse> {
        return await this.rpcGateway.machineSearchFiles(machineId, cwd, query)
    }

    async machineListSessionDirectory(machineId: string, cwd: string, path: string, prefix?: string): Promise<RpcListDirectoryResponse> {
        return await this.rpcGateway.machineListSessionDirectory(machineId, cwd, path, prefix)
    }

    async machineRefreshMetadata(machineId: string, cwd: string): Promise<RpcRefreshMetadataResponse> {
        return await this.rpcGateway.machineRefreshMetadata(machineId, cwd)
    }

    // web 工具配置读写（纯透传，hub 不存任何 web 工具状态）
    async getWebToolsConfig(machineId: string): Promise<RpcGetWebToolsConfigResponse> {
        return await this.rpcGateway.getWebToolsConfig(machineId)
    }

    async setWebToolsConfig(machineId: string, config: unknown): Promise<RpcSetWebToolsConfigResponse> {
        return await this.rpcGateway.setWebToolsConfig(machineId, config)
    }

    /** Web 工具 provider 验证连接（透传 runner RPC；草稿凭据优先，不落盘） */
    async verifyWebToolsProvider(
        machineId: string,
        providerId: string,
        credentials?: Record<string, string>,
    ): Promise<RpcVerifyWebToolsProviderResponse> {
        return await this.rpcGateway.verifyWebToolsProvider(machineId, providerId, credentials)
    }

    async uploadFileRange(
        sessionId: string,
        filename: string,
        path: string | undefined,
        offset: number,
        content: Uint8Array,
        totalSize?: number,
    ): Promise<RpcWriteFileRangeResponse> {
        return await this.rpcGateway.uploadFileRange(sessionId, filename, path, offset, content, totalSize)
    }

    async deleteUploadFile(sessionId: string, path: string): Promise<RpcDeleteUploadResponse> {
        return await this.rpcGateway.deleteUploadFile(sessionId, path)
    }

    async runRipgrep(sessionId: string, args: string[], cwd?: string): Promise<RpcCommandResponse> {
        return await this.rpcGateway.runRipgrep(sessionId, args, cwd)
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
 * 项目归属校验（web/cli 路由共用判定，收口在 engine 层避免各路由内联漂移）：
 * - not_found：项目不存在或跨 namespace（调用方一般映射 404）
 * - machine_mismatch：machineId 已知且与项目归属机器不符（调用方映射 403/400，按各自既有约定）
 * - ok：可归属。machineId 未知/缺失（含非字符串的异常形态）时放行——老数据（无
 *   machineId）不因此被拒，与 PATCH /sessions/:id 的历史语义一致
 */
export function checkProjectAssignable(
    engine: SyncEngine,
    projectId: string,
    namespace: string,
    machineId?: unknown
): 'ok' | 'not_found' | 'machine_mismatch' {
    const project = engine.getProject(projectId)
    if (!project || project.namespace !== namespace) {
        return 'not_found'
    }
    if (typeof machineId === 'string' && project.machineId !== machineId) {
        return 'machine_mismatch'
    }
    return 'ok'
}
