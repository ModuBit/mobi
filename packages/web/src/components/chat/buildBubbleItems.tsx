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
import { REWIND_COMMAND } from '@/domain/chat/presentation'
import { getUserPlainText } from '@/domain/chat/userContent'
import type { ChatBlockContext } from './blocks'
import { groupCollapsibleToolCalls } from '@/domain/chat/groupToolCalls'
import { renderChatBlock } from './blocks'
import { ToolCallGroupRenderer } from './blocks/ToolCallGroupBlock'

export type BuildBubbleOptions = {
    /** context-cleared 分隔线的翻译文本 */
    contextResetLabel: string
    /** rewind 截断点「已回退至此」分隔线的翻译文本 */
    rewoundToHereLabel: string
    /** skippedLinks>0 时显示的安全护栏跳过提示（{{count}} 插值） */
    skippedLinksLabel: string
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
    // 先基于原始 blocks 算最后一个 assistant block —— 既要驱动 typing/isThinking，
    // 也要判定「活跃 reasoning」（正在思考），后者需在分组前传给 groupCollapsibleToolCalls
    let lastAssistantBlockKey: string | null = null
    for (let i = blocks.length - 1; i >= 0; i--) {
        const block = blocks[i]
        if (block.kind === 'agent-text' || block.kind === 'agent-reasoning' || block.kind === 'tool-call') {
            lastAssistantBlockKey = block.id
            break
        }
    }

    // 活跃 reasoning（正在思考）= 最后一块 + turn running + 未打点 done：散落可见，不进组（与 running tool 一致）
    const isActiveReasoning = (b: { kind: 'agent-reasoning'; id: string; done?: boolean }): boolean =>
        isRunning && b.id === lastAssistantBlockKey && !b.done

    const grouped = groupCollapsibleToolCalls(blocks, { isActiveReasoning })

    const items: BubbleItemBase[] = []

    for (const block of grouped) {
        // 折叠组
        if (block.kind === 'tool-call-group') {
            items.push({
                key: block.id,
                role: 'assistant',
                content: <ToolCallGroupRenderer blocks={block.blocks} {...ctx} />,
                variant: 'borderless',
            })
            continue
        }

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

        // rewind-completed 事件渲染为「已回退至此」分隔线（对齐 context-cleared 分隔线形态，spec §4.4）；
        // 同时它是 isRewindInProgress 的完成标志（纯状态信号，此处承担视觉呈现）；
        // skippedLinks>0 时追加「N 个路径被安全护栏跳过（symlink/链接）」提示（spec E2）
        if (block.kind === 'agent-event' && block.event.type === 'rewind-completed') {
            const skippedLinks = (block.event as { skippedLinks?: number }).skippedLinks
            items.push({
                key: block.id,
                role: 'divider',
                content: (
                    <span style={{ fontSize: 12, color: 'var(--ant-color-text-tertiary)' }}>
                        {options.rewoundToHereLabel}
                        {skippedLinks && skippedLinks > 0
                            ? ` · ${options.skippedLinksLabel.replace('{{count}}', String(skippedLinks))}`
                            : ''}
                    </span>
                ),
                block,
            })
            continue
        }

        // compact-completed 是纯完成信号（供 isCompressing 退出压缩态），不渲染气泡：
        // 成功路径已有 compact-summary 反馈压缩统计，失败路径已有 assistant 回复说明原因
        if (block.kind === 'agent-event' && block.event.type === 'compact-completed') {
            continue
        }

        // rewind 起点合成行（ChatContainer 本地插入的 REWIND_COMMAND 标记，非真实消息）：
        // 仅驱动 isRewindInProgress 禁用 sender，不渲染气泡
        if (block.kind === 'user-text' && getUserPlainText(block.blocks).trim() === REWIND_COMMAND) {
            continue
        }

        const isLastRunningBlock = block.id === lastAssistantBlockKey && isRunning
        const isSnapshot = (block.kind === 'agent-text' || block.kind === 'agent-reasoning') && block.isSnapshot

        const blockCtx: ChatBlockContext = {
            ...ctx,
            // done 由 content_block_stop 打点（仅 remote）：思考已完成的 reasoning 不再显示「思考中」，
            // 消除「thinking 流完→text 开头」误判窗口。local 无 done（undefined）→ 退化为现有逻辑
            isThinking: block.kind === 'agent-reasoning' && isLastRunningBlock && !block.done,
        }

        // 流式 snapshot 块（未落库）逐字揭示，不依赖 turn running 状态：
        // snapshot 到达时 isRunning/isLastRunningBlock 可能尚未就绪（尤其首批），
        // 导致 isStreaming=false 全显。只要是未落库的 snapshot 就应逐字回放。
        // 依赖 messageCache 在 full message 到达时及时清理 snapshot（替换为 full），
        // 否则残留的旧 snapshot block 会被逐字回放（messageCache 正常路径保证不残留）
        const content = renderChatBlock(
            isSnapshot
                ? { ...block, isStreaming: true }
                : block,
            blockCtx,
        )
        if (content === null) continue

        let role: 'assistant' | 'user' | 'system' = 'user'
        if (ASSISTANT_BLOCK_KINDS.has(block.kind)) {
            role = 'assistant'
        } else if (block.kind === 'agent-event') {
            // turn-result 事件映射为 assistant 角色（独立 bubble）
            // 其他事件仍为 system 角色（无边框系统行）
            role = block.event.type === 'turn-result' ? 'assistant' : 'system'
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
