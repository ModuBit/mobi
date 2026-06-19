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
import type { ChatBlock, NormalizedMessage, UsageData } from './types'
import { indexBlocks, type ChatBlocksById } from './reconcile'
import { traceMessages, type TracedMessage } from './tracer'
import { dedupeAgentEvents, foldApiErrorEvents } from './reducerEvents'
import { collectHiddenToolUseIds, collectTitleChanges, collectToolIdsFromMessages, ensureToolBlock, getPermissions } from './reducerTools'
import { reduceTimeline } from './reducerTimeline'

/**
 * 计算上下文大小
 */
function calculateContextSize(usage: UsageData): number {
    return (usage.cache_creation_input_tokens || 0) + (usage.cache_read_input_tokens || 0) + usage.input_tokens
}

/** 最新使用情况 */
export type LatestUsage = {
    inputTokens: number
    outputTokens: number
    cacheCreation: number
    cacheRead: number
    contextSize: number
    timestamp: number
}

/**
 * 归约聊天块
 * 将标准化消息转换为可渲染的聊天块
 */
export function reduceChatBlocks(
    normalized: NormalizedMessage[],
    agentState: AgentState | null | undefined
): { blocks: ChatBlock[]; byId: ChatBlocksById; hasReadyEvent: boolean; latestUsage: LatestUsage | null } {
    const permissionsById = getPermissions(agentState)
    const toolIdsInMessages = collectToolIdsFromMessages(normalized)
    const titleChangesByToolUseId = collectTitleChanges(normalized)
    const hiddenToolUseIds = collectHiddenToolUseIds(normalized)

    const traced = traceMessages(normalized)
    const groups = new Map<string, TracedMessage[]>()
    const root: TracedMessage[] = []

    for (const msg of traced) {
        if (msg.sidechainId) {
            const existing = groups.get(msg.sidechainId) ?? []
            existing.push(msg)
            groups.set(msg.sidechainId, existing)
        } else {
            root.push(msg)
        }
    }

    const consumedGroupIds = new Set<string>()
    const emittedTitleChangeToolUseIds = new Set<string>()
    const reducerContext = { permissionsById, groups, consumedGroupIds, titleChangesByToolUseId, emittedTitleChangeToolUseIds, hiddenToolUseIds }
    const rootResult = reduceTimeline(root, reducerContext)
    const hasReadyEvent = rootResult.hasReadyEvent

    // 只在没有工具调用/结果时创建仅权限的工具卡片（仅 pending 状态）
    // 同时跳过比当前视图中最旧消息更早的权限，避免分页时混合新旧工具卡片
    const oldestMessageTime = normalized.length > 0
        ? normalized.reduce((min, m) => Math.min(min, m.createdAt), Infinity)
        : null

    for (const [id, entry] of permissionsById) {
        if (toolIdsInMessages.has(id)) continue
        if (rootResult.toolBlocksById.has(id)) continue

        const createdAt = entry.permission.createdAt ?? Date.now()

        // 跳过比当前视图中最旧消息更早的权限
        if (oldestMessageTime !== null && createdAt < oldestMessageTime) {
            continue
        }

        ensureToolBlock(rootResult.blocks, rootResult.toolBlocksById, id, {
            createdAt,
            localId: null,
            name: entry.toolName,
            input: entry.input,
            description: null,
            permission: entry.permission
        })
    }

    // 从消息中计算最新使用情况（找到最近有使用数据的消息）
    let latestUsage: LatestUsage | null = null
    for (let i = normalized.length - 1; i >= 0; i--) {
        const msg = normalized[i]
        if (msg.usage) {
            latestUsage = {
                inputTokens: msg.usage.input_tokens,
                outputTokens: msg.usage.output_tokens,
                cacheCreation: msg.usage.cache_creation_input_tokens ?? 0,
                cacheRead: msg.usage.cache_read_input_tokens ?? 0,
                contextSize: calculateContextSize(msg.usage),
                timestamp: msg.createdAt
            }
            break
        }
    }

    const finalBlocks = dedupeAgentEvents(foldApiErrorEvents(rootResult.blocks))
    const byId: ChatBlocksById = new Map()
    indexBlocks(finalBlocks, byId)
    return { blocks: finalBlocks, byId, hasReadyEvent, latestUsage }
}
