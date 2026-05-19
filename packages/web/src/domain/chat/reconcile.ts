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

export type ChatBlocksById = Map<string, ChatBlock>

function indexBlocks(blocks: ChatBlock[], map: ChatBlocksById): void {
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

function areUserTextBlocksEqual(left: UserTextBlock, right: UserTextBlock): boolean {
    return left.text === right.text
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
}

function areAgentReasoningBlocksEqual(left: AgentReasoningBlock, right: AgentReasoningBlock): boolean {
    return left.text === right.text
        && left.localId === right.localId
        && left.createdAt === right.createdAt
        && left.meta === right.meta
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

function areToolCallsEqual(left: ToolCallBlock, right: ToolCallBlock, childrenSame: boolean): boolean {
    if (!childrenSame) return false
    return left.localId === right.localId
        && left.createdAt === right.createdAt
        && left.meta === right.meta
        && left.tool.id === right.tool.id
        && left.tool.name === right.tool.name
        && left.tool.state === right.tool.state
        && left.tool.input === right.tool.input
        && left.tool.result === right.tool.result
        && left.tool.description === right.tool.description
        && left.tool.createdAt === right.tool.createdAt
        && left.tool.startedAt === right.tool.startedAt
        && left.tool.completedAt === right.tool.completedAt
        && arePermissionsEqual(left.tool.permission, right.tool.permission)
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
