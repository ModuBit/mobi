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
 * composer 引用 chip 的共享业务件：节点定义 / NodeView / 文档操作。
 * 带引用业务语义，归 ui/shared；通用输入框（ui/base/interactive/chat-input）只
 * 通过 extraNodes 装配与 Handle 方法间接使用。
 */

export { ChatInputQuoteNode } from './ChatInputQuoteNode'
export { CHAT_INPUT_QUOTE_NODE_NAME, type ChatInputQuoteAttrs, type ChatInputQuoteOptions } from './chatInputQuoteTypes'
export {
    addQuoteToEditor,
    clearQuotesInEditor,
    collectQuotesFromDoc,
    extractQuotesFromEditorStateJSON,
    extractWireText,
    insertQuotesAtEnd,
    updateQuoteCommentInEditor,
} from './chatInputQuoteDoc'
