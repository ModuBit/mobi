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

import type { AgentState } from '@/core/data/api/types'
import type { ChatBlock, ChatToolCall, MessageMeta, NormalizedMessage, ToolCallBlock, ToolPermission } from './types'
import { recordTool } from '@/core/lib/diag'

/** 权限条目 */
export type PermissionEntry = {
    toolName: string
    input: unknown
    permission: ToolPermission
}

/**
 * 从 AgentState 提取权限映射
 */
export function getPermissions(agentState: AgentState | null | undefined): Map<string, PermissionEntry> {
    const map = new Map<string, PermissionEntry>()

    const requests = agentState?.requests ?? null
    if (requests) {
        for (const [id, request] of Object.entries(requests)) {
            map.set(id, {
                toolName: request.tool,
                input: request.arguments,
                permission: {
                    id,
                    status: 'pending',
                    createdAt: request.createdAt ?? null,
                    suggestions: request.suggestions,
                }
            })
        }
    }

    return map
}

/**
 * 确保工具块存在，如果不存在则创建
 */
export function ensureToolBlock(
    blocks: ChatBlock[],
    toolBlocksById: Map<string, ToolCallBlock>,
    id: string,
    seed: {
        createdAt: number
        localId: string | null
        meta?: MessageMeta
        name: string
        input: unknown
        description: string | null
        permission?: ToolPermission
    },
    blockIndexById?: Map<string, number>
): ToolCallBlock {
    const existing = toolBlocksById.get(id)
    if (existing) {
        const isPlaceholderToolName = (name: string): boolean => {
            const normalized = name.trim().toLowerCase()
            return normalized === '' || normalized === 'tool' || normalized === 'unknown'
        }

        // 创建浅拷贝以保持不可变性
        const updatedTool = { ...existing.tool }
        const updated: ToolCallBlock = {
            ...existing,
            tool: updatedTool
        }

        // 保留最早的 createdAt 以保持稳定排序
        if (seed.createdAt < updated.createdAt) {
            updated.createdAt = seed.createdAt
            updatedTool.createdAt = seed.createdAt
        }
        if (seed.permission) {
            updatedTool.permission = { ...updatedTool.permission, ...seed.permission }
            if (updatedTool.state === 'running' && seed.permission.status === 'pending') {
                updatedTool.state = 'pending'
            }
        } else if (updatedTool.state === 'pending' && existing.tool.permission?.status === 'pending') {
            // 审批已通过/无 pending 请求（agentState.requests 移除后 getPermissions 不再返回）：
            // 清除遗留的 pending permission 并翻 running，让工具执行窗口可见。
            // 若保持 pending，ToolCallBlock 会因 hasPermission=true 持续不渲染，直到 tool_result 才出现。
            //
            // 守卫 `existing.tool.permission?.status === 'pending'`：只有「块确实曾处于待审批」才翻转。
            // 非审批工具首次建块即 running（initialState 逻辑），不会走到这里；审批拒绝（denied/canceled）
            // 的块 permission 已在 tool-result 分支被清为非 pending 并翻 error，也不会误翻 running。
            // 防止异常态（permission 已清除但 state 卡 pending）在 reducer 全量重跑时反复翻转。
            updatedTool.permission = undefined
            updatedTool.state = 'running'
            if (updatedTool.startedAt === null) {
                updatedTool.startedAt = seed.createdAt
            }
        }
        if (seed.name && (!isPlaceholderToolName(seed.name) || isPlaceholderToolName(updatedTool.name))) {
            updatedTool.name = seed.name
        }
        if (seed.input !== null && seed.input !== undefined) {
            updatedTool.input = seed.input
        }
        if (seed.description !== null) {
            updatedTool.description = seed.description
        }

        // 诊断埋点：记录已有 block 的状态迁移（state 或 permission 变化）。
        // 用「值」比较而非「引用」：reducer 每次重跑都新建 permission 对象，但值没变时不算变化。
        // 仅在状态或 permission 引用实际变化时做序列化比较——reducer 每次全量重跑都会走到这里，
        // 高频流式下为每个工具无条件 JSON.stringify 整个 permission 对象是热路径上的重复开销。
        // 大部分重跑里 state 与 permission 引用都没变（只有首块新建/审批翻转时才变），先按引用
        // 短路，引用不同才序列化比对值；permission 内嵌的 suggestions 引用不变即视为未变，
        // 规避「异步字段写入间隙重跑」造成的误报。
        const permRefChanged = existing.tool.permission !== updatedTool.permission
        const permChanged = permRefChanged
            && JSON.stringify(existing.tool.permission) !== JSON.stringify(updatedTool.permission)
        if (existing.tool.state !== updatedTool.state || permChanged) {
            recordTool({
                kind: 'tool',
                toolUseId: id,
                name: updatedTool.name,
                stage: 'state',
                state: updatedTool.state,
                permission: updatedTool.permission,
                source: 'existing',
            })
        }

        // 更新映射以保持引用一致性
        toolBlocksById.set(id, updated)
        return updated
    }

    const initialState: ChatToolCall['state'] = seed.permission?.status === 'pending'
        ? 'pending'
        : seed.permission?.status === 'denied' || seed.permission?.status === 'canceled'
            ? 'error'
            : 'running'

    const tool: ChatToolCall = {
        id,
        name: seed.name,
        state: initialState,
        input: seed.input,
        createdAt: seed.createdAt,
        startedAt: initialState === 'running' ? seed.createdAt : null,
        completedAt: null,
        description: seed.description,
        permission: seed.permission
    }

    const block: ToolCallBlock = {
        kind: 'tool-call',
        id,
        localId: seed.localId,
        createdAt: seed.createdAt,
        tool,
        children: [],
        meta: seed.meta
    }

    // 诊断埋点：记录新 block 建立（snapshot 占位 / full / permission-only）
    recordTool({
        kind: 'tool',
        toolUseId: id,
        name: seed.name,
        stage: 'created',
        state: tool.state,
        permission: seed.permission,
        source: seed.permission ? 'permission' : 'message',
    })

    toolBlocksById.set(id, block)
    blocks.push(block)
    blockIndexById?.set(id, blocks.length - 1)
    return block
}

