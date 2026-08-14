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

import type { Session, WorktreeMetadata } from './schemas'

export type SessionSummaryMetadata = {
    name?: string
    path: string
    machineId?: string
    summary?: { text: string }
    flavor?: string | null
    worktree?: WorktreeMetadata
}

export type SessionSummary = {
    id: string
    active: boolean
    running: boolean
    activeAt: number
    updatedAt: number
    metadata: SessionSummaryMetadata | null
    todoProgress: { completed: number; total: number } | null
    taskProgress: { completed: number; total: number } | null
    pendingRequestsCount: number
    model?: string | null
    mode?: 'local' | 'remote'
    /** 会话置顶（true = 进「置顶」分组） */
    pinned?: boolean
}

export function toSessionSummary(session: Session): SessionSummary {
    const pendingRequestsCount = session.agentState?.requests ? Object.keys(session.agentState.requests).length : 0

    const metadata: SessionSummaryMetadata | null = session.metadata ? {
        name: session.metadata.name,
        path: session.metadata.path,
        machineId: session.metadata.machineId ?? undefined,
        summary: session.metadata.summary ? { text: session.metadata.summary.text } : undefined,
        flavor: session.metadata.flavor ?? null,
        worktree: session.metadata.worktree
    } : null

    const todoProgress = session.runtimeState?.todos?.length ? {
        completed: session.runtimeState.todos.filter(t => t.status === 'completed').length,
        total: session.runtimeState.todos.length
    } : null

    const taskProgress = session.runtimeState?.tasks?.length ? {
        completed: session.runtimeState.tasks.filter(t => t.status === 'completed').length,
        total: session.runtimeState.tasks.length
    } : null

    return {
        id: session.id,
        active: session.active,
        running: session.running,
        activeAt: session.activeAt,
        updatedAt: session.updatedAt,
        metadata,
        todoProgress,
        taskProgress,
        pendingRequestsCount,
        model: session.runtimeState?.model,
        mode: session.mode,
        pinned: session.pinned,
    }
}
