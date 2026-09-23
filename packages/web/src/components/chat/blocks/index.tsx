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
import type { UserImageBlock, UserQuoteBlock } from '@mobi/shared'
import type { ChatBlock } from '@/domain/chat'
import type { SessionMetadataSummary } from '@/core/data/api/types'
import type { MobiApi } from '@/core/data/api/client'
import { fileRefContext } from '@/core/utils/fileUrl'
import { quoteAnchorProps } from '@/domain/chat/quoteSelection'
import { dedupeQuoteDirectiveText } from '@/domain/chat/quoteDirectives'
import { splitUserBodyAndAttachments } from '@/domain/chat/userContent'
import { locateQuotedMessage } from '@/core/lib/quoteLocate'
import { QuoteAnnotationsProvider } from '@/components/ui/QuoteDirectiveComponents'
import { TextBlock } from './TextBlock'
import { ReasoningBlock } from './ReasoningBlock'
import { CliOutputBlock } from './CliOutputBlock'
import { AgentEventBlock } from './AgentEventBlock'
import { ToolCallRenderer } from './ToolCallBlock'
import { CompactSummaryBlockComponent } from './CompactSummaryBlock'
import { CustomBlockView } from './CustomBlock'
import { CollapsibleUserMessage } from '../CollapsibleUserMessage'
import { UserBlocksView } from '../userBlocks/UserBlocksView'
import { UserBubbleHeader } from '../userBlocks/UserBubbleHeader'

/** 渲染 chat block 的上下文 */
export type ChatBlockContext = {
    metadata: SessionMetadataSummary | null
    isThinking: boolean
    /** API 客户端（用于权限操作） */
    api?: MobiApi
    /** 会话 ID（用于权限操作） */
    sessionId?: string
    /** 是否禁用操作 */
    disabled?: boolean
    /** 操作完成回调 */
    onDone?: () => void
    /** 禁止打开详情 Drawer（Agent Drawer 内的工具卡片不应再开 Drawer） */
    disableDrawer?: boolean
    /** turn-result 概要行尾的操作组工厂（复制/fork，PC only；按 block.id 命中才返回节点，
     *  其余事件/未命中返回 undefined） */
    turnResultActions?: (block: ChatBlock) => React.ReactNode
    /** 画板重编辑入口（仅 sketch 标记的 image block 渲染 hover 角标；spec D3/D4） */
    onEditSketchBlock?: (block: UserImageBlock) => void
    /** 引用条目点击定位入口（跳转前停贴底跟随的收口在 ChatContainer；缺省直连 locateQuotedMessage） */
    onQuoteLocate?: (messageId: string) => void
    /** 回应批注数据源：agent 消息 id → 触发本轮回复的 user 消息 quote blocks（按 directive
     *  index 对齐，位置 i = 注释 i+1；spec .scratch/response-annotations）。缺省 = 无批注数据，
     *  directive 按原文降级呈现 */
    resolveQuoteAnnotations?: (agentMessageId: string) => UserQuoteBlock[] | undefined
}

/** 根据 block 类型渲染对应组件 */
export function renderChatBlock(block: ChatBlock, ctx: ChatBlockContext): React.ReactNode {
    switch (block.kind) {
        case 'user-text': {
            // 选区引用锚点：消息容器锚（messageId+role）罩整条气泡；block 容器锚由
            // UserBlocksView 的 text 视图自带（documents/images 无 block 锚 → 天然不可引用）。
            // 正文只渲染 text（拆分单源 splitUserBodyAndAttachments）：图片/文档/引用收进
            // bubble header 附件层（renderUserBubbleHeader，引用收起为 chip，展开才占空间）
            const { body } = splitUserBodyAndAttachments(block.blocks)
            return (
                <div {...quoteAnchorProps({ messageId: block.localId, role: 'user' })}>
                    <CollapsibleUserMessage blocks={body} isSynthetic={block.isSynthetic}>
                        <UserBlocksView
                            blocks={body}
                            env={{
                                isSynthetic: block.isSynthetic,
                                refCtx: fileRefContext(ctx.sessionId, ctx.metadata),
                                onEditSketch: ctx.onEditSketchBlock,
                                quoteBlockAnchor: true,
                                // 引用条目点击 → 消息级定位（滚动 + 高亮；窗口外静默）
                                onQuoteLocate: ctx.onQuoteLocate ?? locateQuotedMessage,
                            }}
                        />
                    </CollapsibleUserMessage>
                </div>
            )
        }
        case 'agent-text':
            // 选区引用锚点：气泡即 text block 容器（message+block 锚同元素）；流式/snapshot 不可引用
            return (
                <div
                    {...quoteAnchorProps({
                        messageId: block.localId,
                        role: 'agent',
                        block: true,
                        allowed: !(block.isSnapshot || block.isStreaming),
                    })}
                >
                    <QuoteAnnotationsProvider
                        quotes={ctx.resolveQuoteAnnotations?.(block.id)}
                        onLocate={ctx.onQuoteLocate ?? locateQuotedMessage}
                    >
                        {/* 重复 directive 剔除（同 index 只留首个，handoff 失败模式）；输出前缀稳定，兼容流式 */}
                        <TextBlock text={dedupeQuoteDirectiveText(block.text)} isSynthetic={block.isSynthetic} isStreaming={block.isStreaming} aborted={block.aborted} />
                    </QuoteAnnotationsProvider>
                </div>
            )
        case 'agent-reasoning':
            return <ReasoningBlock text={block.text} thinking={ctx.isThinking} isStreaming={block.isStreaming} durationMs={block.durationMs} />
        case 'cli-output':
            return <CliOutputBlock text={block.text} />
        case 'compact-summary':
            return <CompactSummaryBlockComponent block={block} />
        case 'tool-call':
            return <ToolCallRenderer block={block} metadata={ctx.metadata} api={ctx.api} sessionId={ctx.sessionId} disabled={ctx.disabled} onDone={ctx.onDone} />
        case 'agent-event':
            return <AgentEventBlock block={block} actions={ctx.turnResultActions?.(block)} />
        case 'custom':
            return <CustomBlockView block={block} />
        default:
            return null
    }
}

/**
 * 用户气泡 header 的附件层（图片 / 文档 / 引用 chip）：与正文渲染（user-text 分支）共用
 * block 数据与取数上下文，无非 text block 时返回 undefined（header 槽保持零改动）。
 * 引用收起为「N 条引用」chip，条目点击定位源消息（滚动 + 高亮）。
 */
export function renderUserBubbleHeader(block: Extract<ChatBlock, { kind: 'user-text' }>, ctx: ChatBlockContext): React.ReactNode {
    if (!splitUserBodyAndAttachments(block.blocks).hasAttachments) return undefined
    return (
        <UserBubbleHeader
            blocks={block.blocks}
            env={{
                isSynthetic: block.isSynthetic,
                refCtx: fileRefContext(ctx.sessionId, ctx.metadata),
                onEditSketch: ctx.onEditSketchBlock,
                onQuoteLocate: ctx.onQuoteLocate ?? locateQuotedMessage,
            }}
        />
    )
}
