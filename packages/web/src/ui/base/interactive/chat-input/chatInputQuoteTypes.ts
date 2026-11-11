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
 * 引用 chip 节点的名称与 attrs/options 类型（节点定义与 NodeView 共用）。
 * 独立成模块：节点文件 import NodeView（值），NodeView import 类型——同文件会成环。
 */

/** 节点名（消费方遍历/计数以此寻址） */
export const CHAT_INPUT_QUOTE_NODE_NAME = 'chatInputQuote'

/** 节点属性：业务无关透传（uid/messageId/role/excerpt/comment 由装配方约定语义） */
export interface ChatInputQuoteAttrs {
    uid: string
    messageId: string
    role: 'user' | 'agent'
    excerpt: string
    comment?: string | null
}

export interface ChatInputQuoteOptions {
    /** chip 主体点击（非 × / 非评论浮层）定位源消息 */
    onLocate?: (messageId: string) => void
}
