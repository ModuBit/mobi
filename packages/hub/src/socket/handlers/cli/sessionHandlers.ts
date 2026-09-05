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

import { COMMAND_LIFECYCLE_STATES, SNAPSHOT_PENDING_ID, ContextUsageSchema, GoalStatusSchema, type ClientToServerEvents, type CommandLifecycleState, type MessageFact } from '@mobi/shared'
import type { MessageCategory } from '@mobi/shared'
import { z } from 'zod'
import { randomUUID } from 'node:crypto'
import type { ContextUsage, EffortLevel, GoalStatus, PermissionMode, RuntimeState } from '@mobi/shared/types'
import { hubLogger } from '../../../logger'
import type { Store, StoredMessage, StoredSession } from '../../../store'
import type { SyncEvent } from '../../../sync/syncEngine'
import type { BackgroundTaskTracker } from '../../../sync/backgroundTaskTracker'
import type { RewindDeleteBoundTracker } from '../../../sync/rewindDeleteBoundTracker'
import { toDecryptedMessage } from '../../../sync/messageService'
import { extractWithdrawnContent } from '../../../store/messages'
import { PendingTaskMap, extractTaskDeltasFromMessageContent, applyTaskDelta } from '../../../sync/tasks'
import { extractTodoWriteTodosFromMessageContent } from '../../../sync/todos'
import {
    extractTeamStateFromMessageContent,
    extractTeamSystemDeltasFromMessageContent,
    extractTeamMemberCompletionFromMessageContent,
    applyTeamStateDelta,
} from '../../../sync/teams'
import {
    collectBackgroundToolUseIds,
    extractBackgroundTaskDeltasFromMessageContent,
    extractBackgroundTaskIdsFromMessageContent,
    extractExcludedTaskStartedIds,
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
    effort?: EffortLevel
    outputStyle?: string
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
    /** 上游 native 事实（rewind 锚点）：CLI 在 SDK 下发消息时自带，两者无时序问题 */
    metadata: z.object({
        nativeId: z.string().optional(),
        nativeSessionId: z.string().optional()
    }).optional(),
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
    /** 活跃后台任务集合（写侧：background_tasks_changed replace；读侧：rewind API 闸门） */
    backgroundTaskTracker: BackgroundTaskTracker
    /** rewind 软删除上界（读侧：rewind-truncated 消费；写侧：SyncEngine 受理时 mark，共用实例） */
    rewindDeleteBoundTracker?: RewindDeleteBoundTracker
    onSessionAlive?: (payload: SessionAlivePayload) => void
    onSessionEnd?: (payload: SessionEndPayload) => void
    onContextUsage?: (payload: { sid: string; contextUsage: ContextUsage | null }) => void
    onGoalStatus?: (payload: { sid: string; goalStatus: GoalStatus | null }) => void
    /** CLI 轮次起点上报（running 翻转 false→true 时）→ 落库 runtimeState.runStartedAt + SSE 推 */
    onRunStarted?: (payload: { sid: string; runStartedAt: number }) => void
    onWebappEvent?: (event: SyncEvent) => void
}

