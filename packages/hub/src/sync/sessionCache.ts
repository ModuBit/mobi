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

import { AgentStateSchema, MetadataSchema, RuntimeStateSchema } from '@mobi/shared/schemas'
import type { ContextUsage, EffortLevel, GoalStatus, PermissionMode, RuntimeState, SDKMetadata, Session } from '@mobi/shared/types'
import type { TaskItem } from '@mobi/shared/types'
import type { Store } from '../store'
import { clampAliveTime } from './aliveTime'
import { EventPublisher } from './eventPublisher'
import { extractTaskDeltasFromMessageContent, PendingTaskMap, applyTaskDelta } from './tasks'
import { extractTodoWriteTodosFromMessageContent } from './todos'
import {
    extractTeamStateFromMessageContent,
    extractTeamMemberCompletionFromMessageContent,
    applyTeamStateDelta,
    handleTeamSessionEnd,
} from './teams'

/**
 * 从消息中回填 runtimeState（todos、teamState 等）
 *
 * 用于历史数据迁移或按需恢复。
 * 注意：当前 runtimeState 已在消息处理时实时持久化，此函数预留用于未来的迁移/恢复场景。
 *
 * @param messages 消息列表
 * @param existingRuntimeState 现有的 runtimeState（用于增量合并）
 * @param sessionId mobi sessionId，用于推导隐式团队名（session-XXXXXXXX），
 *   与 live 路径保持一致；省略时团队名回退为空串
 * @returns 回填后的 runtimeState，如果没有数据则返回 null
 */
export function backfillRuntimeStateFromMessages(
    messages: Array<{ content: unknown }>,
    existingRuntimeState?: RuntimeState,
    sessionId?: string
): RuntimeState | null {
    const runtimeState: RuntimeState = {}

    // 提取 todos（从最新的消息开始，找到第一个有效的）
    for (let i = messages.length - 1; i >= 0; i -= 1) {
        const message = messages[i]
        const todos = extractTodoWriteTodosFromMessageContent(message.content)
        if (todos) {
            // 全部完成的 todos 自动清除（与实时处理逻辑一致）
            if (!todos.every(t => t.status === 'completed')) {
                runtimeState.todos = todos
            }
            break
        }
    }

    // 交错提取 tasks 和 teamState，以便在创建 task 时打上 team 标签
    const pendingMap = new PendingTaskMap()
    let tasks: TaskItem[] | undefined
    let teamState = existingRuntimeState?.teamState ?? null

    for (const message of messages) {
        // 先处理 teamState（确认当前是否在 team 上下文中）
        const teamDelta = extractTeamStateFromMessageContent(message.content)
        if (teamDelta) {
            const beforeTeamName = teamState ? (teamState as { teamName: string }).teamName : null
            teamState = applyTeamStateDelta(teamState, teamDelta, sessionId)
            // TeamDelete 时，完成该 team 创建的 tasks
            if (teamDelta._action === 'delete' && beforeTeamName && tasks) {
                tasks = tasks.map(t =>
                    t.metadata?._teamName === beforeTeamName
                        && t.status !== 'completed' && t.status !== 'deleted'
                        ? { ...t, status: 'completed' as const }
                        : t
                )
            }
        }

        // tool_result 消费：teammate 完成出口（与 live 路径 sessionHandlers 同款，
        // 保证清理后重放按序收敛——tool_use 重建、tool_result 再标记完成并自动清空）
        const teamCompletionDelta = extractTeamMemberCompletionFromMessageContent(message.content, teamState)
        if (teamCompletionDelta) {
            teamState = applyTeamStateDelta(teamState, teamCompletionDelta, sessionId)
        }

        // 再处理 tasks（在已知 team 上下文的情况下）
        const deltas = extractTaskDeltasFromMessageContent(message.content, pendingMap)
        for (const delta of deltas) {
            tasks = applyTaskDelta(tasks, delta)
            // 为新建的 task 打上当前 team 标签
            if (delta.type === 'create' && teamState) {
                const currentTeamName = (teamState as { teamName: string }).teamName
                tasks = tasks!.map(t =>
                    t.id === delta.task.id
                        ? { ...t, metadata: { ...t.metadata, _teamName: currentTeamName } }
                        : t
                )
            }
        }
    }
    // 全部完成的 tasks 自动清除
    if (tasks?.every(t => t.status === 'completed' || t.status === 'deleted')) {
        tasks = undefined
    }
    if (tasks) {
        runtimeState.tasks = tasks
    }

    if (teamState) {
        runtimeState.teamState = teamState
    }

    return Object.keys(runtimeState).length > 0 ? runtimeState : null
}

