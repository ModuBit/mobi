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

import type React from 'react'
import type { ChatBlock } from '@/domain/chat'
import type { ChatBlockContext } from './blocks'
import { renderChatBlock } from './blocks'

export type BuildBubbleOptions = {
    /** context-cleared 分隔线的翻译文本 */
    contextResetLabel: string
}

const ASSISTANT_BLOCK_KINDS = new Set(['agent-text', 'agent-reasoning', 'tool-call', 'compact-summary'])

export type BubbleItemBase = {
    key: string
    role: 'assistant' | 'user' | 'system' | 'divider'
    content: React.ReactNode
    typing?: boolean
    variant?: 'borderless'
    /** 关联的原始 ChatBlock（divider 项可能为 undefined） */
    block?: ChatBlock
}

/**
 * 从 ChatBlock[] 构建气泡列表项
 * 统一处理角色判断、流式渲染、typing 动画
 */
export function buildChatBubbleItems(
    blocks: ChatBlock[],
    ctx: ChatBlockContext,
    isRunning: boolean,
    options: BuildBubbleOptions,
): BubbleItemBase[] {
    // 找到最后一个 assistant block（用于 typing 动画）
    let lastAssistantBlockKey: string | null = null
    for (let i = blocks.length - 1; i >= 0; i--) {
        const block = blocks[i]
        if (block.kind === 'agent-text' || block.kind === 'agent-reasoning') {
            lastAssistantBlockKey = block.id
            break
        }
    }

    const items: BubbleItemBase[] = []

    for (const block of blocks) {
        // context-cleared 事件渲染为分隔线
        if (block.kind === 'agent-event' && block.event.type === 'context-cleared') {
            items.push({
                key: block.id,
                role: 'divider',
                content: <span style={{ fontSize: 12, color: 'var(--ant-color-text-tertiary)' }}>{options.contextResetLabel}</span>,
                block,
            })
            continue
        }

        const isLastRunningBlock = block.id === lastAssistantBlockKey && isRunning
        const isSnapshot = (block.kind === 'agent-text' || block.kind === 'agent-reasoning') && block.isSnapshot

        const blockCtx: ChatBlockContext = {
            ...ctx,
            isThinking: block.kind === 'agent-reasoning' && isLastRunningBlock,
        }

        const content = renderChatBlock(
            isLastRunningBlock && isSnapshot
                ? { ...block, isStreaming: true }
                : block,
            blockCtx,
        )
        if (content === null) continue

        let role: 'assistant' | 'user' | 'system' = 'user'
        if (ASSISTANT_BLOCK_KINDS.has(block.kind)) {
            role = 'assistant'
        } else if (block.kind === 'agent-event') {
            role = 'system'
        } else if (block.kind === 'cli-output') {
            role = block.source === 'assistant' ? 'assistant' : 'user'
        }

        const isTyping = role === 'assistant' &&
            (block.kind === 'agent-text' || block.kind === 'agent-reasoning') &&
            isLastRunningBlock

        items.push({
            key: block.id,
            role,
            content,
            typing: isTyping,
            variant: (role === 'system' || role === 'assistant') ? 'borderless' : undefined,
            block,
        })
    }

    return items
}
