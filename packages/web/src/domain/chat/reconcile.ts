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

import type {
    AgentEvent,
    AgentEventBlock,
    AgentReasoningBlock,
    AgentTextBlock,
    ChatBlock,
    CliOutputBlock,
    EventDisplay,
    ToolCallBlock,
    ToolPermission,
    UserTextBlock,
} from './types'
import { areUserBlocksEqual } from './userContent'

export type ChatBlocksById = Map<string, ChatBlock>

export function indexBlocks(blocks: ChatBlock[], map: ChatBlocksById): void {
    for (const block of blocks) {
        map.set(block.id, block)
        if (block.kind === 'tool-call') {
            indexBlocks(block.children, map)
        }
    }
}

function areStringArraysEqual(left?: string[] | null, right?: string[] | null): boolean {
    if (left === right) return true
    if (!left || !right) return false
    if (left.length !== right.length) return false
    for (let i = 0; i < left.length; i += 1) {
        if (left[i] !== right[i]) return false
    }
    return true
}

import type { AnswersFormat } from '@/domain/tool/askUserQuestion'
import { normalizeAnswerEntry } from '@/domain/tool/askUserQuestion'

function areAnswersEqual(
    left?: AnswersFormat | null,
    right?: AnswersFormat | null
): boolean {
    if (left === right) return true
    if (!left || !right) return false
    const leftKeys = Object.keys(left)
    const rightKeys = Object.keys(right)
    if (leftKeys.length !== rightKeys.length) return false
    leftKeys.sort()
    rightKeys.sort()
    for (let i = 0; i < leftKeys.length; i += 1) {
        const leftKey = leftKeys[i]
        if (leftKey !== rightKeys[i]) return false
        const leftEntry = (left as Record<string, string[] | { answers: string[] }>)[leftKey]
        const rightEntry = (right as Record<string, string[] | { answers: string[] }>)[leftKey]
        if (!areStringArraysEqual(normalizeAnswerEntry(leftEntry), normalizeAnswerEntry(rightEntry))) return false
    }
    return true
}

function areSuggestionsEqual(left?: ToolPermission['suggestions'], right?: ToolPermission['suggestions']): boolean {
    if (left === right) return true
    if (!left || !right) return false
    if (left.length !== right.length) return false
    // suggestions 是 PermissionUpdate 对象数组，用 JSON 序列化比较（结构稳定）
    return JSON.stringify(left) === JSON.stringify(right)
}

function arePermissionsEqual(left?: ToolPermission, right?: ToolPermission): boolean {
    if (left === right) return true
    if (!left || !right) return false
    return left.id === right.id
        && left.status === right.status
        && left.reason === right.reason
        && left.mode === right.mode
        && left.decision === right.decision
        && left.date === right.date
        && left.createdAt === right.createdAt
        && left.completedAt === right.completedAt
        && areStringArraysEqual(left.allowedTools, right.allowedTools)
        && areAnswersEqual(left.answers, right.answers)
        && areSuggestionsEqual(left.suggestions, right.suggestions)
}

function getEventKey(event: AgentEvent): string {
    switch (event.type) {
        case 'switch':
            return `switch:${event.mode}`
        case 'message':
            return `message:${event.message}`
        case 'title-changed':
            return `title:${event.title}`
        case 'limit-reached':
            return `limit:${event.endsAt}`
        case 'ready':
            return 'ready'
        default:
            try {
                return JSON.stringify(event)
            } catch {
                return event.type
            }
    }
}

function areAgentEventsEqual(left: AgentEvent, right: AgentEvent): boolean {
    if (left === right) return true
    return getEventKey(left) === getEventKey(right)
}

/**
 * blocks 相等判定复用 userContent.ts 的单源实现（逐字段比较，与 CollapsibleUserMessage
 * memo 比较器同一份）——本地不再维护 JSON.stringify 版本，避免两套语义漂移。
 * 语义对齐旧 text 字符串比较：重归一产出新数组但内容相同 → 仍保持旧引用。
 */
function areUserTextBlocksEqual(left: UserTextBlock, right: UserTextBlock): boolean {
    return areUserBlocksEqual(left.blocks, right.blocks)
        && left.status === right.status
        && left.originalText === right.originalText
        && left.localId === right.localId
        && left.createdAt === right.createdAt
        && left.meta === right.meta
        && left.isSynthetic === right.isSynthetic
}

function areAgentTextBlocksEqual(left: AgentTextBlock, right: AgentTextBlock): boolean {
    return left.text === right.text
        && left.localId === right.localId
        && left.createdAt === right.createdAt
        && left.meta === right.meta
        && left.isSynthetic === right.isSynthetic
        && left.isSnapshot === right.isSnapshot
}

function areAgentReasoningBlocksEqual(left: AgentReasoningBlock, right: AgentReasoningBlock): boolean {
    return left.text === right.text
        && left.localId === right.localId
        && left.createdAt === right.createdAt
        && left.meta === right.meta
        && left.durationMs === right.durationMs
        && left.done === right.done
}

