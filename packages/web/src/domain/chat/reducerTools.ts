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

    const completed = agentState?.completedRequests ?? null
    if (completed) {
        for (const [id, entry] of Object.entries(completed)) {
            map.set(id, {
                toolName: entry.tool,
                input: entry.arguments,
                permission: {
                    id,
                    status: entry.status,
                    reason: entry.reason ?? undefined,
                    mode: entry.mode ?? undefined,
                    decision: entry.decision ?? undefined,
                    allowedTools: entry.allowTools,
                    answers: entry.answers,
                    createdAt: entry.createdAt ?? null,
                    completedAt: entry.completedAt ?? null
                }
            })
        }
    }

    const requests = agentState?.requests ?? null
    if (requests) {
        for (const [id, request] of Object.entries(requests)) {
            if (map.has(id)) continue
            map.set(id, {
                toolName: request.tool,
                input: request.arguments,
                permission: {
                    id,
                    status: 'pending',
                    createdAt: request.createdAt ?? null
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
    }
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

    toolBlocksById.set(id, block)
    blocks.push(block)
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
}

/**
 * 收集所有隐藏工具的 tool_use_id
 * 用于在 tool-result 阶段过滤掉对应结果（这类工具不一定走权限流程，无法从 permissionsById 反查工具名）
 */
export function collectHiddenToolUseIds(messages: NormalizedMessage[]): Set<string> {
    const ids = new Set<string>()
    for (const msg of messages) {
        if (msg.role !== 'agent') continue
        for (const content of msg.content) {
            if (content.type !== 'tool-call') continue
            if (isHiddenTool(content.name)) {
                ids.add(content.id)
            }
        }
    }
    return ids
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
