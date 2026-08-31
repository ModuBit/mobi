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

import { asNumber, asString, isObject, extractLiveBackgroundTaskIds } from '@mobi/shared'
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
 * background_tasks_changed 提取结果。
 * - ids：活跃后台任务 id 集合（REPLACE 语义整体替换）
 * - filteredIds：本条消息中被过滤（ambient 家务）的 taskId——调用方据此维护被滤集合，
 *   防被滤任务经 task_updated patch.is_backgrounded 豁免通道复活
 */
export type BackgroundTaskIdsExtraction = {
    ids: Set<string>
    filteredIds: Set<string>
}

/**
 * 从 system:background_tasks_changed 消息中提取活跃后台任务 id 集合。
 * SDK 文档（sdk.d.ts SDKBackgroundTasksChangedMessage）：携带全部活跃后台任务的
 * {task_id, task_type, description} 数组，客户端应**整体替换**（replace 语义）自己的集合，
 * 而非增量合并——任务完成/停止后它会从集合中移除，但 backgroundTasks 记录本身仍保留供面板展示终态。
 *
 * 返回 null 表示该消息不是 background_tasks_changed（调用方无需维护集合）。
 */
export function extractBackgroundTaskIdsFromMessageContent(
    content: unknown,
): BackgroundTaskIdsExtraction | null {
    const record = unwrapRoleWrappedRecordEnvelope(content)
    if (!record) return null

    // 仅处理 role === 'agent' 的消息
    if (record.role !== 'agent') return null

    const msgContent = record.content
    if (!isObject(msgContent) || msgContent.type !== 'output') return null

    const data = isObject(msgContent.data) ? msgContent.data : null
    if (!data || data.type !== 'system') return null

    const subtype = asString(data.subtype)
    if (subtype !== 'background_tasks_changed') return null

    // 存活集合规则（task_id 非空字符串 + 跳过 ambient）单源于 shared 的 extractLiveBackgroundTaskIds
    const ids = extractLiveBackgroundTaskIds(data.tasks)
    // 被滤条目单独收集：ambient 家务任务对下游 deltas 是「不得复活」的黑名单而非不存在
    const filteredIds = new Set<string>()
    const tasks = Array.isArray(data.tasks) ? data.tasks : []
    for (const item of tasks) {
        if (!isObject(item) || item.ambient !== true) continue
        const taskId = asString(item.task_id)
        if (taskId) filteredIds.add(taskId)
    }
    return { ids, filteredIds }
}

/**
 * task_started 消息中被 hub 判定为「入口丢弃」的 taskId（ambient 家务 / in_process_teammate，
 * spec D1/D2）。两处共用同一判定：deltas 提取的 task_started 过滤、以及调用方维护被滤集合。
 * 非丢弃（或 taskId 缺失/非字符串）返回 null。
 */
function droppedTaskStartedId(data: Record<string, unknown>): string | null {
    if (data.ambient !== true && asString(data.task_type) !== 'in_process_teammate') return null
    return asString(data.task_id) ?? null
}

/**
 * 从 task_started 消息中提取被 hub 过滤丢弃（ambient / in_process_teammate）的 taskId 集合。
 * 调用方（sessionHandlers）将结果并入连接级 filteredTaskIds，作为 deltas 提取的
 * excludedTaskIds——这些任务不得经 task_updated patch.is_backgrounded 豁免通道补建/直落终态。
 * 非 task_started 消息返回空集合。
 */
export function extractExcludedTaskStartedIds(content: unknown): Set<string> {
    const excluded = new Set<string>()
    const record = unwrapRoleWrappedRecordEnvelope(content)
    if (!record || record.role !== 'agent') return excluded

    const msgContent = record.content
    if (!isObject(msgContent) || msgContent.type !== 'output') return excluded

    const data = isObject(msgContent.data) ? msgContent.data : null
    if (!data || data.type !== 'system' || asString(data.subtype) !== 'task_started') return excluded

    const taskId = droppedTaskStartedId(data)
    if (taskId) excluded.add(taskId)
    return excluded
}