export class SessionCache {
    /** 会话缓存：sessionId -> Session */
    private readonly sessions: Map<string, Session> = new Map()
    /**
     * 会话最后广播时间戳：sessionId -> timestamp
     * 用于节流广播，避免频繁发送 session-updated 事件（最小间隔 10 秒）
     */
    private readonly lastBroadcastAtBySessionId: Map<string, number> = new Map()

    constructor(
        private readonly store: Store,
        private readonly publisher: EventPublisher
    ) {
    }

    getSessions(): Session[] {
        return Array.from(this.sessions.values())
    }

    getSessionsByNamespace(namespace: string): Session[] {
        // 从数据库获取该 namespace 的所有 sessions，确保数据一致性
        const storedSessions = this.store.sessions.getSessionsByNamespace(namespace)

        // 同步缓存：移除不在数据库中的 sessions
        for (const [id, session] of this.sessions) {
            if (session.namespace === namespace && !storedSessions.some(s => s.id === id)) {
                this.sessions.delete(id)
                this.lastBroadcastAtBySessionId.delete(id)
            }
        }

        // 刷新/加载 sessions 到缓存
        for (const stored of storedSessions) {
            this.refreshSession(stored.id)
        }

        return this.getSessions().filter((session) => session.namespace === namespace)
    }

    getSession(sessionId: string): Session | undefined {
        return this.sessions.get(sessionId)
    }

    getSessionByNamespace(sessionId: string, namespace: string): Session | undefined {
        const session = this.sessions.get(sessionId)
        if (!session || session.namespace !== namespace) {
            return undefined
        }
        return session
    }

    resolveSessionAccess(
        sessionId: string,
        namespace: string
    ): { ok: true; sessionId: string; session: Session } | { ok: false; reason: 'not-found' | 'access-denied' } {
        const session = this.sessions.get(sessionId) ?? this.refreshSession(sessionId)
        if (session) {
            if (session.namespace !== namespace) {
                return { ok: false, reason: 'access-denied' }
            }
            return { ok: true, sessionId, session }
        }

        return { ok: false, reason: 'not-found' }
    }

    getActiveSessions(): Session[] {
        return this.getSessions().filter((session) => session.active)
    }

    getOrCreateSession(tag: string, metadata: unknown, agentState: unknown, namespace: string, mode?: 'local' | 'remote', runtimeState?: unknown, projectId?: string | null): Session {
        const stored = this.store.sessions.getOrCreateSession(tag, metadata, agentState, namespace, runtimeState, projectId)
        const session = this.refreshSession(stored.id) ?? (() => { throw new Error('Failed to load session') })()

        // 如果传入了 mode 且 session 当前没有 mode，设置初始 mode
        if (mode !== undefined && session.mode === undefined) {
            session.mode = mode
        }

        return session
    }

    getSessionByClaudeSessionId(nativeSessionId: string, namespace: string): Session | null {
        const stored = this.store.sessions.getSessionByClaudeSessionId(nativeSessionId, namespace)
        if (!stored) return null
        // 先从内存缓存取，缓存未命中时从数据库加载（与其他读方法行为一致）
        return this.sessions.get(stored.id) ?? this.refreshSession(stored.id) ?? null
    }

