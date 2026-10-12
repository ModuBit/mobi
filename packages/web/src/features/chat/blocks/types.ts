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
 * ChatBlock 渲染上下文的类型定义。独立成文件（分层治理票 03）：装配器
 * buildBubbleItems 需要 ctx 类型但不应静态依赖渲染注册表（blocks/index），
 * 否则构成 blocks → tool-card → buildBubbleItems → blocks 的装配环。
 */

import type { ReactNode } from 'react'
import type { UserImageBlock, UserQuoteBlock } from '@mobi/shared'
import type { ChatBlock } from '@/domain/chat'
import type { SessionMetadataSummary } from '@/core/data/api/types'
import type { MobiApi } from '@/core/data/api/client'
import type { QuoteLocateFn } from '@/core/lib/quoteLocate'

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
    turnResultActions?: (block: ChatBlock) => ReactNode
    /** 画板重编辑入口（仅 sketch 标记的 image block 渲染 hover 角标；spec D3/D4） */
    onEditSketchBlock?: (block: UserImageBlock) => void
    /** 引用条目点击定位入口（跳转前停贴底跟随的收口在 ChatContainer；缺省直连 locateQuotedMessage） */
    onQuoteLocate?: QuoteLocateFn
    /** 回应批注数据源：agent 消息 id → 触发本轮回复的 user 消息 quote blocks（按 directive
     *  index 对齐，位置 i = 注释 i+1；spec .scratch/response-annotations）。缺省 = 无批注数据，
     *  directive 按原文降级呈现 */
    resolveQuoteAnnotations?: (agentMessageId: string) => UserQuoteBlock[] | undefined
}