/**
 * 从消息内容中提取后台任务增量。
 * 后台任务增量来自 system 类型的消息（task_started / task_progress / task_notification / task_updated）。
 * - task_started：SDK 对**所有** Bash/Agent 任务（无论前后台）都 emit，task_started 本身不代表后台。
 *   后台判定（isBackground）：
 *     a. task_id ∈ activeBackgroundTaskIds（background_tasks_changed 权威后台集合）
 *     b. tool_use_id 命中 backgroundToolUseIds（主 agent 显式 run_in_background=true，覆盖 CLI 重启等
 *        bg_changed 未 emit 的边界）
 *     c. data.is_backgrounded === true（SDK 显式后台标记，0.3.238+，覆盖无集合无入参的新边界）
 *   三信号皆不命中 → 前台任务，不创建 delta（这正是修复「前台任务被识别成后台」的根因）。
 * - task_progress / task_notification / task_updated 默认仅当 taskId 在 knownTaskIds 中时才创建 delta；
 *   唯一豁免是 task_updated 携带 patch.is_backgrounded=true：该任务可能本就不在集合中
 *   （task_started 时被判前台丢弃的同款盲区，spec D3），终态直落 completed 分支、
 *   非终态在「taskId 不在已知集合」前提下补建 started（防正常追踪中的后台任务被降级覆盖）
 * - persistedTaskIds：已持久化的 backgroundTasks taskId（hub 重启/CLI 重连后连接级 knownTaskIds
 *   清空且不从 DB 回种），补建守卫同 knownTaskIds 一起挡住持久化的真实条目被降级覆盖
 * - excludedTaskIds：被 hub 过滤丢弃的任务（ambient 家务 / in_process_teammate）——
 *   is_backgrounded 豁免通道（补建 + 终态直落）命中即 return null，防 running 幽灵卡复活
 */
