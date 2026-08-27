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

import type { AgentEvent, AgentEventBlock, ChatBlock, CompactSummaryBlock, EventDisplay, MessageMeta, ToolCallBlock, ToolPermission } from './types'
import type { TracedMessage } from './tracer'
import { createCliOutputBlock, isCliOutputText, mergeCliOutputBlocks, extractStandaloneStdout } from './reducerCliOutput'
import { parseMessageAsEvent } from './reducerEvents'
import { getUserPlainText } from './userContent'
import { ensureToolBlock, extractTitleFromChangeTitleInput, isChangeTitleToolName, isHiddenTool, isPlanModeEnterTool, type PermissionEntry } from './reducerTools'

// 根据事件类型获取渲染提示
function getEventDisplay(event: { type: string; [key: string]: unknown }): EventDisplay | undefined {
    switch (event.type) {
        case 'turn-duration': return { align: 'left', padding: false }
        case 'api-retry': return { color: 'warning' }
        case 'api-error': return { color: 'error' }
        // goal 达成(success 绿) vs active(中性灰)，对齐 GoalChip 的颜色语义
        case 'goal-progress': return { color: event.met === true ? 'success' : 'default', align: 'left' }
        case 'turn-result':
        case 'aborted': return { align: 'left' }
        default: return undefined
    }
}

// 创建 agent-event block
function createEventBlock(params: {
    id: string
    createdAt: number
    event: { type: string; [key: string]: unknown }
    meta?: MessageMeta
}): AgentEventBlock {
    return {
        kind: 'agent-event',
        id: params.id,
        createdAt: params.createdAt,
        event: params.event,
        meta: params.meta,
        display: getEventDisplay(params.event),
    }
}

/** 在 blocks 数组中找到指定 ID 的块并替换，使用索引 Map 实现 O(1) 查找 */
function replaceBlockById(
    blocks: ChatBlock[],
    blockIndexById: Map<string, number>,
    id: string,
    newBlock: ChatBlock
): void {
    const index = blockIndexById.get(id)
    if (index !== undefined) {
        blocks[index] = newBlock
    }
}

/**
 * 归约时间线
 * 将追踪后的消息转换为聊天块
 */
