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
 * 引用条目点击 → 定位（票 06 + 片段高亮）：在整个文档查消息容器锚
 * （data-quote-message-id，选区引用锚点契约的读侧反向消费），命中则平滑滚动居中 +
 * 高亮。两级形态：
 *
 * - 片段级（首选）：引用带 startOffset/endOffset（选区引用落库的预留事实）时，在
 *   block 容器锚内把 UTF-16 offset 映射回真实 DOM Range，经 CSS Custom Highlight API
 *   高亮片段（注册表挂高亮，不动 React 树）。滚动目标 = 片段所在元素（长消息中片段
 *   可能远离消息头）。
 * - 消息级（兜底）：任何失败——无 offsets、offsets 非法/越界、无 block 锚、浏览器不
 *   支持 Highlight API——退回整条消息闪烁（历史行为）；源消息不在当前滑动窗口静默返回。
 *
 * 纯 DOM 命令式动作、无 React 状态（放 core/lib：与 composerDrafts 等同层，domain/chat
 * 保持纯函数），由 UserBlocksView 的 env.onQuoteLocate 能力位接线（对齐 onEditSketch 的
 * 可选模式：能力只在聊天列表接线处有意义，非聊天上下文退化为纯展示）。
 *
 * 高亮样式注入：消息级闪烁动画（QUOTE_FLASH_CLASS 的 keyframes）与片段高亮
 * （::highlight(QUOTE_FRAGMENT_HIGHLIGHT)）均由 React 树侧单份注入（ChatContainer
 * quoteFlashStyles，随聊天列表生灭；本模块无渲染上下文）。
 */

import type { UserQuoteBlock } from '@mobi/shared'
import { resolveQuoteAnchorTarget, QUOTE_BLOCK_ATTR } from '@/domain/chat/quoteSelection'

/** 高亮类名（ChatContainer 的 Global 样式按此名定义闪烁动画；导出供测试断言） */
export const QUOTE_FLASH_CLASS = 'quote-locate-flash'

/** 闪烁时长（ms）：到期由定时器摘类（不用 animationend——jsdom 不跑动画，永不触发） */
export const QUOTE_FLASH_MS = 2400

/** 片段高亮注册名（CSS.highlights key；样式见 ChatContainer ::highlight 规则） */
export const QUOTE_FRAGMENT_HIGHLIGHT = 'quote-fragment-flash'

/** 引用落库的片段位置（shared QuoteBlockSchema 同名字段；excerpt 供片段忠实校验） */
export interface QuoteFragmentOffsets {
    startOffset?: number
    endOffset?: number
    excerpt?: string
}

/** 引用点击 → 定位的统一签名（composer 引用条 / 气泡引用 chip / 回应批注标记三处入口共用） */
export type QuoteLocateFn = (messageId: string, offsets?: QuoteFragmentOffsets) => void

/** shared quote block → 片段位置入参（旧消息未落 offsets 传 undefined = 消息级兜底） */
export function quoteOffsetsOf(block: Pick<UserQuoteBlock, 'startOffset' | 'endOffset' | 'excerpt'>): QuoteFragmentOffsets {
    return { startOffset: block.startOffset, endOffset: block.endOffset, excerpt: block.excerpt }
}

/** 在飞的高亮：闪烁类与片段注册共用一处防堆积（连续点击先摘旧再挂新，旧定时器不掐灭新高亮） */
interface ActiveFlash {
    clear: () => void
    timer: ReturnType<typeof setTimeout>
}
let activeFlash: ActiveFlash | null = null

function clearActiveFlash(): void {
    if (!activeFlash) return
    clearTimeout(activeFlash.timer)
    activeFlash.clear()
    activeFlash = null
}

/**
 * 片段位置 → block 容器内的真实 DOM Range。
 *
 * offset 语义与选区判定器落库口径同源：相对 blockEl.textContent 的 UTF-16 code unit
 * （Range.toString 与 textContent 都是文本节点串接，按文本节点累积长度即可双向映射；
 * Range.toString() 用于校验，防「文本节点之外的内容计入 textContent」的口径漂移）。
 * 任何不合法（缺字段 / 非有限数 / 负值 / start>=end / 越界 / 无 block 锚）返回 null，
 * 调用方兜底消息级高亮。
 */