    refreshSession(sessionId: string): Session | null {
        const stored = this.store.sessions.getSession(sessionId)
        if (!stored) {
            const existed = this.sessions.delete(sessionId)
            if (existed) {
                this.publisher.emit({ type: 'session-removed', sessionId })
            }
            return null
        }

        const existing = this.sessions.get(sessionId)

        const metadata = (() => {
            const parsed = MetadataSchema.safeParse(stored.metadata)
            return parsed.success ? parsed.data : null
        })()

        const agentState = (() => {
            const parsed = AgentStateSchema.safeParse(stored.agentState)
            return parsed.success ? parsed.data : null
        })()

        const runtimeState = (() => {
            if (stored.runtimeState === null) return undefined
            const parsed = RuntimeStateSchema.safeParse(stored.runtimeState)
            return parsed.success ? parsed.data : undefined
        })()

        const session: Session = {
            id: stored.id,
            namespace: stored.namespace,
            seq: stored.seq,
            createdAt: stored.createdAt,
            updatedAt: stored.updatedAt,
            // active 和 activeAt 只从内存获取，不存储在数据库中
            active: existing?.active ?? false,
            // 重载时使用当前时间避免立即被 expireInactive 驱逐
            activeAt: existing?.activeAt ?? Date.now(),
            metadata,
            metadataVersion: stored.metadataVersion,
            agentState,
            agentStateVersion: stored.agentStateVersion,
            running: existing?.running ?? false,
            runningAt: existing?.runningAt ?? 0,
            runtimeState,
            // permissionMode：内存优先；hub 重启（existing 为空）时从 DB runtimeState 恢复——
            // keep-alive 落库的权威值，缺省 undefined = 回落 default（与存量会话行为一致）
            permissionMode: existing?.permissionMode ?? runtimeState?.permissionMode,
            mode: existing?.mode,
            tag: stored.tag,
            // 归属项目（null = 游离）：必须显式带上，否则路由层读 session.projectId 恒 undefined
            projectId: stored.projectId,
            // 置顶态：必须显式带上，否则 GET /sessions 与 SSE session-updated 载荷的
            // toSessionSummary 读 session.pinned 恒 undefined → 全局缓存反复抹掉 pinned，
            // 「置顶」分组按钮态/成员资格与分页查询打架（见 sessions_pinned 回归）
            pinned: stored.pinned
        }

        this.sessions.set(sessionId, session)
        // 只在真正新增 session 时广播，避免循环触发
        if (!existing) {
            this.publisher.emit({ type: 'session-added', sessionId, data: session })
        }
        return session
    }

    warmupCache(): void {
        // 先清空缓存，确保移除数据库中已删除的 sessions
        this.sessions.clear()
        this.lastBroadcastAtBySessionId.clear()

        // 只加载最近 100 个 session，避免启动时加载过多数据
        const sessions = this.store.sessions.getRecentSessions(100)
        for (const session of sessions) {
            this.refreshSession(session.id)
        }
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
        const t = clampAliveTime(payload.time)
        if (!t) return

        const session = this.sessions.get(payload.sid) ?? this.refreshSession(payload.sid)
        if (!session) return

        const wasActive = session.active
        const wasRunning = session.running
        const previousPermissionMode = session.permissionMode
        const previousModel = session.runtimeState?.model
        const previousEffort = session.runtimeState?.effort
        const previousOutputStyle = session.runtimeState?.outputStyle
        const previousMode = session.mode

        session.active = true
        session.activeAt = Math.max(session.activeAt, t)
        session.running = Boolean(payload.running)
        session.runningAt = t
        if (payload.mode !== undefined) {
            session.mode = payload.mode
        }
        if (payload.permissionMode !== undefined) {
            // 先落库（失败 throw 时内存不脏，与 model/effort 分支一致），成功后写顶层快照
            //（SSE 广播/resume spawn 读取）——双写保证 hub 重启后 refreshSession 可从 DB 恢复
            this.updateRuntimeStateField(session, payload.sid, 'permissionMode', payload.permissionMode, t, session.namespace)
            session.permissionMode = payload.permissionMode
        }
        if (payload.model !== undefined) {
            this.updateRuntimeStateField(session, payload.sid, 'model', payload.model, t, session.namespace)
        }
        if (payload.effort !== undefined) {
            this.updateRuntimeStateField(session, payload.sid, 'effort', payload.effort, t, session.namespace)
        }
        if (payload.outputStyle !== undefined) {
            this.updateRuntimeStateField(session, payload.sid, 'outputStyle', payload.outputStyle, t, session.namespace)
        }

        const now = Date.now()
        const lastBroadcastAt = this.lastBroadcastAtBySessionId.get(session.id) ?? 0
        const modeChanged = previousPermissionMode !== session.permissionMode
            || previousModel !== session.runtimeState?.model
            || previousEffort !== session.runtimeState?.effort
            || previousOutputStyle !== session.runtimeState?.outputStyle
            || previousMode !== session.mode
        const shouldBroadcast = (!wasActive && session.active)
            || (wasRunning !== session.running)
            || modeChanged
            || (now - lastBroadcastAt > 10_000)

        if (shouldBroadcast) {
            this.lastBroadcastAtBySessionId.set(session.id, now)
            this.publisher.emit({
                type: 'session-updated',
                sessionId: session.id,
                data: {
                    active: true,
                    activeAt: session.activeAt,
                    running: session.running,
                    mode: session.mode,
                    permissionMode: session.permissionMode,
                    model: session.runtimeState?.model,
                    effort: session.runtimeState?.effort,
                    outputStyle: session.runtimeState?.outputStyle
                }
            })
        }
    }

