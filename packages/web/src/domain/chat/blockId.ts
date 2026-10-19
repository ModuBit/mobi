/*
 * Copyright Maner·Fan
 *
 * Licensed under the Apache License, Version 2.0 (the License);
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

import { extractAnthropicMessageId } from '@mobi/shared'

/**
 * 消息 → 块 id 前缀（block id 的唯一口径）。
 *
 * snapshot 行与 full 行的 localId 并不相同（前者是 message_start 的 stream uuid，
 * 后者是落库用的 .jsonl uuid），拿它作 key 会让 snapshot→full 时 block.id 变化、
 * 整块重 mount（thinking 标题重新播淡入 = 思考完成后「再闪一下」的根因）。两者真正
 * 共享的是 Anthropic message.id，优先用它；缺 id 的历史/本地消息回退 localId/行 id。
 * `||` 防空串退化。
 *
 * 消费方：reducerTimeline 的块 id、ChatContainer 的 fork 查表、agent 块 key 反解。
 */
export function messageBlockKeyPrefix(msg: {
    messageId?: string | null
    localId: string | null
    id: string
}): string {
    return msg.messageId || msg.localId || msg.id
}

/**
 * 原始 DecryptedMessage 行 → 同口径前缀。
 * 协议行本身没有 messageId 字段（那是 normalize 之后才有的），必须从 content 信封提取，
 * 否则回退到 localId 会与 reducer 的 message.id 前缀永久不一致（fork 查表恒 miss）。
 */
export function decryptedMessageBlockKeyPrefix(msg: {
    content: unknown
    localId: string | null
    id: string
}): string {
    return extractAnthropicMessageId(msg.content) || msg.localId || msg.id
}

/**
 * agent 文本块 → 消息行 key（供 metadata/seq 查表）：取 block.id 的 `:idx` 前缀，
 * 与 {@link messageBlockKeyPrefix} 同源。按最后一个 ':' 切——消息 id 本身可含 ':'。
 */
export function agentBlockMessageKey(block: { id: string }): string {
    const idx = block.id.lastIndexOf(':')
    return idx > 0 ? block.id.slice(0, idx) : block.id
}