export function resolveFragmentRange(anchor: Element, offsets: QuoteFragmentOffsets): Range | null {
    const { startOffset, endOffset } = offsets
    if (
        typeof startOffset !== 'number' || typeof endOffset !== 'number'
        || !Number.isFinite(startOffset) || !Number.isFinite(endOffset)
        || startOffset < 0 || startOffset >= endOffset
    ) {
        return null
    }

    // block 锚可能在锚链任意层：单段 agent 消息的 block 锚就是消息容器自身（同元素
    // 双锚），多 block 消息（user）才是后代元素——两种形态都要命中
    const blockEl = anchor.matches(`[${QUOTE_BLOCK_ATTR}]`)
        ? anchor
        : anchor.querySelector(`[${QUOTE_BLOCK_ATTR}]`)
    if (!blockEl) return null

    // offset → (文本节点, 节点内偏移)：按累积长度一次遍历定位。end 是排他边界，
    // 等于总长时命末节点的 data 末尾（offset=len 对 end 合法），isEnd 特判放行
    const locate = (target: number, isEnd = false): { node: Text; offset: number } | null => {
        let acc = 0
        const walker = document.createTreeWalker(blockEl, NodeFilter.SHOW_TEXT)
        for (let node = walker.nextNode() as Text | null; node; node = walker.nextNode() as Text | null) {
            if (target < acc + node.data.length || (isEnd && target === acc + node.data.length)) {
                return { node, offset: target - acc }
            }
            acc += node.data.length
        }
        return null
    }
    const start = locate(startOffset)
    const end = locate(endOffset, true)
    if (!start || !end) return null

    const range = document.createRange()
    range.setStart(start.node, start.offset)
    range.setEnd(end.node, end.offset)
    // 双重校验：① 长度一致（防空白节点/CDATA 等边缘计数漂移）② 文本与落库 excerpt
    // 逐字一致（offset 是「落库时渲染」口径，消息重渲染后文本可能漂移（如 markdown
    // 层增量变化）——错位高亮比不高亮更糟，不一致即兜底整段）
    if (range.toString().length !== endOffset - startOffset) return null
    if (offsets.excerpt !== undefined && range.toString() !== offsets.excerpt) return null
    return range
}

/**
 * 片段高亮执行（CSS Custom Highlight API）：注册静态高亮（::highlight 的背景动画在
 * 主流浏览器不可靠，用「常亮 + 定时摘除」形态，时长与整段闪烁一致），滚动到片段。
 * 特性检测失败返回 false，调用方兜底消息级。
 */
function highlightFragment(range: Range): boolean {
    // 特性检测：Highlight 构造器 + CSS.highlights 注册表（Chrome 105+ / Safari 17.2+）。
    // CSS.highlights 是 Map-like 但不保证 instanceof Map（Chrome 153 实测非 Map 子类），
    // 按 duck typing 判
    const registry = typeof CSS !== 'undefined' ? CSS.highlights : undefined
    if (typeof Highlight === 'undefined' || !registry || typeof registry.set !== 'function' || typeof registry.delete !== 'function') {
        return false
    }

    // 旧高亮先摘：同 key set 虽然覆盖注册项，但旧 activeFlash 定时器仍会在飞，
    // 到期会把新挂的高亮提前删掉（连续点击场景）
    clearActiveFlash()

    // 滚动目标：片段起始所在元素（文本节点 → 其父元素；元素端点直用）
    const startEl = range.startContainer.nodeType === Node.ELEMENT_NODE
        ? (range.startContainer as HTMLElement)
        : range.startContainer.parentElement
    if (!startEl) return false

    CSS.highlights.set(QUOTE_FRAGMENT_HIGHLIGHT, new Highlight(range))
    startEl.scrollIntoView({ behavior: 'smooth', block: 'center' })
    activeFlash = {
        clear: () => CSS.highlights.delete(QUOTE_FRAGMENT_HIGHLIGHT),
        timer: setTimeout(() => {
            CSS.highlights.delete(QUOTE_FRAGMENT_HIGHLIGHT)
            activeFlash = null
        }, QUOTE_FLASH_MS),
    }
    return true
}

/**
 * 定位执行：查锚 → （片段可解析且高亮可注册时）片段高亮 / 兜底 → 整条消息闪烁。
 */
export function locateQuotedMessage(messageId: string, offsets?: QuoteFragmentOffsets): void {
    // 消息 id 实际是 uuid，仍防御性转义后再进选择器
    const escaped = typeof CSS !== 'undefined' && typeof CSS.escape === 'function'
        ? CSS.escape(messageId)
        : messageId
    const anchor = document.querySelector(`[data-quote-message-id="${escaped}"]`)
    if (!anchor) return

    // 片段级：解析或高亮注册任一失败即走消息级兜底
    if (offsets) {
        const range = resolveFragmentRange(anchor, offsets)
        if (range && highlightFragment(range)) return
    }

    // 锚点→可定位目标的解析属锚点契约，收口在 quoteSelection（/simplify）
    const target = resolveQuoteAnchorTarget(anchor)

    clearActiveFlash()

    target.scrollIntoView({ behavior: 'smooth', block: 'center' })
    // 先摘类再强制重排后重挂：连续点击同一目标时闪烁动画从头重放
    target.classList.remove(QUOTE_FLASH_CLASS)
    void (target as HTMLElement).offsetWidth
    target.classList.add(QUOTE_FLASH_CLASS)
    activeFlash = {
        clear: () => target.classList.remove(QUOTE_FLASH_CLASS),
        timer: setTimeout(() => {
            target.classList.remove(QUOTE_FLASH_CLASS)
            activeFlash = null
        }, QUOTE_FLASH_MS),
    }
}