export function extractBackgroundTaskDeltasFromMessageContent(
    content: unknown,
    backgroundToolUseIds?: Map<string, BackgroundToolName>,
    knownTaskIds?: Set<string>,
    activeBackgroundTaskIds?: ReadonlySet<string>,
    persistedTaskIds?: ReadonlySet<string>,
    excludedTaskIds?: ReadonlySet<string>,
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

    // task_started：任务启动（SDK 对前后台任务都 emit，需组合判定是否后台）
    if (subtype === 'task_started') {
        // 家务任务当作不存在（spec D1/D2）；置于一切判定之前
        if (data.ambient === true) return null

        // team agent（in_process_teammate）由 teams.ts 管理，不纳入后台任务
        const taskType = asString(data.task_type)
        if (taskType === 'in_process_teammate') return null

        const taskId = asString(data.task_id)
        if (!taskId) return null

        const toolUseId = asString(data.tool_use_id) ?? null

        // 后台判定：task_id ∈ activeBackgroundTaskIds（background_tasks_changed 权威集合）
        //       ∪ tool_use_id 命中 backgroundToolUseIds（主 agent 显式 run_in_background=true）
        // SDK 对所有 Bash/Agent 任务（无论前后台）都 emit task_started，background_tasks_changed
        // 是「本任务是否后台」的可靠依据；run_in_background 兜底覆盖 bg_changed 未 emit 的边界
        //（CLI 进程重启后 SDK 不 emit bg_changed，见 sdk.d.ts SDKBackgroundTasksChangedMessage）。
        const isBackground =
            (activeBackgroundTaskIds !== undefined && activeBackgroundTaskIds.has(taskId))
            || (toolUseId !== null && backgroundToolUseIds?.has(toolUseId) === true)
            // SDK 显式后台标记（0.3.238+，仅 local_agent/local_bash 设置）——第三 OR 信号，
            // 覆盖「集合未收到 + 无 tool_use_id 入参」的新边界（spec D3）
            || data.is_backgrounded === true

        // 前台任务：不是后台 → 不创建 started delta（修复「前台任务被识别成后台」的根因）
        if (!isBackground) return null

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
            isBackground: true,
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

        // task_updated 从 data.patch 取字段（终态与中途后台化补建共用提取）
        const patch = subtype === 'task_updated' ? (isObject(data.patch) ? data.patch : null) : null

        // task_notification 从 data.status 取终态，task_updated 从 data.patch.status 取终态。
        // SDKTaskUpdatedMessage.patch.status 的终止值是 'killed'（用户停止单个后台任务）——
        // BackgroundTaskItem.status 枚举无 killed，映射为 'stopped'（同义终态），
        // 否则无终态 delta → web 卡片永停 running 转圈、后台集合不清除
        const rawStatus = subtype === 'task_notification'
            ? asString(data.status)
            : asString(patch?.status)
        const status = rawStatus === 'killed' ? 'stopped' : rawStatus
        const isTerminal = status === 'completed' || status === 'failed' || status === 'stopped'

        // task_updated 携带的 SDK 显式后台标记：既是补建/豁免判定信号，也是下方
        // knownTaskIds 过滤的豁免条件。task_notification 无 patch，恒 false
        const patchExplicitBg = patch?.is_backgrounded === true

        // 被滤任务（ambient 家务 / in_process_teammate）不得经 is_backgrounded 豁免通道复活：
        // 正常路径由下方 knownTaskIds 过滤兜底，豁免通道（补建 + 终态直落）须显式拦截
        if (patchExplicitBg && excludedTaskIds?.has(taskId) === true) return null

        // ===== 终局分流（terminal-first）=====

        if (!isTerminal) {
            // 中途后台化补建（spec D3）：前台任务 task_started 时被丢（判前台 return null），
            // 事后转后台经 patch.is_backgrounded 到达且不会再有 task_started——仅对盲区任务补建。
            // 已在 knownTaskIds 中的任务（写侧 started delta 会收录）说明已被 task_started 正常追踪，
            // 携带真实 toolUseId/subagentType/toolName；persistedTaskIds 同理覆盖 hub 重启/CLI 重连后
            // 连接级集合清空的场景——两者任一命中即跳过补建，避免持久化的真实条目被降级条目整体覆盖
            if (patchExplicitBg
                && knownTaskIds?.has(taskId) !== true
                && persistedTaskIds?.has(taskId) !== true) {
                // patch 不携带 tool_use_id/subagent_type（sdk.d.ts SDKTaskUpdatedMessage），
                // 补建条目无法确证工具类型 → toolName 诚实降级为 'unknown'（不冒充 Bash）；
                // status 从 patch.status 诚实映射（枚举无 pending，paused 是最近的诚实表达）
                const patchStatus = asString(patch?.status)
                const rebuiltStatus: BackgroundTaskItem['status']
                    = patchStatus === 'paused' || patchStatus === 'pending' ? 'paused' : 'running'
                return {
                    type: 'started',
                    task: {
                        taskId,
                        toolUseId: null,
                        toolName: 'unknown',
                        description: asString(patch.description) ?? '',
                        status: rebuiltStatus,
                        isBackground: true,
                        startedAt: Date.now(),
                    },
                }
            }

            // 其余非终态：非补建路径一律不产 delta（已追踪任务的进行中增量本就不经此 subtype 合并）
            return null
        }

        // 终态直落 completed。
        // patchExplicitBg 时跳过 knownTaskIds 过滤：SDK 已显式标注后台，且该任务可能本就不在
        // knownTaskIds 中（task_started 时被判前台丢弃的同款盲区，spec D3），无需集合背书
        if (!patchExplicitBg && knownTaskIds !== undefined && !knownTaskIds.has(taskId)) {
            return null
        }

        // task_notification 从 data.summary 取，task_updated 优先从 data.patch.summary 取
        const summary = (subtype === 'task_updated'
            ? asString(patch?.summary)
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
                    status: delta.status,
                    isBackground: true,
                    startedAt: 0,
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
