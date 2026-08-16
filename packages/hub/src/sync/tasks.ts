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

import { isObject } from '@mobi/shared'
import { unwrapOutputMessage, type UnwrappedOutputMessage } from '@mobi/shared/messages'
import { TaskItemSchema, TasksSchema } from '@mobi/shared/schemas'
import type { TaskItem } from '@mobi/shared/types'

export { TaskItemSchema, TasksSchema }
export type { TaskItem }

/** Task 工具名称集合 */
const TASK_TOOL_NAMES = new Set(['TaskCreate', 'TaskUpdate', 'TaskList', 'TaskGet', 'TaskStop', 'TaskOutput'])

/** 只读工具名称集合（tool_result 中包含完整数据，不改变 task 状态） */
const READONLY_TOOL_NAMES = new Set(['TaskList', 'TaskGet', 'TaskOutput'])

/** 暂存条目：tool_use 中的工具名和输入参数 */
export interface PendingEntry {
    toolName: string
    input: Record<string, unknown>
}

/**
 * 暂存 map，session 连接级别实例。
 * assistant 消息中的 tool_use 先暂存，user 消息中的 tool_result 再配对提取。
 */
export class PendingTaskMap {
    private readonly pending = new Map<string, PendingEntry>()
    private readonly readOnlyNames = new Map<string, string>()

    /** 暂存 tool_use 的输入参数 */
    saveToolUse(toolUseId: string, toolName: string, input: Record<string, unknown>): void {
        this.pending.set(toolUseId, { toolName, input })
    }

    /** 暂存只读工具名称（TaskList/TaskGet，不需要 input 配对） */
    saveReadOnlyToolName(toolUseId: string, toolName: string): void {
        this.readOnlyNames.set(toolUseId, toolName)
    }

    /** 获取暂存的 tool_use 条目 */
    get(toolUseId: string): PendingEntry | undefined {
        return this.pending.get(toolUseId)
    }

    /** 获取只读工具名称 */
    getToolName(toolUseId: string): string | undefined {
        return this.readOnlyNames.get(toolUseId)
    }

    /** 删除暂存条目 */
    delete(toolUseId: string): void {
        this.pending.delete(toolUseId)
        this.readOnlyNames.delete(toolUseId)
    }
}

/** Task 变更增量 */
export type TaskDelta =
    | { type: 'create'; task: TaskItem }
    | { type: 'update'; taskId: string; updates: Record<string, unknown> }
    | { type: 'calibration'; tasks: TaskItem[] }
    | { type: 'single-calibration'; task: TaskItem }

/** 从可能为字符串或对象的内容中安全解析 JSON */
function parseContentAsJson(content: unknown): unknown {
    if (isObject(content)) return content
    if (typeof content === 'string') {
        try {
            return JSON.parse(content)
        } catch {
            return null
        }
    }
    return null
}

/** 从 assistant 消息的 content blocks 中提取 tool_use 块并暂存 */
function processAssistantToolUses(
    blocks: unknown[] | null,
    pendingMap: PendingTaskMap
): void {
    if (!blocks) return

    for (const block of blocks) {
        if (!isObject(block) || block.type !== 'tool_use') continue
        const name = typeof block.name === 'string' ? block.name : null
        if (!name || !TASK_TOOL_NAMES.has(name)) continue

        const toolUseId = typeof block.id === 'string' ? block.id : null
        if (!toolUseId) continue

        if (READONLY_TOOL_NAMES.has(name)) {
            // 只读工具只暂存名称
            pendingMap.saveReadOnlyToolName(toolUseId, name)
        } else {
            // TaskCreate/TaskUpdate 暂存完整 input
            const input = isObject(block.input) ? block.input as Record<string, unknown> : {}
            pendingMap.saveToolUse(toolUseId, name, input)
        }
    }
}