    private updateRuntimeStateField<K extends keyof RuntimeState>(
        session: Session,
        sessionId: string,
        field: K,
        value: RuntimeState[K],
        timestamp: number,
        namespace: string
    ): void {
        const current = session.runtimeState?.[field]
        if (value === current) return
        const newRuntimeState = { ...session.runtimeState, [field]: value }
        const updated = this.store.sessions.setRuntimeState(sessionId, newRuntimeState, timestamp, namespace)
        if (!updated) {
            throw new Error(`Failed to update session ${String(field)}`)
        }
        session.runtimeState = newRuntimeState
    }

    /**
     * 处理上下文用量上报（CLI 事件驱动采集）。
     * 落库到 runtimeState.contextUsage（updateRuntimeStateField 复用 model/effort 同款路径）
     * + SSE 推 runtimeState patch 给 web。作为 runtimeState 字段落库，resume 时首屏从 DB
     * 直接读到值，下次 init/result 采集即覆盖成最新。
     */
    handleContextUsage(payload: { sid: string; contextUsage: ContextUsage | null }): void {
        const session = this.sessions.get(payload.sid) ?? this.refreshSession(payload.sid)
        if (!session) return
        try {
            // contextUsage 为 null → 清空（/clear 后新会话从 0 开始）；否则落库覆盖
            this.updateRuntimeStateField(
                session, payload.sid, 'contextUsage', payload.contextUsage ?? undefined,
                Date.now(), session.namespace,
            )
        } catch {
            // 落库失败不阻塞采集流程（CLI 下次事件会重试上报）
            return
        }
        this.publisher.emit({
            type: 'session-updated',
            sessionId: session.id,
            data: { runtimeState: session.runtimeState },
        })
    }

    /**
     * 处理 goal 状态上报（CLI 事件驱动：reportGoalStatus RPC → emit 'goal-status'）。
     * 落库到 runtimeState.goalStatus（复用 updateRuntimeStateField 同款路径）
     * + SSE 推 runtimeState patch 给 web。
     * goalStatus 为 null 表示清空（达成 10s 后 / 手动清理），undefined 让 updateRuntimeStateField
     * 把字段从 runtimeState 移除（JSON.stringify 丢弃 undefined 键 → DB 无此字段 → resume 读不到）。
     */
    handleGoalStatus(payload: { sid: string; goalStatus: GoalStatus | null }): void {
        const session = this.sessions.get(payload.sid) ?? this.refreshSession(payload.sid)
        if (!session) return
        try {
            // goalStatus 为 null → 清空；否则落库覆盖
            this.updateRuntimeStateField(
                session, payload.sid, 'goalStatus', payload.goalStatus ?? undefined,
                Date.now(), session.namespace,
            )
        } catch {
            // 落库失败不阻塞 CLI 流程（下次 turn 会重试上报）
            return
        }
        this.publisher.emit({
            type: 'session-updated',
            sessionId: session.id,
            data: { runtimeState: session.runtimeState },
        })
    }

