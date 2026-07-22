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
 * 双保险第二道：按 (messageId, type[, id]) 去重 snapshot block。
 *
 * 第一道（messageCache parentUuid 清理）在 CLI assembler 聚合 full 后已可靠，但有已知边界
 * 可能漏清：parentUuid 为 null（会话首条 assistant，lastUuid 未建立）、SSE 早到/乱序。
 * 此处在 reducer 渲染前兜底——snapshot 的 block 若已被同 key 的 full 覆盖，则移除；
 * 即使 snapshot 残留到渲染层也不重复显示。
 *
 * key：text/thinking/reasoning 等 → `(messageId, type)`（type 是稳定标识，不依赖序号/到达顺序）；
 * tool-call → `(messageId, tool-call, id)`——并行工具调用同 message 含多个 tool-call，
 * 按 type 会把多条一起标记覆盖（full 暂只到部分时误删其余），用 tool_use_id 精确到条。
 * 边界：同 message 多个同类型 text/thinking 仍按 type 匹配（少见，最坏某 block 短暂不显示）。
 */
function blockDedupeKey(messageId: string, block: unknown): string | null {
    if (!block || typeof block !== 'object') return null
    const b = block as { type?: unknown; id?: unknown }
    // normalized 后 tool_use 表现为 { type: 'tool-call', id: tool_use_id }
    if (b.type === 'tool-call' && typeof b.id === 'string') {
        return `${messageId}:tool-call:${b.id}`
    }
    if (typeof b.type === 'string') {
        return `${messageId}:${b.type}`
    }
    return null
}

export function dedupeSnapshotBlocks(normalized: NormalizedMessage[]): NormalizedMessage[] {
    // 第一遍：收集已落库 full 的 block key，同时检测是否存在 snapshot
    const deliveredKeys = new Set<string>()
    let hasSnapshot = false
    for (const m of normalized) {
        if (m.role !== 'agent' || !m.messageId || !Array.isArray(m.content)) continue
        if (m.snapshot) {
            hasSnapshot = true
            continue  // snapshot 不贡献 deliveredKeys
        }
        for (const c of m.content) {
            const key = blockDedupeKey(m.messageId, c)
            if (key) deliveredKeys.add(key)
        }
    }
    // 无 full 或无 snapshot → 无需去重，原样返回（避免第二遍遍历；翻页历史无 snapshot 时早退）
    if (deliveredKeys.size === 0 || !hasSnapshot) return normalized

    // 第二遍：snapshot 的 block 若被 full 覆盖则移除；全被覆盖则整条丢弃
    const result: NormalizedMessage[] = []
    for (const m of normalized) {
        if (!m.snapshot || m.role !== 'agent' || !m.messageId || !Array.isArray(m.content)) {
            result.push(m)
            continue
        }
        const messageId = m.messageId
        const kept = m.content.filter(c => {
            const key = blockDedupeKey(messageId, c)
            return !key || !deliveredKeys.has(key)
        })
        if (kept.length === 0) continue  // snapshot 全被覆盖，移除整条
        result.push(kept.length === m.content.length ? m : { ...m, content: kept })
    }
    return result
}

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
    // 双保险第二道：兜底 parentUuid 清理的边界（null/乱序），snapshot 被覆盖的 block 不渲染
    const normalizedMsgs = dedupeSnapshotBlocks(normalized)
    const toolIdsInMessages = collectToolIdsFromMessages(normalizedMsgs)
    const titleChangesByToolUseId = collectTitleChanges(normalizedMsgs)
    const hiddenToolUseIds = collectHiddenToolUseIds(normalizedMsgs)

    const traced = traceMessages(normalizedMsgs)
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
    const oldestMessageTime = normalizedMsgs.length > 0
        ? normalizedMsgs.reduce((min, m) => Math.min(min, m.createdAt), Infinity)
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
    for (let i = normalizedMsgs.length - 1; i >= 0; i--) {
        const msg = normalizedMsgs[i]
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
