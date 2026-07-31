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

import { SNAPSHOT_PENDING_ID, GoalStatusSchema, type ClientToServerEvents } from '@mobi/shared'
import type { MessageCategory } from '@mobi/shared'
import { z } from 'zod'
import { randomUUID } from 'node:crypto'
import type { ContextUsage, GoalStatus, PermissionMode, RuntimeState } from '@mobi/shared/types'
import type { Store, StoredSession } from '../../../store'
import type { SyncEvent } from '../../../sync/syncEngine'
import { PendingTaskMap, extractTaskDeltasFromMessageContent, applyTaskDelta } from '../../../sync/tasks'
import { extractTodoWriteTodosFromMessageContent } from '../../../sync/todos'
import { extractTeamStateFromMessageContent, extractTeamSystemDeltasFromMessageContent, applyTeamStateDelta } from '../../../sync/teams'
import {
    collectBackgroundToolUseIds,
    extractBackgroundTaskDeltasFromMessageContent,
    applyBackgroundTaskDelta,
    type BackgroundToolName,
} from '../../../sync/backgroundTasks'
import type { CliSocketWithData } from '../../socketTypes'
import type { AccessErrorReason, AccessResult } from './types'

type SessionAlivePayload = {
    sid: string
    time: number
    running?: boolean
    mode?: 'local' | 'remote'
    permissionMode?: PermissionMode
    model?: string | null
}

type SessionEndPayload = {
    sid: string
    time: number
}

type IdleTimeoutWarningPayload = {
    sid: string
    timeoutAt: number
    remainingMs: number
}

type ResolveSessionAccess = (sessionId: string) => AccessResult<StoredSession>

type EmitAccessError = (scope: 'session' | 'machine', id: string, reason: AccessErrorReason) => void

type UpdateMetadataHandler = ClientToServerEvents['update-metadata']
type UpdateStateHandler = ClientToServerEvents['update-state']