    /**
     * 处理轮次起点上报（CLI running 翻转 false→true 时，SessionBase.onRunningChange 触发）。
     * 落库到 runtimeState.runStartedAt（复用 updateRuntimeStateField 同款路径）
     * + SSE 推 runtimeState patch 给 web——StatusBar 计时的权威来源，不随消息窗口化丢失
     *（docs/pending.md #55）。轮次结束后保留旧值（running=false 时 UI 不消费）
     */
    handleRunStarted(payload: { sid: string; runStartedAt: number }): void {
        const session = this.sessions.get(payload.sid) ?? this.refreshSession(payload.sid)
        if (!session) return
        // 时间倒退保护仅在「上一轮仍在跑」时生效（session.running 来自 keepAlive，CLI 在
        // 翻转 false→true 时先发 run-started 再发 keepAlive(true)——run-started 到达时
        // running 反映上一轮状态）：此时旧值重报只可能是重连重投递，静默忽略。
        // running=false（轮次已结束/机器接管）后的上报必是新轮次起点——CLI 只在翻转时上报、
        // 不重试，此时即便时间戳早于存量值（CLI 机器时钟偏慢/NTP 回拨）也必须接受，
        // 否则计时起点永久陈旧（elapsed 虚大）
        if (session.running
            && typeof session.runtimeState?.runStartedAt === 'number'
            && session.runtimeState.runStartedAt >= payload.runStartedAt) {
            return
        }
        try {
            this.updateRuntimeStateField(
                session, payload.sid, 'runStartedAt', payload.runStartedAt,
                Date.now(), session.namespace,
            )
        } catch {
            // 落库失败不阻塞 CLI 流程（下次翻转会重试上报）
            return
        }
        this.publisher.emit({
            type: 'session-updated',
            sessionId: session.id,
            data: { runtimeState: session.runtimeState },
        })
    }

    handleSessionEnd(payload: { sid: string; time: number }): void {
        const t = clampAliveTime(payload.time) ?? Date.now()

        const session = this.sessions.get(payload.sid) ?? this.refreshSession(payload.sid)
        if (!session) return

        if (!session.active && !session.running) {
            return
        }

        session.active = false
        session.running = false
        session.runningAt = t

        // Session 结束时标记 team members/tasks 为 completed
        const runtimeState = session.runtimeState as Record<string, unknown> | undefined
        if (runtimeState?.teamState) {
            const teamName = (runtimeState.teamState as { teamName: string }).teamName
            const endedTeamState = handleTeamSessionEnd(runtimeState.teamState as Parameters<typeof handleTeamSessionEnd>[0])
            // 标记 completed 后走 applyTeamStateDelta 自动清理（all-done → null）
            runtimeState.teamState = applyTeamStateDelta(null, {
                _action: 'update',
                ...endedTeamState,
            }) ?? undefined
            // 完成该 team 创建的 runtime_state.tasks
            const tasks = runtimeState.tasks as Array<Record<string, unknown>> | undefined
            if (tasks) {
                runtimeState.tasks = tasks.map(t =>
                    (t.metadata as Record<string, unknown>)?._teamName === teamName
                        && t.status !== 'completed' && t.status !== 'deleted'
                        ? { ...t, status: 'completed' }
                        : t
                )
            }
            // 持久化更新
            this.store.sessions.setRuntimeState(session.id, runtimeState, Date.now(), session.namespace)
        }

        // 广播（teamState 已自动清理，无需额外包含 runtimeState）
        this.publisher.emit({ type: 'session-updated', sessionId: session.id, data: { active: false, running: false, mode: session.mode } })
    }

    expireInactive(now: number = Date.now()): void {
        const sessionTimeoutMs = 30_000
        const evictionMs = 3_600_000 // 1 小时

        for (const session of this.sessions.values()) {
            if (!session.active) continue
            if (now - session.activeAt <= sessionTimeoutMs) continue
            session.active = false
            session.running = false
            this.publisher.emit({ type: 'session-updated', sessionId: session.id, data: { active: false } })
        }

        // 驱逐长时间 inactive 的 session（仍在 DB 中，按需重新加载）
        for (const [id, session] of this.sessions) {
            if (!session.active && now - session.activeAt > evictionMs) {
                this.sessions.delete(id)
                this.lastBroadcastAtBySessionId.delete(id)
            }
        }
    }

    applySessionConfig(sessionId: string, config: { permissionMode?: PermissionMode; model?: string | null; effort?: EffortLevel }): void {
        const session = this.sessions.get(sessionId) ?? this.refreshSession(sessionId)
        if (!session) {
            return
        }

        if (config.permissionMode !== undefined) {
            // 与 model/effort 同款双写：内存顶层快照即时生效 + runtimeState 落库兜 hub 重启
            //（web 切换后 CLI keep-alive 会再带回同值，此处先落库消除「CLI 掉线期间重启丢切换」窗口）
            this.updateRuntimeStateField(session, sessionId, 'permissionMode', config.permissionMode, Date.now(), session.namespace)
            session.permissionMode = config.permissionMode
        }
        if (config.model !== undefined) {
            this.updateRuntimeStateField(session, sessionId, 'model', config.model, Date.now(), session.namespace)
        }
        if (config.effort !== undefined) {
            this.updateRuntimeStateField(session, sessionId, 'effort', config.effort, Date.now(), session.namespace)
        }

        this.publisher.emit({ type: 'session-updated', sessionId, data: session })
    }

