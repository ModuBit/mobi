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
import type { SessionMetadataSummary } from '@/core/data/api/types'
import { TextBlock } from './TextBlock'
import { ReasoningBlock } from './ReasoningBlock'
import { CliOutputBlock } from './CliOutputBlock'
import { AgentEventBlock } from './AgentEventBlock'
import { ToolCallRenderer } from './ToolCallBlock'

/** 渲染 chat block 的上下文 */
export type ChatBlockContext = {
    metadata: SessionMetadataSummary | null
    isThinking: boolean
}

/** 根据 block 类型渲染对应组件 */
export function renderChatBlock(block: ChatBlock, ctx: ChatBlockContext): React.ReactNode {
    switch (block.kind) {
        case 'user-text':
            return <TextBlock text={block.text} isSynthetic={block.isSynthetic} />
        case 'agent-text':
            return <TextBlock text={block.text} isSynthetic={block.isSynthetic} isStreaming={block.isStreaming} />
        case 'agent-reasoning':
            return <ReasoningBlock text={block.text} thinking={ctx.isThinking} isStreaming={block.isStreaming} />
        case 'cli-output':
            return <CliOutputBlock text={block.text} />
        case 'tool-call':
            return <ToolCallRenderer block={block} metadata={ctx.metadata} />
        case 'agent-event':
            return <AgentEventBlock block={block} />
        default:
            return null
    }
}
