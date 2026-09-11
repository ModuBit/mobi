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

import { asString, getField, isObject } from '@mobi/shared'
import { isTurnResultUnwrapped, unwrapOutputMessage } from '@mobi/shared/messages'
import { ForegroundTaskItemSchema } from '@mobi/shared/schemas'
import type { ForegroundTaskItem } from '@mobi/shared/types'

/**
 * 前台执行中任务清单的消息投影（foreground-tasks spec D1/D3/D4）：
 * Agent 类工具的 tool_use 入清单、tool_result 移除、轮次 result 到达清扫孤儿。
 * 与 backgroundTasks 的区别：无 CLI 上报通道，hub 从已持久化消息自维护；
 * 与 tasks（任务列表）的区别：这里投影的是工具执行态，不是 TaskCreate 条目。
 *
 * 投影无状态：配对幂等性全部由 applyForegroundTaskDeltas 承担（started 按
 * toolUseId 去重、completed 按移除判定无变化），不维护跨消息配对 map——
 * 清单本身（runtimeState.foregroundTasks）就是唯一的配对状态。
 */

/** 前台 Agent 类工具名称集合（Task 为旧名 / Agent 为新名，SDK 双名并存） */
const FOREGROUND_TOOL_NAMES = new Set(['Task', 'Agent'])

/** 前台任务变更增量 */
export type ForegroundTaskDelta =
    | { type: 'started'; task: ForegroundTaskItem }
    | { type: 'completed'; toolUseId: string }

/** 单条消息的投影产物 */
export type ForegroundProjection = {
    deltas: ForegroundTaskDelta[]
    /** 是否为轮次 result 消息（apply 据此清扫清单内全部遗留条目） */
    turnResult: boolean
}

/** 从 assistant 消息的 tool_use blocks 收集前台 Agent 工具调用（后台 Agent 不属前台，排除） */
function collectForegroundToolUses(
    blocks: unknown[],
    now: () => number,
): ForegroundTaskDelta[] {
    const deltas: ForegroundTaskDelta[] = []
    for (const block of blocks) {
        if (!isObject(block) || block.type !== 'tool_use') continue
        if (!FOREGROUND_TOOL_NAMES.has(asString(block.name) ?? '')) continue

        const toolUseId = asString(block.id)
        if (!toolUseId) continue

        const input = isObject(block.input) ? block.input : null
        // 显式后台 Agent 归后台任务面板（backgroundTasks），不进前台清单
        if (input?.run_in_background === true) continue

        const task = ForegroundTaskItemSchema.safeParse({
            toolUseId,
            description: asString(input?.description),
            subagentType: asString(getField(input ?? {}, 'subagent_type')),
            startedAt: now(),
        })
        if (task.success) deltas.push({ type: 'started', task: task.data })
    }
    return deltas
}

/** 从 user 消息的 tool_result blocks 收集完成增量（is_error 的结果同样代表执行已结束，照常移除） */
function collectCompletions(blocks: unknown[]): ForegroundTaskDelta[] {
    const deltas: ForegroundTaskDelta[] = []
    for (const block of blocks) {
        if (!isObject(block) || block.type !== 'tool_result') continue
        const toolUseId = asString(block.tool_use_id)
        if (!toolUseId) continue
        deltas.push({ type: 'completed', toolUseId })
    }
    return deltas
}

/**
 * 提取单条消息的前台任务投影：started/completed 增量 + 轮次 result 标记。
 * now 由调用方注入（投影器测试时钟）。content 非输出消息（信封不匹配）返回空产物。
 */
export function extractForegroundProjection(content: unknown, now: () => number): ForegroundProjection {
    const unwrapped = unwrapOutputMessage(content)
    if (!unwrapped) return { deltas: [], turnResult: false }

    if (isTurnResultUnwrapped(unwrapped)) return { deltas: [], turnResult: true }

    if (unwrapped.data.type === 'assistant' && unwrapped.blocks) {
        return { deltas: collectForegroundToolUses(unwrapped.blocks, now), turnResult: false }
    }
    if (unwrapped.data.type === 'user' && unwrapped.blocks) {
        return { deltas: collectCompletions(unwrapped.blocks), turnResult: false }
    }
    return { deltas: [], turnResult: false }
}

/**
 * 应用增量到现有清单；返回 null 表示无变化（调用方据此跳过写库）。
 * turnResult=true 时在增量应用后清扫全部遗留条目（孤儿 = 没等到 tool_result 的 started）。
 * 幂等：started 按 toolUseId 去重（resume 重放不重复入列）、completed 移除不存在的条目按无变化处理。
 */
export function applyForegroundTaskDeltas(
    existing: ForegroundTaskItem[] | undefined,
    deltas: ForegroundTaskDelta[],
    turnResult: boolean,
): ForegroundTaskItem[] | null {
    let tasks = existing ?? []
    let changed = false

    for (const delta of deltas) {
        if (delta.type === 'started') {
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

    if (turnResult && tasks.length > 0) {
        tasks = []
        changed = true
    }

    return changed ? tasks : null
}