    async renameSession(sessionId: string, name: string): Promise<void> {
        const session = this.sessions.get(sessionId)
        if (!session) {
            throw new Error('Session not found')
        }

        const currentMetadata = session.metadata ?? { path: '', host: '' }
        // 用户显式重命名：以新 name 为准，并清除自动摘要 summary。
        // web 端 getSessionDisplayName 优先级为 summary.text > name，若保留旧 summary，
        // 用户命名会被自动摘要盖住，表现为“重命名提示成功但显示未生效”。
        // summary 仅承载 Claude 自动摘要，下次 summary 事件会重新填充。
        const newMetadata = { ...currentMetadata, name, summary: undefined }

        const result = this.store.sessions.updateSessionMetadata(
            sessionId,
            newMetadata,
            session.metadataVersion,
            session.namespace,
            { touchUpdatedAt: false }
        )

        if (result.result === 'error') {
            throw new Error('Failed to update session metadata')
        }

        if (result.result === 'version-mismatch') {
            throw new Error('Session was modified concurrently. Please try again.')
        }

        this.refreshSession(sessionId)
    }

    async deleteSession(sessionId: string): Promise<void> {
        const session = this.sessions.get(sessionId)
        if (!session) {
            throw new Error('Session not found')
        }

        if (session.active) {
            throw new Error('Cannot delete active session')
        }

        const deleted = this.store.sessions.deleteSession(sessionId, session.namespace)
        if (!deleted) {
            throw new Error('Failed to delete session')
        }

        this.sessions.delete(sessionId)
        this.lastBroadcastAtBySessionId.delete(sessionId)

        this.publisher.emit({ type: 'session-removed', sessionId, namespace: session.namespace })
    }

    async mergeSessions(oldSessionId: string, newSessionId: string, namespace: string): Promise<void> {
        if (oldSessionId === newSessionId) {
            return
        }

        const oldStored = this.store.sessions.getSessionByNamespace(oldSessionId, namespace)
        const newStored = this.store.sessions.getSessionByNamespace(newSessionId, namespace)
        if (!oldStored || !newStored) {
            throw new Error('Session not found for merge')
        }

        this.store.messages.mergeSessionMessages(oldSessionId, newSessionId)

        const mergedMetadata = this.mergeSessionMetadata(oldStored.metadata, newStored.metadata)
        if (mergedMetadata !== null && mergedMetadata !== newStored.metadata) {
            for (let attempt = 0; attempt < 2; attempt += 1) {
                const latest = this.store.sessions.getSessionByNamespace(newSessionId, namespace)
                if (!latest) break
                const result = this.store.sessions.updateSessionMetadata(
                    newSessionId,
                    mergedMetadata,
                    latest.metadataVersion,
                    namespace,
                    { touchUpdatedAt: false }
                )
                if (result.result === 'success') {
                    break
                }
                if (result.result === 'error') {
                    break
                }
            }
        }

        // 合并 runtimeState（包括 todos、teamState、model 等）
        if (oldStored.runtimeState !== null && oldStored.runtimeStateUpdatedAt !== null) {
            const oldRuntimeState = oldStored.runtimeState as RuntimeState
            const newRuntimeState = (newStored.runtimeState as RuntimeState) ?? {}
            const mergedRuntimeState = this.mergeRuntimeState(oldRuntimeState, newRuntimeState)

            if (Object.keys(mergedRuntimeState).length > 0) {
                this.store.sessions.setRuntimeState(
                    newSessionId,
                    mergedRuntimeState,
                    Math.max(oldStored.runtimeStateUpdatedAt, newStored.runtimeStateUpdatedAt ?? 0),
                    namespace
                )
            }
        }

        const deleted = this.store.sessions.deleteSession(oldSessionId, namespace)
        if (!deleted) {
            throw new Error('Failed to delete old session during merge')
        }

        const existed = this.sessions.delete(oldSessionId)
        if (existed) {
            this.publisher.emit({ type: 'session-removed', sessionId: oldSessionId, namespace })
        }
        this.lastBroadcastAtBySessionId.delete(oldSessionId)

        this.refreshSession(newSessionId)
    }

