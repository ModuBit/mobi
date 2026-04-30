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
import type { EffortLevel, PermissionMode, RuntimeState, SDKMetadata, Session } from '@mobi/shared/types'
import type { Store } from '../store'
import { clampAliveTime } from './aliveTime'
import { EventPublisher } from './eventPublisher'
import { extractTodoWriteTodosFromMessageContent } from './todos'
import { extractTeamStateFromMessageContent, applyTeamStateDelta } from './teams'

/**
 * 从消息中回填 runtimeState（todos、teamState 等）
 *
 * 用于历史数据迁移或按需恢复。
 * 注意：当前 runtimeState 已在消息处理时实时持久化，此函数预留用于未来的迁移/恢复场景。
 *
 * @param messages 消息列表
 * @param existingRuntimeState 现有的 runtimeState（用于增量合并）
 * @returns 回填后的 runtimeState，如果没有数据则返回 null
 */
export function backfillRuntimeStateFromMessages(
    messages: Array<{ content: unknown }>,
    existingRuntimeState?: RuntimeState
): RuntimeState | null {
    const runtimeState: RuntimeState = {}

    // 提取 todos（从最新的消息开始，找到第一个有效的）
    for (let i = messages.length - 1; i >= 0; i -= 1) {
        const message = messages[i]
        const todos = extractTodoWriteTodosFromMessageContent(message.content)
        if (todos) {
            runtimeState.todos = todos
            break
        }
    }

    // 提取 teamState（从消息中增量构建）
    let teamState = existingRuntimeState?.teamState ?? null
    for (const message of messages) {
        const delta = extractTeamStateFromMessageContent(message.content)
        if (delta) {
            teamState = applyTeamStateDelta(teamState, delta)
        }
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

    getOrCreateSession(tag: string, metadata: unknown, agentState: unknown, namespace: string, mode?: 'local' | 'remote'): Session {
        const stored = this.store.sessions.getOrCreateSession(tag, metadata, agentState, namespace)
        const session = this.refreshSession(stored.id) ?? (() => { throw new Error('Failed to load session') })()

        // 如果传入了 mode 且 session 当前没有 mode，设置初始 mode
        if (mode !== undefined && session.mode === undefined) {
            session.mode = mode
        }

        return session
    }

    getSessionByClaudeSessionId(claudeSessionId: string, namespace: string): Session | null {
        const stored = this.store.sessions.getSessionByClaudeSessionId(claudeSessionId, namespace)
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
            activeAt: existing?.activeAt ?? stored.createdAt,
            metadata,
            metadataVersion: stored.metadataVersion,
            agentState,
            agentStateVersion: stored.agentStateVersion,
            running: existing?.running ?? false,
            runningAt: existing?.runningAt ?? 0,
            runtimeState,
            permissionMode: existing?.permissionMode,
            mode: existing?.mode,
            tag: stored.tag
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
        const previousMode = session.mode

        session.active = true
        session.activeAt = Math.max(session.activeAt, t)
        session.running = Boolean(payload.running)
        session.runningAt = t
        if (payload.mode !== undefined) {
            session.mode = payload.mode
        }
        if (payload.permissionMode !== undefined) {
            session.permissionMode = payload.permissionMode
        }
        if (payload.model !== undefined) {
            const currentModel = session.runtimeState?.model
            if (payload.model !== currentModel) {
                // 更新 runtimeState 中的 model
                const newRuntimeState = {
                    ...session.runtimeState,
                    model: payload.model
                }
                this.store.sessions.setRuntimeState(payload.sid, newRuntimeState, t, session.namespace)
                session.runtimeState = newRuntimeState
            }
        }
        if (payload.effort !== undefined) {
            const currentEffort = session.runtimeState?.effort
            if (payload.effort !== currentEffort) {
                const newRuntimeState = {
                    ...session.runtimeState,
                    effort: payload.effort
                }
                this.store.sessions.setRuntimeState(payload.sid, newRuntimeState, t, session.namespace)
                session.runtimeState = newRuntimeState
            }
        }

        const now = Date.now()
        const lastBroadcastAt = this.lastBroadcastAtBySessionId.get(session.id) ?? 0
        const modeChanged = previousPermissionMode !== session.permissionMode
            || previousModel !== session.runtimeState?.model
            || session.runtimeState?.effort !== previousEffort
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
                    effort: session.runtimeState?.effort
                }
            })
        }
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

        this.publisher.emit({ type: 'session-updated', sessionId: session.id, data: { active: false, running: false, mode: session.mode } })
    }

    expireInactive(now: number = Date.now()): void {
        const sessionTimeoutMs = 30_000

        for (const session of this.sessions.values()) {
            if (!session.active) continue
            if (now - session.activeAt <= sessionTimeoutMs) continue
            session.active = false
            session.running = false
            this.publisher.emit({ type: 'session-updated', sessionId: session.id, data: { active: false } })
        }
    }

    applySessionConfig(sessionId: string, config: { permissionMode?: PermissionMode; model?: string | null; effort?: EffortLevel }): void {
        const session = this.sessions.get(sessionId) ?? this.refreshSession(sessionId)
        if (!session) {
            return
        }

        if (config.permissionMode !== undefined) {
            session.permissionMode = config.permissionMode
        }
        if (config.model !== undefined) {
            const currentModel = session.runtimeState?.model
            if (config.model !== currentModel) {
                // 更新 runtimeState 中的 model
                const newRuntimeState = {
                    ...session.runtimeState,
                    model: config.model
                }
                const updated = this.store.sessions.setRuntimeState(
                    sessionId,
                    newRuntimeState,
                    Date.now(),
                    session.namespace
                )
                if (!updated) {
                    throw new Error('Failed to update session model')
                }
                session.runtimeState = newRuntimeState
            }
        }
        if (config.effort !== undefined) {
            const currentEffort = session.runtimeState?.effort
            if (config.effort !== currentEffort) {
                const newRuntimeState = {
                    ...session.runtimeState,
                    effort: config.effort
                }
                const updated = this.store.sessions.setRuntimeState(
                    sessionId,
                    newRuntimeState,
                    Date.now(),
                    session.namespace
                )
                if (!updated) {
                    throw new Error('Failed to update session effort')
                }
                session.runtimeState = newRuntimeState
            }
        }

        this.publisher.emit({ type: 'session-updated', sessionId, data: session })
    }

    async renameSession(sessionId: string, name: string): Promise<void> {
        const session = this.sessions.get(sessionId)
        if (!session) {
            throw new Error('Session not found')
        }

        const currentMetadata = session.metadata ?? { path: '', host: '' }
        const newMetadata = { ...currentMetadata, name }

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

        return merged
    }

    updateSDKMetadata(sessionId: string, sdkMetadata: SDKMetadata): void {
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
}
