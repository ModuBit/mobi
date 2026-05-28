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

/** 后台工具名称 */
export type BackgroundToolName = 'Bash' | 'Agent' | 'Monitor'

/**
 * 工具名称 → 后台工具名称映射。
 * SDK tool_use block 的 name 字段与 BackgroundTaskItem.toolName 的对应关系。
 */
const TOOL_NAME_MAP: Record<string, BackgroundToolName | undefined> = {
    Bash: 'Bash',
    Agent: 'Agent',
    Monitor: 'Monitor',
}

/**
 * 从 assistant 消息中收集后台工具的 toolUseId。
 * 判定条件：
 *   - Bash: input.run_in_background === true
 *   - Agent: input.run_in_background === true
 *   - Monitor: 始终后台（无 run_in_background 字段）
 *
 * 结果存入 backgroundToolUseIds Map（key=toolUseId, value=toolName）。
 */
export function collectBackgroundToolUseIds(
    content: unknown,
    backgroundToolUseIds: Map<string, BackgroundToolName>,
): void {
    const record = unwrapRoleWrappedRecordEnvelope(content)
    if (!record) return

    const msgContent = record.content
    if (!isObject(msgContent) || msgContent.type !== 'output') return

    // 仅处理 assistant 消息（含 tool_use blocks），通过 data.type 判断而非外层 role
    // CLI 将所有消息包装为 role:'agent'，实际类型由 data.type 区分
    const data = isObject(msgContent.data) ? msgContent.data : null
    if (!data || data.type !== 'assistant') return

    const message = isObject(data.message) ? data.message : null
    if (!message) return

    const blocks = message.content
    if (!Array.isArray(blocks)) return

    for (const block of blocks) {
        if (!isObject(block) || block.type !== 'tool_use') continue

        const toolUseId = typeof block.id === 'string' ? block.id : null
        if (!toolUseId) continue

        const rawName = typeof block.name === 'string' ? block.name : null
        const bgToolName = rawName ? TOOL_NAME_MAP[rawName] : undefined
        if (!bgToolName) continue

        const input = isObject(block.input) ? block.input : null

        if (bgToolName === 'Monitor') {
            // Monitor 始终后台
            backgroundToolUseIds.set(toolUseId, 'Monitor')
        } else if (input?.run_in_background === true) {
            // Bash/Agent 仅当 run_in_background === true
            backgroundToolUseIds.set(toolUseId, bgToolName)
        }
    }
}

/**
 * 从消息内容中提取后台任务增量。
 * 后台任务增量来自 system 类型的消息（task_started / task_progress / task_notification）。
 * - task_started 仅当 tool_use_id 在 backgroundToolUseIds 中时才创建 delta
 * - task_progress / task_notification 仅当 taskId 在 knownTaskIds 中时才创建 delta
 */
export function extractBackgroundTaskDeltasFromMessageContent(
    content: unknown,
    backgroundToolUseIds?: Map<string, BackgroundToolName>,
    knownTaskIds?: Set<string>,
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

        const toolUseId = asString(data.tool_use_id) ?? null

        // 检查是否为后台任务
        if (backgroundToolUseIds !== undefined) {
            if (!toolUseId || !backgroundToolUseIds.has(toolUseId)) return null
        }

        const description = asString(data.description) ?? ''
        const subagentType = asString(data.subagent_type) ?? undefined

        // 使用收集到的 toolName，兜底用 subagent_type 推断（向后兼容：无 Map 时无法识别 Monitor）
        let toolName: BackgroundToolName = subagentType ? 'Agent' : 'Bash'
        if (toolUseId && backgroundToolUseIds?.has(toolUseId)) {
            toolName = backgroundToolUseIds.get(toolUseId)!
        }

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

        // 过滤非后台任务
        if (knownTaskIds !== undefined && !knownTaskIds.has(taskId)) return null

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

        // 过滤非后台任务
        if (knownTaskIds !== undefined && !knownTaskIds.has(taskId)) return null

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
 * - completed：按 taskId 标记为终态（供 Web 端检测状态变化后自行清理）
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
            // 标记任务为终态（不移除），供 Web 端检测状态变化后自行清理
            return tasks.map(t => {
                if (t.taskId !== delta.taskId) return t
                return {
                    ...t,
                    status: delta.status,
                    ...(delta.summary !== undefined ? { summary: delta.summary } : {}),
                    completedAt: Date.now(),
                }
            })
        }
    }
}