/**
 * 从消息中收集所有工具 ID
 */
export function collectToolIdsFromMessages(messages: NormalizedMessage[]): Set<string> {
    const ids = new Set<string>()
    for (const msg of messages) {
        if (msg.role !== 'agent') continue
        for (const content of msg.content) {
            if (content.type === 'tool-call') {
                ids.add(content.id)
            } else if (content.type === 'tool-result') {
                ids.add(content.tool_use_id)
            }
        }
    }
    return ids
}

/**
 * 检查是否为更改标题的工具名称
 */
/** 不需要渲染的内部工具 */
export function isHiddenTool(name: string): boolean {
    return name === 'ToolSearch'
        || name === 'mcp__mobi__change_title'
        || name === 'mobi__change_title'
        || name === 'EnterPlanMode'
        || name === 'enter_plan_mode'
        || name === 'TaskCreate'
        || name === 'TaskUpdate'
        || name === 'TaskStop'
        || name === 'TaskList'
        || name === 'TaskGet'
}

/**
 * 收集所有隐藏工具的 tool_use_id
 * 用于在 tool-result 阶段过滤掉对应结果（这类工具不一定走权限流程，无法从 permissionsById 反查工具名）
 */
export function collectHiddenToolUseIds(messages: NormalizedMessage[]): Map<string, string> {
    const map = new Map<string, string>()
    for (const msg of messages) {
        if (msg.role !== 'agent') continue
        for (const content of msg.content) {
            if (content.type !== 'tool-call') continue
            if (isHiddenTool(content.name)) {
                map.set(content.id, content.name)
            }
        }
    }
    return map
}

/** 改标题的工具名（isHiddenTool 的子集，需要额外提取标题） */
export function isChangeTitleToolName(name: string): boolean {
    return name === 'mcp__mobi__change_title' || name === 'mobi__change_title'
}

/**
 * 从更改标题工具输入中提取标题
 */
export function extractTitleFromChangeTitleInput(input: unknown): string | null {
    if (!input || typeof input !== 'object') return null
    const title = (input as { title?: unknown }).title
    return typeof title === 'string' && title.trim().length > 0 ? title.trim() : null
}

/**
 * 从消息中收集标题变更
 */
export function collectTitleChanges(messages: NormalizedMessage[]): Map<string, string> {
    const map = new Map<string, string>()
    for (const msg of messages) {
        if (msg.role !== 'agent') continue
        for (const content of msg.content) {
            if (content.type !== 'tool-call') continue
            if (!isChangeTitleToolName(content.name)) continue
            const title = extractTitleFromChangeTitleInput(content.input)
            if (!title) continue
            map.set(content.id, title)
        }
    }
    return map
}

/** 判断是否为 plan mode 进入工具 */
export function isPlanModeEnterTool(name: string): boolean {
    return name === 'EnterPlanMode' || name === 'enter_plan_mode'
}