function areCliOutputBlocksEqual(left: CliOutputBlock, right: CliOutputBlock): boolean {
    return left.text === right.text
        && left.localId === right.localId
        && left.createdAt === right.createdAt
        && left.source === right.source
        && left.meta === right.meta
}

function areEventDisplaysEqual(left?: EventDisplay, right?: EventDisplay): boolean {
    if (left === right) return true
    if (!left || !right) return false
    return left.align === right.align
        && left.color === right.color
        && left.padding === right.padding
}

function areAgentEventBlocksEqual(left: AgentEventBlock, right: AgentEventBlock): boolean {
    return left.createdAt === right.createdAt
        && left.meta === right.meta
        && areEventDisplaysEqual(left.display, right.display)
        && areAgentEventsEqual(left.event, right.event)
}

/** 深度比较两个值（用于 tool.input / tool.result 等对象） */
function areDeepEqual(left: unknown, right: unknown): boolean {
    if (left === right) return true
    // 基本类型已由 === 处理，只有对象/数组需要序列化
    if (typeof left !== 'object' || typeof right !== 'object') return false
    if (left === null || right === null) return false
    try {
        return JSON.stringify(left) === JSON.stringify(right)
    } catch {
        return false
    }
}

/** 深度比较 AgentMetrics（值对象：{ tokens, toolUses, durationMs }） */
function areAgentMetricsEqual(left?: { tokens: number; toolUses: number; durationMs: number } | null, right?: { tokens: number; toolUses: number; durationMs: number } | null): boolean {
    if (left === right) return true
    if (!left || !right) return false
    return left.tokens === right.tokens
        && left.toolUses === right.toolUses
        && left.durationMs === right.durationMs
}

function areToolCallsEqual(left: ToolCallBlock, right: ToolCallBlock, childrenSame: boolean): boolean {
    if (!childrenSame) return false
    return left.localId === right.localId
        && left.createdAt === right.createdAt
        && left.meta === right.meta
        && left.tool.id === right.tool.id
        && left.tool.name === right.tool.name
        && left.tool.state === right.tool.state
        && areDeepEqual(left.tool.input, right.tool.input)
        && areDeepEqual(left.tool.result, right.tool.result)
        && left.tool.description === right.tool.description
        && left.tool.createdAt === right.tool.createdAt
        && left.tool.startedAt === right.tool.startedAt
        && left.tool.completedAt === right.tool.completedAt
        && arePermissionsEqual(left.tool.permission, right.tool.permission)
        && areAgentMetricsEqual(left.tool.agentMetrics, right.tool.agentMetrics)
        && left.tool.agentSummary === right.tool.agentSummary
}

function reconcileBlockList(blocks: ChatBlock[], prevById: ChatBlocksById): ChatBlock[] {
    let changed = false
    const reconciled = blocks.map((block) => {
        const next = reconcileBlock(block, prevById)
        if (next !== block) {
            changed = true
        }
        return next
    })
    return changed ? reconciled : blocks
}

function reconcileBlock(block: ChatBlock, prevById: ChatBlocksById): ChatBlock {
    const prev = prevById.get(block.id)

    if (block.kind === 'tool-call') {
        const nextChildren = reconcileBlockList(block.children, prevById)
        const nextBlock = nextChildren === block.children
            ? block
            : { ...block, children: nextChildren }

        if (prev && prev.kind === 'tool-call') {
            const childrenSame = prev.children.length === nextChildren.length
                && prev.children.every((child, idx) => child === nextChildren[idx])
            if (areToolCallsEqual(prev, nextBlock, childrenSame)) {
                return prev
            }
        }
        return nextBlock
    }

    if (!prev || prev.kind !== block.kind) {
        return block
    }

    if (block.kind === 'user-text') {
        const prevBlock = prev as UserTextBlock
        return areUserTextBlocksEqual(prevBlock, block) ? prevBlock : block
    }

    if (block.kind === 'agent-text') {
        const prevBlock = prev as AgentTextBlock
        return areAgentTextBlocksEqual(prevBlock, block) ? prevBlock : block
    }

    if (block.kind === 'cli-output') {
        const prevBlock = prev as CliOutputBlock
        return areCliOutputBlocksEqual(prevBlock, block) ? prevBlock : block
    }

    if (block.kind === 'agent-reasoning') {
        const prevBlock = prev as AgentReasoningBlock
        return areAgentReasoningBlocksEqual(prevBlock, block) ? prevBlock : block
    }

    if (block.kind === 'compact-summary') {
        // compact-summary 消息不需要特殊处理，直接返回
        return block
    }

    const prevBlock = prev as AgentEventBlock
    return areAgentEventBlocksEqual(prevBlock, block) ? prevBlock : block
}

export function reconcileChatBlocks(nextBlocks: ChatBlock[], prevById: ChatBlocksById): {
    blocks: ChatBlock[]
    byId: ChatBlocksById
} {
    const blocks = reconcileBlockList(nextBlocks, prevById)
    const byId: ChatBlocksById = new Map()
    indexBlocks(blocks, byId)
    return { blocks, byId }
}