    private mergeSessionMetadata(oldMetadata: unknown | null, newMetadata: unknown | null): unknown | null {
        if (!oldMetadata || typeof oldMetadata !== 'object') {
            return newMetadata
        }
        if (!newMetadata || typeof newMetadata !== 'object') {
            return oldMetadata
        }

        const oldObj = oldMetadata as Record<string, unknown>
        const newObj = newMetadata as Record<string, unknown>
        const merged: Record<string, unknown> = { ...newObj }
        let changed = false

        if (typeof oldObj.name === 'string' && typeof newObj.name !== 'string') {
            merged.name = oldObj.name
            changed = true
        }

        const oldSummary = oldObj.summary as { text?: unknown; updatedAt?: unknown } | undefined
        const newSummary = newObj.summary as { text?: unknown; updatedAt?: unknown } | undefined
        const oldUpdatedAt = typeof oldSummary?.updatedAt === 'number' ? oldSummary.updatedAt : null
        const newUpdatedAt = typeof newSummary?.updatedAt === 'number' ? newSummary.updatedAt : null
        if (oldUpdatedAt !== null && (newUpdatedAt === null || oldUpdatedAt > newUpdatedAt)) {
            merged.summary = oldSummary
            changed = true
        }

        if (oldObj.worktree && !newObj.worktree) {
            merged.worktree = oldObj.worktree
            changed = true
        }

        if (typeof oldObj.path === 'string' && typeof newObj.path !== 'string') {
            merged.path = oldObj.path
            changed = true
        }
        if (typeof oldObj.host === 'string' && typeof newObj.host !== 'string') {
            merged.host = oldObj.host
            changed = true
        }

        return changed ? merged : newMetadata
    }

    private mergeRuntimeState(oldState: RuntimeState, newState: RuntimeState): RuntimeState {
        const merged: RuntimeState = { ...newState }

        // 合并 todos（优先使用更新的）
        if (oldState.todos && !newState.todos) {
            merged.todos = oldState.todos
        }

        // 合并 tasks（优先使用更新的）
        if (oldState.tasks && !newState.tasks) {
            merged.tasks = oldState.tasks
        }

        // 合并 teamState
        if (oldState.teamState && !newState.teamState) {
            merged.teamState = oldState.teamState
        }

        // 合并 model（如果新会话没有 model，保留旧会话的 model）
        if (oldState.model !== undefined && newState.model === undefined) {
            merged.model = oldState.model
        }

        // 合并 effort（如果新会话没有 effort，保留旧会话的 effort）
        if (oldState.effort !== undefined && newState.effort === undefined) {
            merged.effort = oldState.effort
        }

        // 合并 outputStyle（resume 后新会话 keep-alive 尚未上报前，保留旧会话的值）
        if (oldState.outputStyle !== undefined && newState.outputStyle === undefined) {
            merged.outputStyle = oldState.outputStyle
        }

        return merged
    }

    /**
     * 清除 session runtimeState 中的指定字段并推送 SSE 更新
     */
    clearRuntimeStateFields(sessionId: string, fields: string[], namespace: string): boolean {
        const session = this.sessions.get(sessionId) ?? this.refreshSession(sessionId)
        if (!session || session.namespace !== namespace) return false

        const result = this.store.sessions.clearRuntimeStateFields(sessionId, fields, namespace)
        if (result) {
            // 刷新缓存并推送 SSE
            this.refreshSession(sessionId)
            const updated = this.sessions.get(sessionId)
            if (updated) {
                this.publisher.emit({
                    type: 'session-updated',
                    sessionId,
                    data: { sid: sessionId, runtimeState: updated.runtimeState },
                })
            }
        }
        return result
    }

    updateSDKMetadata(sessionId: string, sdkMetadata: SDKMetadata): void {
        // 通用写路径（CLI socket 推送的 outputStyle/fastMode 等、阻塞首次加载等）。
        // 不在此发 SSE——SWR 的 web refetch 通知只属于后台刷新路径（见 applyRefreshedSDKMetadata），
        // 否则每次 CLI 写都逼所有 web 客户端 refetch + 再触发一次后台 RPC。
        const session = this.sessions.get(sessionId)
        if (!session) return

        const currentMetadata = (session.metadata ?? { path: '', host: '' }) as Record<string, unknown>
        const newMetadata = { ...currentMetadata, sdkMetadata }

        const result = this.store.sessions.updateSessionMetadata(
            sessionId,
            newMetadata,
            session.metadataVersion,
            session.namespace,
            { touchUpdatedAt: false }
        )

        if (result.result === 'success') {
            this.refreshSession(sessionId)
        }
    }