/** 从 user 消息的 tool_result blocks 中配对提取 TaskDelta */
function processUserToolResults(
    unwrapped: UnwrappedOutputMessage,
    pendingMap: PendingTaskMap
): TaskDelta[] {
    // tool_use_result 与 message 同级，包含工具的结构化结果
    const toolUseResult = isObject(unwrapped.data.tool_use_result) ? unwrapped.data.tool_use_result : null

    const deltas: TaskDelta[] = []
    for (const block of unwrapped.blocks ?? []) {
        if (!isObject(block) || block.type !== 'tool_result') continue

        // 失败的 tool_result 直接跳过
        if (block.is_error === true) continue

        const toolUseId = typeof block.tool_use_id === 'string' ? block.tool_use_id : null
        if (!toolUseId) continue

        // 尝试配对 TaskCreate/TaskUpdate 的暂存
        const pendingEntry = pendingMap.get(toolUseId)
        if (pendingEntry) {
            pendingMap.delete(toolUseId)
            const delta = processWriteToolResult(pendingEntry.toolName, pendingEntry.input, block.content, toolUseResult)
            if (delta) deltas.push(delta)
            continue
        }

        // 尝试配对 TaskList/TaskGet 的暂存
        const readOnlyName = pendingMap.getToolName(toolUseId)
        if (readOnlyName) {
            pendingMap.delete(toolUseId)
            const delta = processReadOnlyToolResult(readOnlyName, block.content, toolUseResult)
            if (delta) deltas.push(delta)
        }
    }

    return deltas
}

/** 处理 TaskCreate/TaskUpdate 的 tool_result */
function processWriteToolResult(
    toolName: string,
    input: Record<string, unknown>,
    rawResult: unknown,
    toolUseResult: Record<string, unknown> | null
): TaskDelta | null {
    const parsed = parseContentAsJson(rawResult)

    if (toolName === 'TaskCreate') {
        // 优先从 tool_use_result 提取（结构化数据）
        const resultTaskData = toolUseResult ? toolUseResult['task'] : null
        const resultTask = isObject(resultTaskData) ? resultTaskData as Record<string, unknown> : null
        const parsedObj = isObject(parsed) ? parsed as Record<string, unknown> : null
        const contentTask = parsedObj && isObject(parsedObj['task']) ? parsedObj['task'] as Record<string, unknown> : null

        const taskData = resultTask ?? contentTask
        if (!taskData) return null

        const id = typeof taskData.id === 'string' ? taskData.id : null
        if (!id) return null

        const task: TaskItem = {
            id,
            subject: typeof input.subject === 'string' ? input.subject :
                     typeof taskData.subject === 'string' ? taskData.subject : '',
            status: 'pending',
        }

        if (typeof input.description === 'string') task.description = input.description
        else if (typeof taskData.description === 'string') task.description = taskData.description
        if (typeof input.activeForm === 'string') task.activeForm = input.activeForm
        else if (typeof taskData.activeForm === 'string') task.activeForm = taskData.activeForm

        const metadata = input.metadata
        if (isObject(metadata)) task.metadata = metadata as Record<string, unknown>

        const validated = TaskItemSchema.safeParse(task)
        if (!validated.success) return null

        return { type: 'create', task: validated.data }
    }

    if (toolName === 'TaskUpdate') {
        // TaskUpdate: input 含 taskId 和更新字段，result 是成功确认
        const taskId = typeof input.taskId === 'string' ? input.taskId : null
        if (!taskId) return null

        const updates: Record<string, unknown> = {}
        if (typeof input.status === 'string') updates.status = input.status
        if (typeof input.subject === 'string') updates.subject = input.subject
        if (typeof input.description === 'string') updates.description = input.description
        if (typeof input.activeForm === 'string') updates.activeForm = input.activeForm
        if (input.metadata !== undefined) updates.metadata = input.metadata

        // 至少要有一个更新字段
        if (Object.keys(updates).length === 0) return null

        return { type: 'update', taskId, updates }
    }

    if (toolName === 'TaskStop') {
        // TaskStop: input 含 task_id，成功后将对应 task 标记为 completed
        const taskId = typeof input.task_id === 'string' ? input.task_id : null
        if (!taskId) return null

        return { type: 'update', taskId, updates: { status: 'completed' } }
    }

    return null
}

