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

import type { RuntimeState } from '@mobi/shared/types'

import type { Store } from '../store'
import type { BackgroundTaskTracker } from './backgroundTaskTracker'
import {
    applyBackgroundTaskDelta,
    collectBackgroundToolUseIds,
    extractBackgroundTaskDeltasFromMessageContent,
    extractBackgroundTaskIdsFromMessageContent,
    extractExcludedTaskStartedIds,
    type BackgroundToolName,
} from './backgroundTasks'
import { applyTaskDelta, extractTaskDeltasFromMessageContent, PendingTaskMap } from './tasks'
import {
    applyTeamStateDelta,
    extractTeamMemberCompletionFromMessageContent,
    extractTeamStateFromMessageContent,
    extractTeamSystemDeltasFromMessageContent,
} from './teams'
import { extractTodoWriteTodosFromMessageContent } from './todos'

export type SessionMessageRuntimeProjectionInput = {
    sessionId: string
    namespace: string
    content: unknown
}

/**
 * 将持久化消息投影为会话 runtimeState。
 *
 * 每个 CLI Socket 连接必须持有独立实例：实例内的 Map/Set 用来跨消息配对
 * tool_use/tool_result 以及追踪后台任务，其生命周期与连接一致。
 *
 * project 在完成存储后返回应按顺序发布的状态快照。后台任务全部终态时会返回
 * 两个快照：先是含终态的状态，再是清除 backgroundTasks 后的状态。
 */
export class SessionMessageRuntimeProjector {
    private readonly pendingTaskMap = new PendingTaskMap()
    private readonly backgroundToolUseIds = new Map<string, BackgroundToolName>()
    private readonly backgroundTaskIds = new Set<string>()
    private readonly filteredTaskIds = new Set<string>()
    private readonly now: () => number

    constructor(
        private readonly store: Store,
        private readonly backgroundTaskTracker: BackgroundTaskTracker,
        options?: { now?: () => number },
    ) {
        this.now = options?.now ?? Date.now
    }