const messageSchema = z.object({
    sid: z.string(),
    message: z.union([z.string(), z.unknown()]),
    localId: z.string().optional(),
    snapshot: z.boolean().optional(),
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
    onSessionAlive?: (payload: SessionAlivePayload) => void
    onSessionEnd?: (payload: SessionEndPayload) => void
    onContextUsage?: (payload: { sid: string; contextUsage: ContextUsage | null }) => void
    onGoalStatus?: (payload: { sid: string; goalStatus: GoalStatus | null }) => void
    onWebappEvent?: (event: SyncEvent) => void
}

export function registerSessionHandlers(socket: CliSocketWithData, deps: SessionHandlersDeps): void {
    const { store, resolveSessionAccess, emitAccessError, onSessionAlive, onSessionEnd, onContextUsage, onGoalStatus, onWebappEvent } = deps

    // session 连接级别的 PendingTaskMap，在连接生命周期内持续存在
    const pendingTaskMap = new PendingTaskMap()

    // session 连接级别的后台工具 ID 映射（toolUseId → toolName），用于区分前后台任务
    const backgroundToolUseIds = new Map<string, BackgroundToolName>()
    // 已确认的后台任务 ID 集合，用于过滤 task_progress / task_notification
    const backgroundTaskIds = new Set<string>()

    socket.on('message', (data: unknown) => {
        const parsed = messageSchema.safeParse(data)
        if (!parsed.success) {
            return
        }

        const { sid, localId, snapshot } = parsed.data

        // 快照消息：不落库，直接透传给 Web
        if (snapshot) {
            const sessionAccess = resolveSessionAccess(sid)
            if (!sessionAccess.ok) {
                emitAccessError('session', sid, sessionAccess.reason)
                return
            }
            const content = parsed.data.message
            onWebappEvent?.({
                type: 'message-snapshot',
                sessionId: sid,
                message: {
                    id: localId ?? SNAPSHOT_PENDING_ID,
                    seq: null,
                    localId: localId ?? null,
                    snapshot: true,
                    content,
                    createdAt: Date.now(),
                },
            })
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

        const msg = store.messages.addMessage(sid, content, localId, category)

        // 提取并更新 runtimeState（todos、tasks、teamState 等）
        const todos = extractTodoWriteTodosFromMessageContent(content)
        const taskDeltas = extractTaskDeltasFromMessageContent(content, pendingTaskMap)
        const teamDelta = extractTeamStateFromMessageContent(content)

        // 先收集后台工具 ID（从 assistant 消息的 tool_use blocks），再提取后台任务增量
        collectBackgroundToolUseIds(content, backgroundToolUseIds)
        const bgTaskDelta = extractBackgroundTaskDeltasFromMessageContent(content, backgroundToolUseIds, backgroundTaskIds)

        // 维护后台任务追踪集合：started 时注册并清理 Map，completed 时移除
        if (bgTaskDelta) {
            if (bgTaskDelta.type === 'started') {
                if (bgTaskDelta.task.toolUseId) backgroundToolUseIds.delete(bgTaskDelta.task.toolUseId)
                backgroundTaskIds.add(bgTaskDelta.task.taskId)
            } else if (bgTaskDelta.type === 'completed') {
                backgroundTaskIds.delete(bgTaskDelta.taskId)
            }
        }

        // 获取当前 runtimeState（team system message 可能独立于其他 delta 到达）
        const existingSession = store.sessions.getSession(sid)
        const existingRuntimeState = (existingSession?.runtimeState as RuntimeState) ?? {}

        // team system message 路由（仅当 teamState 非空时生效）
        const teamSystemDelta = extractTeamSystemDeltasFromMessageContent(content, existingRuntimeState.teamState)

        if (todos || taskDeltas.length > 0 || teamDelta || bgTaskDelta || teamSystemDelta) {

            // 合并 todos
            if (todos) {
                existingRuntimeState.todos = todos
            }

            // 合并 teamState（必须在 task 打标签之前，确保 teamState 已更新）
            if (teamDelta) {
                const existingTeamState = existingRuntimeState.teamState ?? null

                // TeamDelete 时先记录 teamName，再应用 delta
                const deletedTeamName = teamDelta._action === 'delete' && existingTeamState
                    ? (existingTeamState as { teamName: string }).teamName : null

                existingRuntimeState.teamState = applyTeamStateDelta(existingTeamState, teamDelta, sid) ?? undefined

                // TeamDelete 时，完成该 team 创建的 tasks
                if (deletedTeamName && existingRuntimeState.tasks) {
                    existingRuntimeState.tasks = existingRuntimeState.tasks.map(t =>
                        t.metadata?._teamName === deletedTeamName
                            && t.status !== 'completed' && t.status !== 'deleted'
                            ? { ...t, status: 'completed' as const }
                            : t
                    )
                }
            }

            // 合并 team system delta（task_started/task_progress）
            if (teamSystemDelta) {
                const existingTeamState = existingRuntimeState.teamState ?? null
                existingRuntimeState.teamState = applyTeamStateDelta(existingTeamState, teamSystemDelta, sid) ?? undefined
            }

            // 合并 tasks
            for (const taskDelta of taskDeltas) {
                existingRuntimeState.tasks = applyTaskDelta(existingRuntimeState.tasks, taskDelta)
            }

            // 如果有活跃 team，为新建的 task 打上 team 标签（此时 teamState 已是最新）
            if (existingRuntimeState.teamState && existingRuntimeState.tasks) {
                const currentTeamName = (existingRuntimeState.teamState as { teamName: string }).teamName
                const createdIds = new Set(
                    taskDeltas.filter((d): d is Extract<typeof d, { type: 'create' }> => d.type === 'create').map(d => d.task.id)
                )
                if (createdIds.size > 0) {
                    existingRuntimeState.tasks = existingRuntimeState.tasks.map(t =>
                        createdIds.has(t.id)
                            ? { ...t, metadata: { ...t.metadata, _teamName: currentTeamName } }
                            : t
                    )
                }
            }

            // 合并 backgroundTasks
            if (bgTaskDelta) {
                existingRuntimeState.backgroundTasks = applyBackgroundTaskDelta(
                    existingRuntimeState.backgroundTasks,
                    bgTaskDelta,
                )
            }

            // 检测 backgroundTasks 是否全部终态（稍后在推送终态后再清理）
            const shouldAutoClearBgTasks = existingRuntimeState.backgroundTasks?.every(t => t.status !== 'running')

            // 自动清除：tasks 全部完成或删除
            if (existingRuntimeState.tasks?.every(t => t.status === 'completed' || t.status === 'deleted')) {
                delete existingRuntimeState.tasks
            }

            // 自动清除：todos 全部完成
            if (existingRuntimeState.todos?.every(t => t.status === 'completed')) {
                delete existingRuntimeState.todos
            }

            // 用处理时刻而非 msg.createdAt：runtime_state_updated_at 表示状态更新时间，
            // resume 重放时老 createdAt 会让该字段倒退，与下方清理分支语义也不一致
            const updated = store.sessions.setRuntimeState(sid, existingRuntimeState, Date.now(), session.namespace)
            if (updated) {
                onWebappEvent?.({ type: 'session-updated', sessionId: sid, data: { sid, runtimeState: existingRuntimeState } })
            }

            // 自动清除 backgroundTasks：先推送含终态的状态让 Web 端检测到 running→terminal 转换，
            // 再清理并推送空状态
            if (updated && shouldAutoClearBgTasks && existingRuntimeState.backgroundTasks) {
                delete existingRuntimeState.backgroundTasks
                const cleared = store.sessions.setRuntimeState(sid, existingRuntimeState, Date.now(), session.namespace)
                if (cleared) {
                    onWebappEvent?.({ type: 'session-updated', sessionId: sid, data: { sid, runtimeState: existingRuntimeState } })
                }
            }
        }

        const update = {
            id: randomUUID(),
            seq: msg.seq,
            createdAt: Date.now(),
            body: {
                t: 'new-message' as const,
                sid,
                message: {
                    id: msg.id,
                    seq: msg.seq,
                    createdAt: msg.createdAt,
                    localId: msg.localId,
                    submittedAt: msg.submittedAt,
                    queueState: msg.queueState,
                    positionAt: msg.positionAt,
                    content: msg.content
                }
            }
        }
        socket.to(`session:${sid}`).emit('update', update)

        onWebappEvent?.({
            type: 'message-received',
            sessionId: sid,
            message: {
                id: msg.id,
                seq: msg.seq,
                localId: msg.localId,
                submittedAt: msg.submittedAt,
                queueState: msg.queueState,
                positionAt: msg.positionAt,
                content: msg.content,
                createdAt: msg.createdAt
            }
        })
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
            socket.to(`session:${sid}`).emit('update', update)
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
            socket.to(`session:${sid}`).emit('update', update)
            onWebappEvent?.({ type: 'session-updated', sessionId: sid, data: { sid, agentState: result.value, agentStateVersion: result.version } })
        }
    }

    socket.on('update-state', handleUpdateState)

    socket.on('session-alive', (data: SessionAlivePayload) => {
        if (!data || typeof data.sid !== 'string' || typeof data.time !== 'number') {
            return
        }
        const sessionAccess = resolveSessionAccess(data.sid)
        if (!sessionAccess.ok) {
            emitAccessError('session', data.sid, sessionAccess.reason)
            return
        }
        onSessionAlive?.(data)
    })

    socket.on('context-usage', (data: { sid: string; contextUsage: ContextUsage | null }) => {
        // null = 清空（/clear）；非 null 必须是对象
        if (!data || typeof data.sid !== 'string'
            || (data.contextUsage !== null && (typeof data.contextUsage !== 'object' || !data.contextUsage))) {
            return
        }
        const sessionAccess = resolveSessionAccess(data.sid)
        if (!sessionAccess.ok) {
            emitAccessError('session', data.sid, sessionAccess.reason)
            return
        }
        onContextUsage?.(data)
    })

    socket.on('goal-status', (data: { sid: string; goalStatus: GoalStatus | null }) => {
        // null = 清空（达成后/手动清理）；非 null 必须是合法 GoalStatus
        // （与 message/updateState 等 handler 一致用 Zod 校验，防 malformed payload 落库 + SSE 推 web 崩溃）
        if (!data || typeof data.sid !== 'string') return
        if (data.goalStatus !== null) {
            const parsed = GoalStatusSchema.safeParse(data.goalStatus)
            if (!parsed.success) return
            data.goalStatus = parsed.data
        }
        const sessionAccess = resolveSessionAccess(data.sid)
        if (!sessionAccess.ok) {
            emitAccessError('session', data.sid, sessionAccess.reason)
            return
        }
        onGoalStatus?.(data)
    })

    socket.on('session-end', (data: SessionEndPayload) => {
        if (!data || typeof data.sid !== 'string' || typeof data.time !== 'number') {
            return
        }
        const sessionAccess = resolveSessionAccess(data.sid)
        if (!sessionAccess.ok) {
            emitAccessError('session', data.sid, sessionAccess.reason)
            return
        }
        onSessionEnd?.(data)

        // CLI 离线：把仍排队的本地 user 消息全部 invoke，防悬浮条卡死
        const unsubmitted = store.messages.getUnsubmittedLocalMessages(data.sid)
        if (unsubmitted.length > 0) {
            const submittedAt = Date.now()
            const lids = unsubmitted.map(m => m.localId).filter((l): l is string => Boolean(l))
            const fresh = store.messages.markMessagesSubmitted(data.sid, lids, submittedAt)
            if (fresh.length > 0) {
                onWebappEvent?.({ type: 'messages-submitted', sessionId: data.sid, localIds: fresh, submittedAt })
            }
        }
    })

    socket.on('idle-timeout-warning', (data: IdleTimeoutWarningPayload) => {
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

    // CLI 消费了排队消息 → 标记 submittedAt 后转发 SSE 给 Web
    socket.on('messages-submitted', (data: { sid: string; localIds: string[] }) => {
        if (!data || typeof data.sid !== 'string' || !Array.isArray(data.localIds)) {
            return
        }
        const sessionAccess = resolveSessionAccess(data.sid)
        if (!sessionAccess.ok) {
            emitAccessError('session', data.sid, sessionAccess.reason)
            return
        }
        if (data.localIds.length === 0) return

        const submittedAt = Date.now()
        const fresh = store.messages.markMessagesSubmitted(data.sid, data.localIds, submittedAt)
        // DB 落盘成功后才转发 SSE，防 live/refresh 状态分叉
        if (fresh.length > 0) {
            onWebappEvent?.({ type: 'messages-submitted', sessionId: data.sid, localIds: fresh, submittedAt })
        }
    })
}