export function registerSessionHandlers(socket: CliSocketWithData, deps: SessionHandlersDeps): void {
    const { store, resolveSessionAccess, emitAccessError, backgroundTaskTracker, rewindDeleteBoundTracker, onSessionAlive, onSessionEnd, onContextUsage, onGoalStatus, onRunStarted, onWebappEvent } = deps

    // session 连接级别的 PendingTaskMap，在连接生命周期内持续存在
    const pendingTaskMap = new PendingTaskMap()

    // session 连接级别的后台工具 ID 映射（toolUseId → toolName），用于区分前后台任务
    const backgroundToolUseIds = new Map<string, BackgroundToolName>()
    // 已确认的后台任务 ID 集合，用于过滤 task_progress / task_notification
    const backgroundTaskIds = new Set<string>()
    // 被 hub 过滤丢弃的后台任务 ID 集合（ambient 家务 / in_process_teammate，spec D1/D2）：
    // 传给 deltas 提取作 excludedTaskIds，防被滤任务经 task_updated patch.is_backgrounded
    // 豁免通道补建/直落终态复活（running 幽灵卡 / 空 ghost 终态条目）
    const filteredTaskIds = new Set<string>()

    socket.on('session-message', (data: unknown) => {
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

        const msg = store.messages.addMessage(sid, content, localId, category, parsed.data.metadata ?? null)

        // 提取并更新 runtimeState（todos、tasks、teamState 等）
        const todos = extractTodoWriteTodosFromMessageContent(content)
        const taskDeltas = extractTaskDeltasFromMessageContent(content, pendingTaskMap)
        const teamDelta = extractTeamStateFromMessageContent(content)

        // 先收集后台工具 ID（从 assistant 消息的 tool_use blocks）
        collectBackgroundToolUseIds(content, backgroundToolUseIds)

        // 获取当前 runtimeState（须先于 bg delta 提取：persistedTaskIds 依赖已持久化的
        // backgroundTasks——hub 重启/CLI 重连后连接级 backgroundTaskIds 清空且不从 DB 回种，
        // 持久化的真实条目只能靠它挡住降级补建覆盖）。team system message 可能独立于其他 delta 到达
        const existingSession = store.sessions.getSession(sid)
        const existingRuntimeState = (existingSession?.runtimeState as RuntimeState) ?? {}
        const persistedTaskIds: ReadonlySet<string> = new Set(
            existingRuntimeState.backgroundTasks?.map(t => t.taskId) ?? [],
        )

        // 再解析 background_tasks_changed，整体替换活跃后台集合（replace 语义）。
        // 必须先于 task_started 判定：bg_changed 是 task_started 的父消息（同 seq 先到），
        // 处理 task_started 时集合必须已是最新。被滤（ambient）条目同步 REPLACE 进 filteredTaskIds
        const activeBgIds = extractBackgroundTaskIdsFromMessageContent(content)
        if (activeBgIds !== null) {
            backgroundTaskTracker.replace(sid, activeBgIds.ids)
            filteredTaskIds.clear()
            for (const id of activeBgIds.filteredIds) filteredTaskIds.add(id)
        }
        // task_started 入口被判丢弃（ambient/teammate）的 taskId 增量并入：无对应 bg_changed
        // 快照的场景（如 teammate）也纳入排除集合
        for (const id of extractExcludedTaskStartedIds(content)) filteredTaskIds.add(id)

        const bgTaskDelta = extractBackgroundTaskDeltasFromMessageContent(
            content,
            backgroundToolUseIds,
            backgroundTaskIds,
            backgroundTaskTracker.getActive(sid),
            persistedTaskIds,
            filteredTaskIds,
        )

        // 维护后台任务追踪集合：started 时注册并清理 Map，completed 时移除
        if (bgTaskDelta) {
            if (bgTaskDelta.type === 'started') {
                if (bgTaskDelta.task.toolUseId) backgroundToolUseIds.delete(bgTaskDelta.task.toolUseId)
                backgroundTaskIds.add(bgTaskDelta.task.taskId)
            } else if (bgTaskDelta.type === 'completed') {
                backgroundTaskIds.delete(bgTaskDelta.taskId)
            }
        }

        // team system message 路由（仅当 teamState 非空时生效；existingRuntimeState 已在上方取得）
        const teamSystemDelta = extractTeamSystemDeltasFromMessageContent(content, existingRuntimeState.teamState)
        // user 消息的 tool_result：teammate 完成出口（配对 member.toolUseIds 标 completed）
        const teamCompletionDelta = extractTeamMemberCompletionFromMessageContent(content, existingRuntimeState.teamState)

        if (todos || taskDeltas.length > 0 || teamDelta || bgTaskDelta || teamSystemDelta || teamCompletionDelta) {

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

            // 合并 teammate 完成 delta（tool_result 配对；全 done 时 applyTeamStateDelta 自动清空 teamState）
            if (teamCompletionDelta) {
                const existingTeamState = existingRuntimeState.teamState ?? null
                existingRuntimeState.teamState = applyTeamStateDelta(existingTeamState, teamCompletionDelta, sid) ?? undefined
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
        // null = 清空（/clear）；非 null 必须是合法 ContextUsage
        // （与 goal-status 等 handler 一致用 Zod 校验，防 malformed payload 落库 + SSE 推 web 崩溃）
        if (!data || typeof data.sid !== 'string') return
        if (data.contextUsage !== null) {
            const parsed = ContextUsageSchema.safeParse(data.contextUsage)
            if (!parsed.success) return
            data.contextUsage = parsed.data
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

    socket.on('run-started', (data: { sid: string; runStartedAt: number }) => {
        // 轮次起点（epoch ms）：CLI running 翻转 false→true 时上报（SessionBase.onRunningChange）
        if (!data || typeof data.sid !== 'string' || typeof data.runStartedAt !== 'number'
            || !Number.isFinite(data.runStartedAt) || data.runStartedAt <= 0) {
            return
        }
        const sessionAccess = resolveSessionAccess(data.sid)
        if (!sessionAccess.ok) {
            emitAccessError('session', data.sid, sessionAccess.reason)
            return
        }
        onRunStarted?.(data)
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
            const pushedAt = Date.now()
            const lids = unsubmitted.map(m => m.localId).filter((l): l is string => Boolean(l))
            const fresh = store.messages.markMessagesPushed(data.sid, lids, pushedAt)
            if (fresh.length > 0) {
                onWebappEvent?.({ type: 'messages-submitted', sessionId: data.sid, localIds: fresh, submittedAt: pushedAt })
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

    // ===== 用户消息事实共享处理体（messages-facts 各 fact kind 共用）=====

    /** 补写/推进行的统一广播：按 message 落库后的广播模式逐行推给 Web（update new-message +
     *  SSE message-received）——Web 端据此刷新 rewind 判据与 lifecycle 展示（P3 消费）。
     *  update 事件的 new-message 体受 shared UpdateNewMessageBodySchema 约束（seq: number）——
     *  行 seq 恒为 number，此处显式收窄，其余字段复用统一 DTO 映射 */
    const broadcastStoredMessages = (sid: string, msgs: StoredMessage[]) => {
        for (const msg of msgs) {
            const message = { ...toDecryptedMessage(msg), seq: msg.seq }
            socket.to(`session:${sid}`).emit('session-update', {
                id: randomUUID(),
                seq: msg.seq,
                createdAt: Date.now(),
                body: {
                    t: 'new-message' as const,
                    sid,
                    message
                }
            })
            onWebappEvent?.({
                type: 'message-received',
                sessionId: sid,
                message: toDecryptedMessage(msg)
            })
        }
    }

    /** 消费排队消息 → 推进 lifecycle=pushed 后转发 SSE（原 messages-submitted 处理体）。
     *  DB 落盘成功后才转发 SSE，防 live/refresh 状态分叉。 */
    const processSubmitted = (sid: string, localIds: string[], pushedAt: number) => {
        if (localIds.length === 0) return
        const fresh = store.messages.markMessagesPushed(sid, localIds, pushedAt)
        if (fresh.length > 0) {
            onWebappEvent?.({ type: 'messages-submitted', sessionId: sid, localIds: fresh, submittedAt: pushedAt })
        }
    }

    /** native 锚点绑定（原 messages-bound 处理体）：幂等落库，补写行逐行广播（Web 端据此
     *  刷新 rewind 判据，否则 hover 不显 icon、刷新才见）。逐项校验：null 项/缺字段会让
     *  bindNativeIds 抛 TypeError，空串 nativeId / nativeSessionId 则永久占坑（first-write-wins +
     *  json_extract IS NULL 守卫会挡住后续合法绑定）——无效项直接丢弃，不落库 */
    const processBound = (
        sid: string,
        bindings: { localId: string; metadata: { nativeId: string; nativeSessionId?: string } }[]
    ) => {
        const valid = bindings
            .filter((b): b is { localId: string; metadata: { nativeId: string; nativeSessionId?: string } } =>
                b !== null && typeof b === 'object' &&
                typeof b.localId === 'string' && b.localId.length > 0 &&
                typeof b.metadata === 'object' && b.metadata !== null &&
                typeof b.metadata.nativeId === 'string' && b.metadata.nativeId.length > 0 &&
                (b.metadata.nativeSessionId === undefined
                    || (typeof b.metadata.nativeSessionId === 'string' && b.metadata.nativeSessionId.length > 0)))
        if (valid.length === 0) return
        const bound = store.messages.bindNativeIds(sid, valid)
        if (bound.length > 0) broadcastStoredMessages(sid, bound)
    }

    /** isReplay 回显确认（原 messages-acked 处理体）。先推进 lifecycle='acked' 再写
     *  metadata.nativeAckAt，共一时间戳（at）消除 nativeAckAt 与 lifecycle_at 分叉。
     *  广播以 advance ∪ mark 的 id 并集为准（getMessagesByIds 统一回读推进后快照）——
     *  两写的命中集不同：advance 只看 lifecycle='pushed'，mark 只看 nativeAckAt 缺失。
     *  交错/重复 acked fact 下可能只有一边有增量（如 nativeAckAt 已先行写入而 lifecycle
     *  仍 pushed），只按 mark 返回广播会让 advance 推进过的行不广播——Web 端 lifecycle
     *  停留 pushed 直到刷新。P1 双写：nativeAckAt 照常写（rewind 判据不动） */
    const processAcked = (sid: string, nativeId: string, ackedAt?: number) => {
        const at = ackedAt ?? Date.now()
        const advancedIds = store.messages.advanceMessagesAcked(sid, nativeId, at)
        const marked = store.messages.markMessagesAcked(sid, nativeId, at)
        const ids = new Set(advancedIds)
        for (const m of marked) ids.add(m.id)
        if (ids.size === 0) return
        const rows = store.messages.getMessagesByIds(sid, [...ids])
        if (rows.length > 0) broadcastStoredMessages(sid, rows)
    }

    /** attach 补写（原 messages-native-attached 处理体）：该会话所有缺 nativeSessionId 的行
     *  补上新 session id（幂等），补写行逐行广播（Web 端据此刷新 rewind 判据）。 */
    const processAttached = (sid: string, nativeSessionId: string) => {
        const attached = store.messages.attachNativeSessionId(sid, nativeSessionId)
        if (attached.length > 0) broadcastStoredMessages(sid, attached)
    }

    /** command_lifecycle 终态推进（messages-facts 新增 fact）：单调推进（终态不回退/不互覆）→
     *  fact.terminalReason 落档 metadata.terminalReason（与 nativeAckAt 双写同构，first-write-wins；
     *  只写本次推进命中的行——web footer 据此渲染终态原因，spec §7.6）→ 按 id 回读推进后的行
     *  → 逐行广播（载荷含推进后 lifecycle/lifecycleAt，P3 消费）。
     *  terminalReason 只在终态帧落档：processing（started 帧）捎带的 reason 是瞬时值，
     *  first-write-wins 会把它永久锁定、挡住后续真实终态原因。
     *  无命中（乱序/重复帧）静默返回，不广播。 */
    /** command_lifecycle 状态运行时白名单（socket 载荷不经 Zod，fact.state 运行时收窄；
     *  取值单源 @mobi/shared COMMAND_LIFECYCLE_STATES） */
    const COMMAND_LIFECYCLE_STATE_SET: ReadonlySet<string> = new Set(COMMAND_LIFECYCLE_STATES)

    const processLifecycleFact = (
        sid: string,
        nativeId: string,
        state: CommandLifecycleState,
        at: number,
        terminalReason?: string
    ) => {
        const ids = store.messages.advanceMessagesLifecycle(sid, nativeId, state, at)
        if (ids.length === 0) return
        if (state !== 'processing' && terminalReason) store.messages.markTerminalReason(sid, ids, terminalReason)
        const rows = store.messages.getMessagesByIds(sid, ids)
        if (rows.length > 0) broadcastStoredMessages(sid, rows)
    }

    /** command_lifecycle 已终态集合（与 advanceMessagesLifecycle 的 rank 4 终态同口径）：
     *  撤回守卫 1a——终态锚行的消息生命周期已收尾（已回答/已取消/已丢弃/已拒收），撤回不再适用 */
    const TERMINAL_LIFECYCLES: ReadonlySet<string> = new Set(['done', 'cancelled', 'discarded', 'refused'])

    /** 撤回事实（messages-facts withdrawn，#53 / 批次 A）：按 nativeId 定位未删批首行（min seq，
     *  合并批 1:N——collectBatch 可把多条消息并成一 push 共享 nativeId，取单行即可覆盖整批，
     *  I4）→ 软删守卫（1a/1b，任一命中静默跳过——撤回是尽力而为，跳过=消息保留=安全方向）→
     *  自锚行 seq 起软删除（无上界——撤回的是用户刚发的消息及其后派生行，竞态迟到行也属
     *  撤回范围，与 rewind 的「受理时点上界」语义有意不同）→ lifecycle 留档 withdrawn →
     *  SSE message-withdrawn（localId/blocks/originalText 供 web 乐观移除气泡并回填 composer；
     *  多行时取批内第一行——批 = 一次 push，用户视角是一条提交，composer 还原第一条）。
     *  定位失败（行不存在/已被撤回或 rewind 软删除）静默忽略：失败=消息残留。 */
    const processWithdrawnFact = (sid: string, nativeId: string, at: number) => {
        const rows = store.messages.getMessagesByNativeId(sid, nativeId)
        const first = rows[0]
        if (!first) return   // 无未删行：重复 fact / rewind 竞态天然幂等
        // 守卫 1a：锚行已终态——消息已收尾，撤回不再适用。advanceMessagesLifecycle 会拒绝
        // 终态→withdrawn 的留档，但软删除先于其执行且不可逆，必须在软删前拦截
        if (TERMINAL_LIFECYCLES.has(first.lifecycle ?? '')) {
            hubLogger.debug(`[messages-facts] withdrawn skipped: anchor already terminal (sid=${sid} nativeId=${nativeId} lifecycle=${first.lifecycle})`)
            return
        }
        // 守卫 1b：锚 seq 之后仍有 hub 层排队行——用户连发场景下 B 尚未到 CLI，
        // 无上界软删会把 B 一并删掉（跳过=整条撤回让位，B 保留）
        if (store.messages.hasQueuedMessagesAfter(sid, first.seq)) {
            hubLogger.debug(`[messages-facts] withdrawn skipped: queued rows exist after anchor (sid=${sid} nativeId=${nativeId} seq=${first.seq})`)
            return
        }
        store.messages.softDeleteMessagesFrom(sid, first.seq)
        store.messages.advanceMessagesLifecycle(sid, nativeId, 'withdrawn', at)
        const { blocks, originalText } = extractWithdrawnContent(first.content)
        onWebappEvent?.({
            type: 'message-withdrawn',
            sessionId: sid,
            localId: first.localId ?? first.id,
            blocks,
            originalText,
        })
    }

    // CLI→Hub 统一消息事实：批内多 kind 分发。
    // fact.at 缺省取 hub 接收时刻（每批一个 now，批内共时）
    socket.on('messages-facts', (data: { sid: string; facts: MessageFact[] }) => {
        if (!data || typeof data.sid !== 'string' || !Array.isArray(data.facts)) {
            return
        }
        const sessionAccess = resolveSessionAccess(data.sid)
        if (!sessionAccess.ok) {
            emitAccessError('session', data.sid, sessionAccess.reason)
            return
        }
        const now = Date.now()
        for (const fact of data.facts) {
            if (!fact || typeof fact.kind !== 'string') continue
            switch (fact.kind) {
                case 'pushed':
                    if (Array.isArray(fact.localIds)) {
                        processSubmitted(data.sid, fact.localIds, fact.at ?? now)
                    }
                    break
                case 'bound':
                    processBound(data.sid, [{
                        localId: fact.localId,
                        metadata: {
                            nativeId: fact.nativeId,
                            ...(fact.nativeSessionId ? { nativeSessionId: fact.nativeSessionId } : {})
                        }
                    }])
                    break
                case 'attached':
                    if (typeof fact.nativeSessionId === 'string' && fact.nativeSessionId.length > 0) {
                        processAttached(data.sid, fact.nativeSessionId)
                    }
                    break
                case 'acked':
                    if (typeof fact.nativeId === 'string' && fact.nativeId.length > 0) {
                        processAcked(data.sid, fact.nativeId, fact.at ?? now)
                    }
                    break
                case 'lifecycle':
                    if (typeof fact.nativeId === 'string' && fact.nativeId.length > 0
                        && COMMAND_LIFECYCLE_STATE_SET.has(fact.state)) {
                        // terminalReason 运行时收窄（socket 载荷不经 Zod）：非 string 视为缺省
                        const reason = typeof fact.terminalReason === 'string' && fact.terminalReason.length > 0
                            ? fact.terminalReason
                            : undefined
                        processLifecycleFact(data.sid, fact.nativeId, fact.state, fact.at ?? now, reason)
                    }
                    break
                case 'withdrawn':
                    if (typeof fact.nativeId === 'string' && fact.nativeId.length > 0) {
                        processWithdrawnFact(data.sid, fact.nativeId, fact.at ?? now)
                    }
                    break
            }
        }
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