    project(input: SessionMessageRuntimeProjectionInput): RuntimeState[] {
        const { sessionId, namespace, content } = input
        const existingSession = this.store.sessions.getSession(sessionId)
        if (!existingSession || existingSession.namespace !== namespace) return []

        const existingRuntimeState: RuntimeState = {
            ...((existingSession.runtimeState as RuntimeState) ?? {}),
        }

        // 常规 task 的 tool_use/tool_result 依赖连接级 pending map 跨消息配对。
        const todos = extractTodoWriteTodosFromMessageContent(content)
        const taskDeltas = extractTaskDeltasFromMessageContent(content, this.pendingTaskMap)
        const teamDelta = extractTeamStateFromMessageContent(content)

        // 必须先收集 tool_use，后到的 task_started 才能根据 run_in_background 判定。
        collectBackgroundToolUseIds(content, this.backgroundToolUseIds)

        // 连接重建后内存集合为空，已持久化的任务 ID 用来防止降级补建覆盖。
        const persistedTaskIds: ReadonlySet<string> = new Set(
            existingRuntimeState.backgroundTasks?.map(task => task.taskId) ?? [],
        )

        // background_tasks_changed 是权威全量集合，必须在 task_started 提取前 replace。
        const activeBackgroundIds = extractBackgroundTaskIdsFromMessageContent(content)
        if (activeBackgroundIds !== null) {
            this.backgroundTaskTracker.replace(sessionId, activeBackgroundIds.ids)
            this.filteredTaskIds.clear()
            for (const id of activeBackgroundIds.filteredIds) this.filteredTaskIds.add(id)
        }
        for (const id of extractExcludedTaskStartedIds(content)) this.filteredTaskIds.add(id)

        const backgroundTaskDelta = extractBackgroundTaskDeltasFromMessageContent(
            content,
            this.backgroundToolUseIds,
            this.backgroundTaskIds,
            this.backgroundTaskTracker.getActive(sessionId),
            persistedTaskIds,
            this.filteredTaskIds,
        )

        if (backgroundTaskDelta?.type === 'started') {
            if (backgroundTaskDelta.task.toolUseId) {
                this.backgroundToolUseIds.delete(backgroundTaskDelta.task.toolUseId)
            }
            this.backgroundTaskIds.add(backgroundTaskDelta.task.taskId)
        } else if (backgroundTaskDelta?.type === 'completed') {
            this.backgroundTaskIds.delete(backgroundTaskDelta.taskId)
        }

        const teamSystemDelta = extractTeamSystemDeltasFromMessageContent(
            content,
            existingRuntimeState.teamState,
        )
        const teamCompletionDelta = extractTeamMemberCompletionFromMessageContent(
            content,
            existingRuntimeState.teamState,
        )

        if (
            !todos
            && taskDeltas.length === 0
            && !teamDelta
            && !backgroundTaskDelta
            && !teamSystemDelta
            && !teamCompletionDelta
        ) {
            return []
        }

        if (todos) existingRuntimeState.todos = todos

        // team 必须先更新，下方新建 task 才能标记正确的 teamName。
        if (teamDelta) {
            const existingTeamState = existingRuntimeState.teamState ?? null
            const deletedTeamName = teamDelta._action === 'delete' && existingTeamState
                ? existingTeamState.teamName
                : null

            existingRuntimeState.teamState = applyTeamStateDelta(
                existingTeamState,
                teamDelta,
                sessionId,
            ) ?? undefined

            if (deletedTeamName && existingRuntimeState.tasks) {
                existingRuntimeState.tasks = existingRuntimeState.tasks.map(task =>
                    task.metadata?._teamName === deletedTeamName
                        && task.status !== 'completed'
                        && task.status !== 'deleted'
                        ? { ...task, status: 'completed' as const }
                        : task
                )
            }
        }

        if (teamSystemDelta) {
            existingRuntimeState.teamState = applyTeamStateDelta(
                existingRuntimeState.teamState ?? null,
                teamSystemDelta,
                sessionId,
            ) ?? undefined
        }

        if (teamCompletionDelta) {
            existingRuntimeState.teamState = applyTeamStateDelta(
                existingRuntimeState.teamState ?? null,
                teamCompletionDelta,
                sessionId,
            ) ?? undefined
        }

        for (const taskDelta of taskDeltas) {
            existingRuntimeState.tasks = applyTaskDelta(existingRuntimeState.tasks, taskDelta)
        }

        if (existingRuntimeState.teamState && existingRuntimeState.tasks) {
            const currentTeamName = existingRuntimeState.teamState.teamName
            const createdIds = new Set(
                taskDeltas
                    .filter((delta): delta is Extract<typeof delta, { type: 'create' }> => delta.type === 'create')
                    .map(delta => delta.task.id),
            )
            if (createdIds.size > 0) {
                existingRuntimeState.tasks = existingRuntimeState.tasks.map(task =>
                    createdIds.has(task.id)
                        ? { ...task, metadata: { ...task.metadata, _teamName: currentTeamName } }
                        : task
                )
            }
        }

        if (backgroundTaskDelta) {
            existingRuntimeState.backgroundTasks = applyBackgroundTaskDelta(
                existingRuntimeState.backgroundTasks,
                backgroundTaskDelta,
            )
        }

        const shouldAutoClearBackgroundTasks = existingRuntimeState.backgroundTasks
            ?.every(task => task.status !== 'running')

        if (existingRuntimeState.tasks
            ?.every(task => task.status === 'completed' || task.status === 'deleted')) {
            delete existingRuntimeState.tasks
        }
        if (existingRuntimeState.todos?.every(todo => todo.status === 'completed')) {
            delete existingRuntimeState.todos
        }

        const publications: RuntimeState[] = []
        const updated = this.store.sessions.setRuntimeState(
            sessionId,
            existingRuntimeState,
            this.now(),
            namespace,
        )
        if (updated) publications.push({ ...existingRuntimeState })

        if (updated && shouldAutoClearBackgroundTasks && existingRuntimeState.backgroundTasks) {
            delete existingRuntimeState.backgroundTasks
            const cleared = this.store.sessions.setRuntimeState(
                sessionId,
                existingRuntimeState,
                this.now(),
                namespace,
            )
            if (cleared) publications.push({ ...existingRuntimeState })
        }

        return publications
    }
}
