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

/**
 * 聊天块渲染器注入上下文（分层治理票 03 破环）：
 * AgentDrawerContent（tool-card 抽屉，深在 ToolCallBlock 渲染树内）需要 blocks 渲染
 * 注册表，但 blocks/ToolCallBlock → ToolDetailDrawer → AgentDrawerContent → blocks
 * 成环。本文件只声明 Context 与 hook（零依赖不参与环）；渲染器值由 app/MainLayoutHost
 * （组装层外壳，可引一切）注入——依赖反转：渲染实现与消费解耦。
 */

import { createContext, useContext, type ReactNode } from 'react'
import type { ChatBlock } from '@/domain/chat'
import type { ChatBlockContext } from './types'
import type { ToolCallBlock, AgentReasoningBlock } from '@/domain/chat'
import type { IsActiveReasoning } from '@/domain/chat/groupToolCalls'

export type BubbleRenderers = {
    /** 单块渲染（renderChatBlock） */
    renderBlock: (block: ChatBlock, ctx: ChatBlockContext) => ReactNode
    /** 工具组渲染（ToolCallGroupRenderer） */
    renderToolGroup: (props: {
        blocks: Array<ToolCallBlock | AgentReasoningBlock>
        isActiveReasoning?: IsActiveReasoning
    } & ChatBlockContext) => ReactNode
}

const BubbleRenderContext = createContext<BubbleRenderers | null>(null)

/** 注入聊天块渲染器（app/MainLayoutHost 组装层挂载一次，值 = blocks 的 renderChatBlock / ToolCallGroupRenderer） */
export function BubbleRenderProvider({ value, children }: { value: BubbleRenderers; children: ReactNode }) {
    return <BubbleRenderContext.Provider value={value}>{children}</BubbleRenderContext.Provider>
}

/** 取聊天块渲染器（未注入 = 组装错误，fail fast） */
export function useBubbleRenderers(): BubbleRenderers {
    const ctx = useContext(BubbleRenderContext)
    if (!ctx) throw new Error('useBubbleRenderers 必须在 BubbleRenderProvider 内使用（app/MainLayoutHost 应挂载）')
    return ctx
}
