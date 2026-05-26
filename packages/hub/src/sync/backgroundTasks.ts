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

import { asNumber, asString, isObject } from '@mobi/shared'
import { unwrapRoleWrappedRecordEnvelope } from '@mobi/shared/messages'
import type { BackgroundTaskItem } from '@mobi/shared'

export type { BackgroundTaskItem }

/** 后台任务的 Agent 指标 */
export type AgentMetrics = {
    tokens: number
    toolUses: number
    durationMs: number
}

/** 后台任务变更增量 */
export type BackgroundTaskDelta =
    | { type: 'started'; task: BackgroundTaskItem }
    | { type: 'progress'; taskId: string; metrics: AgentMetrics; summary?: string }
    | { type: 'completed'; taskId: string; status: 'completed' | 'failed' | 'stopped'; summary?: string }

/**
 * 根据 subagent_type 推断工具名称。
 * 若 subagent_type 非空则为 Agent，否则为 Bash。
 */
export function inferToolName(data: Record<string, unknown>): 'Agent' | 'Bash' {
    const subagentType = asString(data.subagent_type)
    return subagentType ? 'Agent' : 'Bash'
}

/**
 * 从消息内容中提取后台任务增量。
 * 后台任务增量来自 system 类型的消息（task_started / task_progress / task_notification）。
 */
export function extractBackgroundTaskDeltasFromMessageContent(
    content: unknown,
): BackgroundTaskDelta | null {
    const record = unwrapRoleWrappedRecordEnvelope(content)
    if (!record) return null

    // 仅处理 role === 'agent' 的消息
    if (record.role !== 'agent') return null

    const msgContent = record.content
    if (!isObject(msgContent) || msgContent.type !== 'output') return null

    const data = isObject(msgContent.data) ? msgContent.data : null
    if (!data || data.type !== 'system') return null

    const subtype = asString(data.subtype)

    // task_started：后台任务启动
    if (subtype === 'task_started') {
        const taskId = asString(data.task_id)
        if (!taskId) return null

        const description = asString(data.description) ?? ''
        const toolUseId = asString(data.tool_use_id) ?? null
        const toolName = inferToolName(data)
        const subagentType = asString(data.subagent_type) ?? undefined

        const task: BackgroundTaskItem = {
            taskId,
            toolUseId,
            toolName,
            description,
            subagentType,
            status: 'running',
            startedAt: Date.now(),
        }

        return { type: 'started', task }
    }

    // task_progress：后台任务进度更新
    if (subtype === 'task_progress') {
        const taskId = asString(data.task_id)
        if (!taskId) return null

        const usage = isObject(data.usage) ? data.usage : null
        const metrics: AgentMetrics = {
            tokens: asNumber(usage?.total_tokens) ?? 0,
            toolUses: asNumber(usage?.tool_uses) ?? 0,
            durationMs: asNumber(usage?.duration_ms) ?? 0,
        }

        const summary = asString(data.summary) ?? undefined

        return { type: 'progress', taskId, metrics, summary }
    }

    // task_notification：后台任务完成/失败/停止
    if (subtype === 'task_notification') {
        const taskId = asString(data.task_id)
        if (!taskId) return null

        const status = asString(data.status)
        if (status !== 'completed' && status !== 'failed' && status !== 'stopped') return null

        const summary = asString(data.summary) ?? undefined

        return { type: 'completed', taskId, status, summary }
    }

    // 其他 system 子类型不涉及后台任务
    return null
}

/**
 * 将后台任务增量应用到现有列表。
 * - started：按 taskId upsert（新增或覆盖）
 * - progress：按 taskId 查找并合并 metrics 和 summary
 * - completed：按 taskId 从列表中移除
 */
export function applyBackgroundTaskDelta(
    existing: BackgroundTaskItem[] | undefined,
    delta: BackgroundTaskDelta,
): BackgroundTaskItem[] {
    const tasks = existing ? [...existing] : []

    switch (delta.type) {
        case 'started': {
            // upsert：存在则覆盖，不存在则添加
            const idx = tasks.findIndex(t => t.taskId === delta.task.taskId)
            if (idx >= 0) {
                tasks[idx] = delta.task
            } else {
                tasks.push(delta.task)
            }
            return tasks
        }

        case 'progress': {
            // 合并 metrics 和 summary 到已有任务
            return tasks.map(t => {
                if (t.taskId !== delta.taskId) return t
                return {
                    ...t,
                    metrics: delta.metrics,
                    ...(delta.summary !== undefined ? { summary: delta.summary } : {}),
                }
            })
        }

        case 'completed': {
            // 移除已完成的任务
            return tasks.filter(t => t.taskId !== delta.taskId)
        }
    }
}
