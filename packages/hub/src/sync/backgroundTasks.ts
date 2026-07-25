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
        } else if (input?.run_in_background === true && !input?.team_name) {
            // Bash/Agent 仅当 run_in_background === true 且非 team agent
            // team agent（有 team_name）由 teams.ts 管理，不纳入后台任务
            backgroundToolUseIds.set(toolUseId, bgToolName)
        }
    }
}

/**
 * 从消息内容中提取后台任务增量。
 * 后台任务增量来自 system 类型的消息（task_started / task_progress / task_notification / task_updated）。
 * - task_started：SDK 仅对后台任务 emit（同步任务不 emit，见 sdk.d.ts SDKTaskStartedMessage），
 *   故 task_id 即后台标识。tool_use_id 仅用于从 backgroundToolUseIds 推断 toolName——
 *   /code-review custom command 等 SDK 内部启动的 background subagent 无主 agent tool_use，
 *   task_started.tool_use_id 为空，也必须创建 delta，否则前端永远感知不到。
 * - task_progress / task_notification / task_updated 仅当 taskId 在 knownTaskIds 中时才创建 delta
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
        // team agent（in_process_teammate）由 teams.ts 管理，不纳入后台任务
        const taskType = asString(data.task_type)
        if (taskType === 'in_process_teammate') return null

        const taskId = asString(data.task_id)
        if (!taskId) return null

        const toolUseId = asString(data.tool_use_id) ?? null

        // SDK 的 task_started 本就是 background task 标识（同步任务不 emit task_started），
        // 见 sdk.d.ts SDKTaskStartedMessage。原先要求 tool_use_id 命中 backgroundToolUseIds
        // （主 agent 显式调过 Bash/Agent 且 run_in_background=true），误杀了 /code-review 等 SDK 内部
        // 启动、无主 tool_use 的 background subagent——它们 task_started.tool_use_id 为空。
        // 现仅用 backgroundToolUseIds 推断 toolName，不再作为准入条件。

        const description = asString(data.description) ?? ''
        const subagentType = asString(data.subagent_type) ?? undefined

        // toolName 推断：优先用 backgroundToolUseIds（主 agent tool_use，可识别 Monitor），
        // 兜底用 subagent_type（有则 Agent，无则 Bash）
        let toolName: BackgroundToolName
        if (toolUseId && backgroundToolUseIds?.has(toolUseId)) {
            toolName = backgroundToolUseIds.get(toolUseId)!
        } else if (subagentType) {
            toolName = 'Agent'
        } else {
            toolName = 'Bash'
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

        // summary 仅在 agentProgressSummaries 开启时有值，否则用 description 兜底
        const summary = asString(data.summary) || asString(data.description) || undefined

        return { type: 'progress', taskId, metrics, summary }
    }

    // 后台任务完成/失败/停止：可能通过 task_notification 或 task_updated 到达
    // - task_notification：携带 data.status 和 data.summary（Agent 任务典型路径）
    // - task_updated：携带 data.patch.status（Bash 后台任务典型路径，也可用于其他类型）
    if (subtype === 'task_notification' || subtype === 'task_updated') {
        const taskId = asString(data.task_id)
        if (!taskId) return null

        // 过滤非后台任务
        if (knownTaskIds !== undefined && !knownTaskIds.has(taskId)) return null

        // task_notification 从 data.status 取终态，task_updated 从 data.patch.status 取终态
        const status = subtype === 'task_notification'
            ? asString(data.status)
            : asString((isObject(data.patch) ? data.patch : null)?.status)
        if (status !== 'completed' && status !== 'failed' && status !== 'stopped') return null

        // task_notification 从 data.summary 取，task_updated 优先从 data.patch.summary 取
        const summary = (subtype === 'task_updated'
            ? asString((isObject(data.patch) ? data.patch : null)?.summary)
            : null) || asString(data.summary) || undefined

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
            const idx = tasks.findIndex(t => t.taskId === delta.taskId)
            if (idx < 0) {
                // 无匹配任务（消息乱序）：创建最小终态条目
                tasks.push({
                    taskId: delta.taskId,
                    toolUseId: null,
                    toolName: 'Bash',
                    description: '',
                    startedAt: 0,
                    status: delta.status,
                    ...(delta.summary !== undefined ? { summary: delta.summary } : {}),
                    completedAt: Date.now(),
                })
            } else {
                tasks[idx] = {
                    ...tasks[idx],
                    status: delta.status,
                    ...(delta.summary !== undefined ? { summary: delta.summary } : {}),
                    completedAt: Date.now(),
                }
            }
            return tasks
        }
    }
}