    /**
     * 后台刷新专用：compare-and-swap 写 sdkMetadata。
     * 同步完成「读缓存 → 相等比较 → 写库 → 发 SSE」，JS 单线程内无 TOCTOU 窗口。
     *
     * 仅当新内容与缓存实际不同（稳定 JSON 串对比，对象按 key、数组按元素内容排序，
     * 顺序无关）才写库并发 sdk-metadata-refreshed SSE；相同则什么都不做。
     * 「内容相等即不发」是打破 SWR「refetch ↔ SSE」无限循环的唯一闸——SDK 跨次
     * 返回顺序不稳也不会被误判为变化。仅后台刷新路径调用。
     *
     * @param expectedVersion 发起后台 RPC 时快照的 metadataVersion；apply 时若当前版本已不同，
     *   说明 RPC 期间有别处写入了 metadata（如阻塞首装、CLI 推送），RPC 结果可能 stale，放弃写。
     *   undefined 时不守卫（保留非后台调用方行为）。
     * @returns 是否实际发生了变更（写了库 + 发了 SSE）
     */
    applyRefreshedSDKMetadata(sessionId: string, sdkMetadata: SDKMetadata, expectedVersion?: number): boolean {
        const session = this.sessions.get(sessionId)
        if (!session) return false

        // 版本守卫：杜绝 stale RPC 覆盖并发写入（见 @param expectedVersion）
        if (expectedVersion !== undefined && session.metadataVersion !== expectedVersion) {
            return false
        }

        // 比较基准必须取 raw stored.metadata（未裁剪），不能用内存 session.metadata.sdkMetadata：
        // 后者经 refreshSession 的 MetadataSchema.safeParse（Zod 默认 strip）裁掉了 Schema 未声明的字段，
        // 一旦 SDK 返回新字段（如 model 的 resolvedModel/supportsEffort，或未来新增），内存值就会
        // 永久 ≠ RPC 完整值，相等闸永不闭合 → refetch↔SSE 死循环。Schema 是下游消费契约，不该兼任
        // 原始数据等价比对基准。
        const stored = this.store.sessions.getSession(sessionId)
        const cachedSdk = (stored?.metadata as Record<string, unknown> | undefined)?.sdkMetadata as SDKMetadata | undefined
        if (cachedSdk && sdkMetadataEqual(cachedSdk, sdkMetadata)) {
            return false
        }

        const currentMetadata = (session.metadata ?? { path: '', host: '' }) as Record<string, unknown>
        const newMetadata = { ...currentMetadata, sdkMetadata }
        const result = this.store.sessions.updateSessionMetadata(
            sessionId,
            newMetadata,
            session.metadataVersion,
            session.namespace,
            { touchUpdatedAt: false }
        )
        if (result.result !== 'success') return false

        this.refreshSession(sessionId)
        this.publisher.emit({
            type: 'sdk-metadata-refreshed',
            sessionId,
            namespace: session.namespace,
        })
        return true
    }
}

/**
 * sdkMetadata 等价比较（顺序无关）。用于后台刷新判定「是否真变了」。
 */
function sdkMetadataEqual(a: SDKMetadata, b: SDKMetadata): boolean {
    return stableStringify(a) === stableStringify(b)
}

/**
 * 稳定 JSON 串：对象按 key 排序、数组按元素稳定串排序（数组顺序无关）。
 * commands/agents/models 等集合，SDK 跨次返回顺序可能不稳——若按原序比较，
 * 会把「顺序抖动」误判为内容变化，每次后台刷新都写库 + 发 SSE，触发
 * refetch ↔ SSE 无限循环（每轮 spawn 一次 SDK RPC）。
 */
function stableStringify(value: unknown): string {
    if (value === null || typeof value !== 'object') return JSON.stringify(value)
    if (Array.isArray(value)) {
        return '[' + value.map(stableStringify).sort().join(',') + ']'
    }
    const obj = value as Record<string, unknown>
    return '{' + Object.keys(obj).sort().map(k => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(',') + '}'
}
