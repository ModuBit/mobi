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
import { fileRefContext } from '@/core/utils/fileUrl'
import { quoteAnchorProps } from '@/domain/chat/quoteSelection'
import { splitUserBodyAndAttachments } from '@/domain/chat/userContent'
import { locateQuotedMessage } from '@/core/lib/quoteLocate'
import { QuoteAnnotationsProvider } from '@/ui/shared/quoteDirectiveComponents'
import { ArtifactEnvProvider } from '@/ui/shared/artifactDirectiveComponents'
import { OpenUIAnchorProvider } from '@/ui/openui/actionContext'
import type { ChatBlockContext } from './types'
import { TextBlock } from './TextBlock'
import { ReasoningBlock } from './ReasoningBlock'
import { CliOutputBlock } from './CliOutputBlock'
import { AgentEventBlock } from './AgentEventBlock'
import { SystemNoticeBlock } from './SystemNoticeBlock'
import { ToolCallRenderer } from './toolCallBlock'
import { CompactSummaryBlockComponent } from './compactSummaryBlock'
import { CustomBlockView } from './customBlock'
import { CollapsibleUserMessage } from '../CollapsibleUserMessage'
import { UserBlocksView } from '../userBlocks/UserBlocksView'
import { UserBubbleHeader } from '../userBlocks/UserBubbleHeader'

/** ChatBlockContext 类型定义已抽离 blocks/types.ts（分层治理票 03 破装配环），此处保留兼容 re-export */
export type { ChatBlockContext } from './types'

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
                        {/* 产物声明寻址上下文（read-file / file/open 构造所需），与引用批注同点注入；
                            档③锚点（block.id，引用批注同词汇）同点注入——openui 块的原地更新靠它定向 */}
                        <ArtifactEnvProvider refCtx={fileRefContext(ctx.sessionId, ctx.metadata)}>
                            <OpenUIAnchorProvider anchor={block.id}>
                                <TextBlock text={block.text} isSynthetic={block.isSynthetic} isStreaming={block.isStreaming} aborted={block.aborted} />
                            </OpenUIAnchorProvider>
                        </ArtifactEnvProvider>
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
        case 'system-notice':
            return <SystemNoticeBlock block={block} />
        case 'custom':
            return <CustomBlockView block={block} sessionId={ctx.sessionId} />
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