export function reduceTimeline(
    messages: TracedMessage[],
    context: {
        permissionsById: Map<string, PermissionEntry>
        groups: Map<string, TracedMessage[]>
        consumedGroupIds: Set<string>
        titleChangesByToolUseId: Map<string, string>
        emittedTitleChangeToolUseIds: Set<string>
        hiddenToolUseIds: Map<string, string>
    }
): { blocks: ChatBlock[]; toolBlocksById: Map<string, ToolCallBlock>; hasReadyEvent: boolean } {
    const blocks: ChatBlock[] = []
    const toolBlocksById = new Map<string, ToolCallBlock>()
    const blockIndexById = new Map<string, number>()
    let hasReadyEvent = false

    // 追踪 compact 事件，用于识别下一条 compact 总结消息
    let pendingCompactMetadata: { preTokens: number; postTokens: number; durationMs: number } | null = null

    for (const msg of messages) {
        if (msg.role === 'event') {
            if (msg.content.type === 'ready') {
                hasReadyEvent = true
                continue
            }
            // agent-progress 事件：更新对应 ToolCallBlock 的指标
            if (msg.content.type === 'agent-progress') {
                const { toolUseId, metrics, summary } = msg.content as Extract<AgentEvent, { type: 'agent-progress' }>
                const existingBlock = toolBlocksById.get(toolUseId)
                if (existingBlock) {
                    const updatedBlock = {
                        ...existingBlock,
                        tool: {
                            ...existingBlock.tool,
                            agentMetrics: metrics,
                            ...(summary !== undefined && { agentSummary: summary }),
                        }
                    }
                    replaceBlockById(blocks, blockIndexById, toolUseId, updatedBlock)
                    toolBlocksById.set(toolUseId, updatedBlock)
                }
                continue
            }
            // tool-progress 心跳：校准对应工具卡片的运行耗时
            // startedAt = 心跳时间 - 已运行时长（纯函数，用消息自身 timestamp；不依赖 Date.now）
            if (msg.content.type === 'tool-progress') {
                const { toolUseId, elapsedSeconds } = msg.content as Extract<AgentEvent, { type: 'tool-progress' }>
                const existingBlock = toolBlocksById.get(toolUseId)
                if (existingBlock && existingBlock.tool.state === 'running') {
                    const updatedBlock = {
                        ...existingBlock,
                        tool: {
                            ...existingBlock.tool,
                            startedAt: Math.max(0, msg.createdAt - elapsedSeconds * 1000),
                        }
                    }
                    replaceBlockById(blocks, blockIndexById, toolUseId, updatedBlock)
                    toolBlocksById.set(toolUseId, updatedBlock)
                }
                continue
            }
            // tool-use-summary：挂到 preceding 列表最后一个工具卡片（视线落点）
            // 从末尾向前找第一个已存在 block：lastId 可能是隐藏工具（hiddenToolUseIds，
            // 不进 toolBlocksById）或未进窗口的工具，逐个回退避免整条 summary 被丢弃
            if (msg.content.type === 'tool-use-summary') {
                const { summary, toolUseIds } = msg.content as Extract<AgentEvent, { type: 'tool-use-summary' }>
                for (let i = toolUseIds.length - 1; i >= 0; i--) {
                    const id = toolUseIds[i]
                    const existingBlock = toolBlocksById.get(id)
                    if (existingBlock) {
                        const updatedBlock = {
                            ...existingBlock,
                            tool: { ...existingBlock.tool, summary }
                        }
                        replaceBlockById(blocks, blockIndexById, id, updatedBlock)
                        toolBlocksById.set(id, updatedBlock)
                        break
                    }
                }
                continue
            }
            // 检测 compact 事件，记录 metadata 用于下一条 user 消息
            if (msg.content.type === 'compact') {
                // AgentEvent 是联合类型，需要提取 compact 特有字段
                const { preTokens, postTokens, durationMs } = msg.content as Extract<AgentEvent, { type: 'compact' }>
                pendingCompactMetadata = { preTokens, postTokens, durationMs }
            }
            blocks.push(createEventBlock({
                id: msg.id,
                createdAt: msg.createdAt,
                event: msg.content,
                meta: msg.meta
            }))
            continue
        }

        const event = parseMessageAsEvent(msg)
        if (event) {
            blocks.push(createEventBlock({
                id: msg.id,
                createdAt: msg.createdAt,
                event,
                meta: msg.meta
            }))
            continue
        }

        if (msg.role === 'user') {
            // 【过渡】blocks 化后纯文本经 getUserPlainText 提取（多 block 消息取首个非空 text）
            const plainText = getUserPlainText(msg.content.blocks)
            // 检测 compact 总结消息：来自 CLI 且之前有 compact 事件
            if (pendingCompactMetadata && msg.meta?.sentFrom === 'cli') {
                const compactBlock: CompactSummaryBlock = {
                    kind: 'compact-summary',
                    id: msg.id,
                    localId: msg.localId,
                    createdAt: msg.createdAt,
                    text: plainText,
                    preTokens: pendingCompactMetadata.preTokens,
                    postTokens: pendingCompactMetadata.postTokens,
                    durationMs: pendingCompactMetadata.durationMs,
                    meta: msg.meta
                }
                blocks.push(compactBlock)
                pendingCompactMetadata = null
                continue
            }

            if (isCliOutputText(plainText, msg.meta)) {
                // 纯 local-command-stdout（如 setModel 确认）→ 系统事件消息
                const standaloneText = extractStandaloneStdout(plainText)
                if (standaloneText !== null) {
                    blocks.push(createEventBlock({
                        id: msg.id,
                        createdAt: msg.createdAt,
                        event: { type: 'message', message: standaloneText },
                        meta: msg.meta
                    }))
                    continue
                }
                blocks.push(createCliOutputBlock({
                    id: msg.id,
                    localId: msg.localId,
                    createdAt: msg.createdAt,
                    text: plainText,
                    source: 'user',
                    meta: msg.meta
                }))
                continue
            }
            blocks.push({
                kind: 'user-text',
                id: msg.id,
                localId: msg.localId,
                createdAt: msg.createdAt,
                blocks: msg.content.blocks,
                status: msg.status,
                originalText: msg.originalText,
                meta: msg.meta,
                isSynthetic: msg.isSynthetic
            })
            continue
        }

        if (msg.role === 'agent') {
            const isSnapshot = msg.snapshot === true
            // agent block 的稳定 id：snapshot 与 full message 共享 localId（CLI 侧统一为 sdkUuid），
            // 用 localId 作 key 前缀避免 snapshot→full 时 block.id 变化触发 TextBlock 重 mount。
            // 用 `||` 而非 `??`：防空字符串 localId 退化成畸形 ':idx' 导致 duplicate key
            const blockId = (idx: number) => `${msg.localId || msg.id}:${idx}`
            for (let idx = 0; idx < msg.content.length; idx += 1) {
                const c = msg.content[idx]
                if (c.type === 'text') {
                    // isSynthetic text 是 SDK/CLI 内部产生的消息（如 Skill 加载内容），
                    // 不应展示为独立对话气泡。若未来有需要展示的 synthetic text 类型，
                    // 需在此处按 content 特征做更细粒度的过滤
                    if (msg.isSynthetic) continue

                    if (isCliOutputText(c.text, msg.meta)) {
                        blocks.push(createCliOutputBlock({
                            id: `${msg.id}:${idx}`,
                            localId: msg.localId,
                            createdAt: msg.createdAt,
                            text: c.text,
                            source: 'assistant',
                            meta: msg.meta
                        }))
                        continue
                    }
                    blocks.push({
                        kind: 'agent-text',
                        id: blockId(idx),
                        localId: msg.localId,
                        createdAt: msg.createdAt,
                        text: c.text,
                        meta: msg.meta,
                        isSynthetic: msg.isSynthetic,
                        isSnapshot,
                    })
                    continue
                }

                if (c.type === 'reasoning') {
                    blocks.push({
                        kind: 'agent-reasoning',
                        id: blockId(idx),
                        localId: msg.localId,
                        createdAt: msg.createdAt,
                        text: c.text,
                        meta: msg.meta,
                        isSnapshot,
                        // thinking 耗时/完成标记（仅 remote 有，照搬 isSnapshot 透传路径）
                        ...(c.durationMs != null ? { durationMs: c.durationMs } : {}),
                        ...(c.done ? { done: true } : {}),
                    })
                    continue
                }

                // summary 消息转换为事件显示
                if (c.type === 'summary') {
                    blocks.push(createEventBlock({
                        id: `${msg.id}:${idx}`,
                        createdAt: msg.createdAt,
                        event: { type: 'summary', message: c.summary },
                        meta: msg.meta
                    }))
                    continue
                }

                if (c.type === 'tool-call') {
                    if (isHiddenTool(c.name)) {
                        if (isChangeTitleToolName(c.name)) {
                            const title = context.titleChangesByToolUseId.get(c.id) ?? extractTitleFromChangeTitleInput(c.input)
                            if (title && !context.emittedTitleChangeToolUseIds.has(c.id)) {
                                context.emittedTitleChangeToolUseIds.add(c.id)
                                blocks.push(createEventBlock({
                                    id: `${msg.id}:${idx}`,
                                    createdAt: msg.createdAt,
                                    event: { type: 'title-changed', title },
                                    meta: msg.meta
                                }))
                            }
                        }
                        continue
                    }

                    const permission = context.permissionsById.get(c.id)?.permission

                    let block = ensureToolBlock(blocks, toolBlocksById, c.id, {
                        createdAt: msg.createdAt,
                        localId: msg.localId,
                        meta: msg.meta,
                        name: c.name,
                        input: c.input,
                        description: c.description,
                        permission
                    }, blockIndexById)

                    if (block.tool.state === 'pending' && block.tool.permission?.status !== 'pending') {
                        block = { ...block, tool: { ...block.tool } }
                        block.tool.state = 'running'
                        block.tool.startedAt = msg.createdAt
                        replaceBlockById(blocks, blockIndexById, c.id, block)
                        toolBlocksById.set(c.id, block)
                    }

                    if ((c.name === 'Task' || c.name === 'Agent') && !context.consumedGroupIds.has(msg.id)) {
                        const sidechain = context.groups.get(msg.id) ?? null
                        if (sidechain && sidechain.length > 0) {
                            context.consumedGroupIds.add(msg.id)
                            const child = reduceTimeline(sidechain, context)
                            hasReadyEvent = hasReadyEvent || child.hasReadyEvent
                            const taskBlock = { ...block, children: child.blocks }
                            replaceBlockById(blocks, blockIndexById, c.id, taskBlock)
                            toolBlocksById.set(c.id, taskBlock)
                        }
                    }
                    continue
                }

                if (c.type === 'tool-result') {
                    if (context.hiddenToolUseIds.has(c.tool_use_id)) {
                        const hiddenToolName = context.hiddenToolUseIds.get(c.tool_use_id)
                        if (hiddenToolName && isPlanModeEnterTool(hiddenToolName)) {
                            blocks.push(createEventBlock({
                                id: `${msg.id}:${idx}`,
                                createdAt: msg.createdAt,
                                event: c.is_error
                                    ? { type: 'plan-mode-enter-failed' }
                                    : { type: 'plan-mode-entered' },
                                meta: msg.meta
                            }))
                        }
                        continue
                    }
                    {
                        const permEntry = context.permissionsById.get(c.tool_use_id)
                        if (permEntry && isHiddenTool(permEntry.toolName)) {
                            if (isPlanModeEnterTool(permEntry.toolName)) {
                                blocks.push(createEventBlock({
                                    id: `${msg.id}:${idx}`,
                                    createdAt: msg.createdAt,
                                    event: c.is_error
                                        ? { type: 'plan-mode-enter-failed' }
                                        : { type: 'plan-mode-entered' },
                                    meta: msg.meta
                                }))
                            }
                            continue
                        }
                    }
                    const title = context.titleChangesByToolUseId.get(c.tool_use_id) ?? null
                    if (title) {
                        if (!context.emittedTitleChangeToolUseIds.has(c.tool_use_id)) {
                            context.emittedTitleChangeToolUseIds.add(c.tool_use_id)
                            blocks.push(createEventBlock({
                                id: `${msg.id}:${idx}`,
                                createdAt: msg.createdAt,
                                event: { type: 'title-changed', title },
                                meta: msg.meta
                            }))
                        }
                        continue
                    }

                    const permissionEntry = context.permissionsById.get(c.tool_use_id)
                    const permissionFromResult = c.permissions ? ({
                        id: c.tool_use_id,
                        status: c.permissions.result === 'approved' ? 'approved' : 'denied',
                        date: c.permissions.date,
                        mode: c.permissions.mode,
                        allowedTools: c.permissions.allowedTools,
                        decision: c.permissions.decision,
                        // 保留 pending 时的 suggestions，供 approved 分支按 destination 显示档位文案
                        suggestions: permissionEntry?.permission.suggestions
                    } satisfies ToolPermission) : undefined

                    const permission = permissionFromResult ?? permissionEntry?.permission

                    const block = ensureToolBlock(blocks, toolBlocksById, c.tool_use_id, {
                        createdAt: msg.createdAt,
                        localId: msg.localId,
                        meta: msg.meta,
                        name: permissionEntry?.toolName ?? 'Tool',
                        input: permissionEntry?.input ?? null,
                        description: null,
                        permission
                    }, blockIndexById)

                    const completedBlock = { ...block, tool: { ...block.tool } }
                    // Skill 工具完成后将 "Launching" 替换为 "Launched"
                    completedBlock.tool.result = block.tool.name === 'Skill' && typeof c.content === 'string'
                        ? c.content.replace(/^Launching/, 'Launched')
                        : c.content
                    completedBlock.tool.completedAt = msg.createdAt
                    completedBlock.tool.state = c.is_error ? 'error' : 'completed'
                    // tool-result 携带的 Agent 完成指标
                    if (c.agentMetrics) {
                        completedBlock.tool.agentMetrics = c.agentMetrics
                    }
                    replaceBlockById(blocks, blockIndexById, c.tool_use_id, completedBlock)
                    toolBlocksById.set(c.tool_use_id, completedBlock)
                    continue
                }

                if (c.type === 'sidechain') {
                    blocks.push({
                        kind: 'user-text',
                        id: `${msg.id}:${idx}`,
                        localId: null,
                        createdAt: msg.createdAt,
                        blocks: [{ type: 'text', text: c.prompt }]
                    })
                }
            }
        }
    }

    return { blocks: mergeCliOutputBlocks(blocks), toolBlocksById, hasReadyEvent }
}
