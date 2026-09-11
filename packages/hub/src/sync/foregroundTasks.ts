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
import { isTurnResultContent, unwrapOutputMessage } from '@mobi/shared/messages'
import { ForegroundTaskItemSchema } from '@mobi/shared/schemas'
import type { ForegroundTaskItem } from '@mobi/shared/types'

export { ForegroundTaskItemSchema }
export type { ForegroundTaskItem }

/**
 * 前台执行中任务清单的消息投影（foreground-tasks spec D1/D3/D4）：
 * Agent 类工具的 tool_use 入清单、tool_result 移除、轮次 result 到达清扫孤儿。
 * 与 backgroundTasks 的区别：无 CLI 上报通道，hub 从已持久化消息自维护；
 * 与 tasks（任务列表）的区别：这里投影的是工具执行态，不是 TaskCreate 条目。
 */

/** 前台 Agent 类工具名称集合（Task 为旧名 / Agent 为新名，SDK 双名并存） */
const FOREGROUND_TOOL_NAMES = new Set(['Task', 'Agent'])

/** 连接级配对暂存：tool_use 的展示字段，等 tool_result 配对后移除 */
export class ForegroundTaskMap {
    private readonly pending = new Set<string>()

    saveToolUse(toolUseId: string): void {
        this.pending.add(toolUseId)
    }

    has(toolUseId: string): boolean {
        return this.pending.has(toolUseId)
    }

    delete(toolUseId: string): void {
        this.pending.delete(toolUseId)
    }

    /** 轮次孤儿清扫：清空全部未配对暂存 */
    clear(): void {
        this.pending.clear()
    }
}

/** 前台任务变更增量 */
export type ForegroundTaskDelta =
    | { type: 'started'; task: ForegroundTaskItem }
    | { type: 'completed'; toolUseId: string }

/** 单条消息的投影产物 */
export type ForegroundProjection = {
    deltas: ForegroundTaskDelta[]
    /** 是否为轮次 result 消息（调用方据此执行孤儿清扫） */
    turnResult: boolean
}

/** 从 assistant 消息的 tool_use blocks 收集前台 Agent 工具调用（后台 Agent 不属前台，排除） */
function collectForegroundToolUses(
    unwrapped: ReturnType<typeof unwrapOutputMessage>,
    now: () => number,
    map: ForegroundTaskMap,
): ForegroundTaskDelta[] {    const deltas: ForegroundTaskDelta[] = []
    for (const block of unwrapped?.blocks ?? []) {
        if (!isObject(block) || block.type !== 'tool_use') continue
        const name = typeof block.name === 'string' ? block.name : null
        if (!name || !FOREGROUND_TOOL_NAMES.has(name)) continue

        const toolUseId = typeof block.id === 'string' ? block.id : null
        if (!toolUseId) continue

        const input = isObject(block.input) ? block.input : null
        // 显式后台 Agent 归后台任务面板（backgroundTasks），不进前台清单
        if (input?.run_in_background === true) continue

        map.saveToolUse(toolUseId)

        const description = typeof input?.description === 'string' ? input.description : null
        const subagentTypeRaw = input?.subagent_type ?? input?.subagentType
        const task = ForegroundTaskItemSchema.safeParse({
            toolUseId,
            description,
            subagentType: typeof subagentTypeRaw === 'string' ? subagentTypeRaw : null,
            startedAt: now(),
        })
        if (task.success) deltas.push({ type: 'started', task: task.data })
    }
    return deltas
}

/** 从 user 消息的 tool_result blocks 配对移除（is_error 的结果同样代表执行已结束，照常移除） */
function collectCompletions(
    unwrapped: ReturnType<typeof unwrapOutputMessage>,
    map: ForegroundTaskMap,
): ForegroundTaskDelta[] {
    const deltas: ForegroundTaskDelta[] = []
    for (const block of unwrapped?.blocks ?? []) {
        if (!isObject(block) || block.type !== 'tool_result') continue
        const toolUseId = typeof block.tool_use_id === 'string' ? block.tool_use_id : null
        if (!toolUseId || !map.has(toolUseId)) continue

        map.delete(toolUseId)
        deltas.push({ type: 'completed', toolUseId })
    }
    return deltas
}

/**
 * 提取单条消息的前台任务投影：started/completed 增量 + 轮次 result 标记。
 * now 由调用方注入（投影器测试时钟）。content 非输出消息（信封不匹配）返回空产物。
 */
export function extractForegroundProjection(content: unknown, map: ForegroundTaskMap, now: () => number): ForegroundProjection {
    if (isTurnResultContent(content)) {
        map.clear()
        return { deltas: [], turnResult: true }
    }

    const unwrapped = unwrapOutputMessage(content)
    if (!unwrapped) return { deltas: [], turnResult: false }

    if (unwrapped.data.type === 'assistant') {
        return { deltas: collectForegroundToolUses(unwrapped, now, map), turnResult: false }
    }
    if (unwrapped.data.type === 'user') {
        return { deltas: collectCompletions(unwrapped, map), turnResult: false }
    }
    return { deltas: [], turnResult: false }
}

/** 应用增量到现有清单；返回 null 表示无变化（调用方据此跳过写库） */
export function applyForegroundTaskDeltas(
    existing: ForegroundTaskItem[] | undefined,
    deltas: ForegroundTaskDelta[],
): ForegroundTaskItem[] | null {
    let tasks = existing ?? []
    let changed = false

    for (const delta of deltas) {
        if (delta.type === 'started') {
            // 重配对防御：同 toolUseId 已在清单（如 resume 重放）不重复入列
            if (tasks.some(task => task.toolUseId === delta.task.toolUseId)) continue
            tasks = [...tasks, delta.task]
            changed = true
        } else {
            const next = tasks.filter(task => task.toolUseId !== delta.toolUseId)
            if (next.length === tasks.length) continue
            tasks = next
            changed = true
        }
    }

    return changed ? tasks : null
}