/** 处理 TaskList/TaskGet 的 tool_result（只读，用于校准） */
function processReadOnlyToolResult(
    toolName: string,
    rawResult: unknown,
    toolUseResult: Record<string, unknown> | null
): TaskDelta | null {
    const parsed = parseContentAsJson(rawResult)

    if (toolName === 'TaskList') {
        // 优先从 tool_use_result 提取
        if (isObject(toolUseResult) && Array.isArray(toolUseResult.tasks)) {
            const validated = TasksSchema.safeParse(toolUseResult.tasks)
            if (validated.success) return { type: 'calibration', tasks: validated.data }
        }

        if (!isObject(parsed)) return null

        const tasksCandidate = parsed.tasks ?? parsed
        const validated = TasksSchema.safeParse(tasksCandidate)
        if (!validated.success) return null

        return { type: 'calibration', tasks: validated.data }
    }

    if (toolName === 'TaskGet') {
        // 优先从 tool_use_result 提取
        if (isObject(toolUseResult) && isObject(toolUseResult.task)) {
            const validated = TaskItemSchema.safeParse(toolUseResult.task)
            if (validated.success) return { type: 'single-calibration', task: validated.data }
        }

        if (!isObject(parsed)) return null

        const taskData = isObject(parsed.task) ? parsed.task : parsed
        const validated = TaskItemSchema.safeParse(taskData)
        if (!validated.success) return null

        return { type: 'single-calibration', task: validated.data }
    }

    // TaskOutput: 只获取输出，不改变 task 状态
    if (toolName === 'TaskOutput') return null

    return null
}

/**
 * 从消息内容中提取 Task 增量。
 * assistant 消息：暂存 tool_use，返回 []。
 * user 消息：配对 tool_result，返回 TaskDelta[]。
 */
export function extractTaskDeltasFromMessageContent(
    messageContent: unknown,
    pendingMap: PendingTaskMap
): TaskDelta[] {
    // 解包骨架收口在 unwrapOutputMessage（shared/messages），此处按 data.type 分流
    const unwrapped = unwrapOutputMessage(messageContent)
    if (!unwrapped) return []

    if (unwrapped.data.type === 'assistant') {
        processAssistantToolUses(unwrapped.blocks, pendingMap)
        return []
    }

    if (unwrapped.data.type === 'user') {
        return processUserToolResults(unwrapped, pendingMap)
    }

    return []
}

/**
 * 将增量应用到现有 tasks 列表。
 */
export function applyTaskDelta(existingTasks: TaskItem[] | undefined, delta: TaskDelta): TaskItem[] {
    const tasks = existingTasks ? [...existingTasks] : []

    switch (delta.type) {
        case 'create': {
            // 添加新 task（如果已存在则更新）
            const idx = tasks.findIndex(t => t.id === delta.task.id)
            if (idx >= 0) {
                tasks[idx] = delta.task
            } else {
                tasks.push(delta.task)
            }
            return tasks
        }

        case 'update': {
            // 更新已有 task；status 为 'deleted' 时移除
            if (delta.updates.status === 'deleted') {
                return tasks.filter(t => t.id !== delta.taskId)
            }
            return tasks.map(t => t.id === delta.taskId ? { ...t, ...delta.updates } as TaskItem : t)
        }

        case 'calibration': {
            // 替换整个列表
            return delta.tasks
        }

        case 'single-calibration': {
            // 更新单个 task（存在则更新，不存在则添加）
            const existingIdx = tasks.findIndex(t => t.id === delta.task.id)
            if (existingIdx >= 0) {
                tasks[existingIdx] = delta.task
            } else {
                tasks.push(delta.task)
            }
            return tasks
        }
    }
}
