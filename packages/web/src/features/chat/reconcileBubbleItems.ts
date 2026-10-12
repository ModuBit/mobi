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

import type { ChatBubbleItem } from './BubbleListChat'

/** 上一帧的 item 缓存（按 item.key 索引） */
export type BubbleItemsCache = Map<string, ChatBubbleItem>

/**
 * bubble item 的结构化共享 —— 对齐 `reconcileChatBlocks` 的思路，把「引用稳定」
 * 从 ChatBlock 层延伸到 Virtuoso item 层。
 *
 * ## 为什么需要
 *
 * `buildChatBubbleItems` 每次调用都会产出全新的 item 对象与全新的 `content` React 元素，
 * 外层装饰（header/footer/classNames）又会再包一层新对象。即使 `reconcileChatBlocks`
 * 已让 `block` 引用保持稳定，item 对象仍每帧重建 → `BubbleItem` 的 `React.memo`
 * 浅比较必然失败 → 视口内每个 antdx Bubble 全量重渲染。
 *
 * 复用旧 item 时连同旧的 `content` 元素一起复用，React 遇到**同一个元素引用**会直接
 * bailout（连 diff 都不做），这是比 memo 更彻底的短路。
 *
 * ## 复用判据
 *
 * `content` 由 `block` + 渲染上下文推导。故 block 引用不变、且影响渲染的标志位
 * （role/typing/variant）不变时，content 必然等价，可整体复用旧 item。
 *
 * 渲染上下文（api / metadata / disabled 等）变化时，调用方必须传空 cache 强制重建
 * ——否则会复用捕获了旧 ctx 的 content。这一点由 ChatContainer 的 useMemo 依赖保证。
 *
 * 不带 `block` 的合成项（divider 占位、`__compressing__` 等）一律不复用：它们没有
 * 可比对的身份，数量极少，重建成本可忽略。
 */
export function reconcileBubbleItems(
    next: ChatBubbleItem[],
    prev: BubbleItemsCache,
): { items: ChatBubbleItem[]; cache: BubbleItemsCache } {
    const cache: BubbleItemsCache = new Map()
    const items = next.map((item) => {
        const old = prev.get(item.key)
        const reusable = old !== undefined
            && item.block !== undefined
            && old.block === item.block
            && old.role === item.role
            && old.typing === item.typing
            && old.variant === item.variant
        // 复用 old（含上次已挂的 data-bubble-key，引用稳定 → Bubble.List memo 生效）；
        // 新建项在此挂 data-bubble-key（供 offsetTop restore 测量 + 调试定位），
        // 这样上游 ChatContainer→BubbleListChat 无需再 spread 造新对象击穿 memo
        const result = reusable ? old : { ...item, 'data-bubble-key': item.key }
        cache.set(item.key, result)
        return result
    })
    return { items, cache }
}
