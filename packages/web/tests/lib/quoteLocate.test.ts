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
 * 引用条目点击 → 消息级定位（票 06）：命中滚动 + 高亮、display:contents 锚点解盒、
 * 窗口外静默三条外部行为。jsdom 无 scrollIntoView 与动画，均按约定 mock / 断言类名。
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
    locateQuotedMessage,
    resolveFragmentRange,
    QUOTE_FLASH_CLASS,
    QUOTE_FLASH_MS,
    QUOTE_FRAGMENT_HIGHLIGHT,
    type QuoteFragmentOffsets,
} from '@/core/lib/quoteLocate'

const FLASH_MS = 2400

describe('locateQuotedMessage 消息级定位', () => {
    let scrollIntoView: ReturnType<typeof vi.fn>

    beforeEach(() => {
        vi.useFakeTimers()
        scrollIntoView = vi.fn()
        // jsdom 未实现 scrollIntoView，挂 mock 后断言调用目标与参数
        Element.prototype.scrollIntoView = scrollIntoView
    })

    afterEach(() => {
        vi.useRealTimers()
        document.body.innerHTML = ''
        delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView
    })

    it('命中：平滑滚动居中 + 高亮类落真实盒后代，时长到期摘除', () => {
        document.body.innerHTML =
            '<div data-quote-message-id="m1" style="display: contents"><div class="collapsible-user-msg"></div></div>'
        const anchor = document.querySelector('[data-quote-message-id="m1"]')!
        const target = anchor.firstElementChild as HTMLElement

        locateQuotedMessage('m1')

        // display:contents 锚点无盒（「零矩形」坑）→ scrollIntoView 委托到首个真实盒后代
        expect(scrollIntoView).toHaveBeenCalledTimes(1)
        expect(scrollIntoView).toHaveBeenCalledWith({ behavior: 'smooth', block: 'center' })
        expect(scrollIntoView.mock.instances[0]).toBe(target)
        expect(target.classList.contains(QUOTE_FLASH_CLASS)).toBe(true)

        // 闪烁动画时长到期后摘类（定时器摘除，不用 animationend——jsdom 不跑动画）
        vi.advanceTimersByTime(FLASH_MS)
        expect(target.classList.contains(QUOTE_FLASH_CLASS)).toBe(false)
    })

    it('未命中（源消息不在当前滑动窗口）：静默无反应', () => {
        document.body.innerHTML = '<div data-quote-message-id="other"></div>'
        expect(() => locateQuotedMessage('missing')).not.toThrow()
        expect(scrollIntoView).not.toHaveBeenCalled()
    })

    it('锚点非 display:contents 时直接定位锚点自身', () => {
        document.body.innerHTML = '<div data-quote-message-id="m2"></div>'
        const anchor = document.querySelector('[data-quote-message-id="m2"]')!

        locateQuotedMessage('m2')

        expect(scrollIntoView.mock.instances[0]).toBe(anchor)
    })

    it(`整段闪烁时长 = QUOTE_FLASH_MS（${QUOTE_FLASH_MS}ms）`, () => {
        expect(QUOTE_FLASH_MS).toBe(2400)
    })
})

/** 搭一个「消息锚 > block 锚 > 富文本内容」的最小 DOM（选区引用锚点契约的真实形态）。
 *  紧凑书写：textContent 里的空白也计入 offset，缩进会破坏 fixture 的 offset 语义 */
function mountBlock() {
    document.body.innerHTML =
        '<div data-quote-message-id="m1" style="display: contents"><div data-quote-block=""><b>hello</b> world</div></div>'
    return document.querySelector('[data-quote-message-id="m1"]')!
}

describe('resolveFragmentRange 片段 Range 解析', () => {
    afterEach(() => {
        document.body.innerHTML = ''
    })

    it('单文本节点内：Range 文本与 offset 区间一致', () => {
        const anchor = mountBlock()
        // blockEl.textContent = "hello world"（b 内 5 字 + " world" 6 字）
        const range = resolveFragmentRange(anchor, { startOffset: 6, endOffset: 11 })
        expect(range).not.toBeNull()
        expect(range!.toString()).toBe('world')
    })

    it('跨元素边界：offset 按文本节点串接累计（与 textContent 同源）', () => {
        const anchor = mountBlock()
        const range = resolveFragmentRange(anchor, { startOffset: 2, endOffset: 8 })
        expect(range!.toString()).toBe('llo wo')
    })

    it('整个区间（0 到全长）', () => {
        const anchor = mountBlock()
        expect(resolveFragmentRange(anchor, { startOffset: 0, endOffset: 11 })!.toString()).toBe('hello world')
    })

    it('越界（end 超出文本总长）→ null（兜底整段高亮）', () => {
        const anchor = mountBlock()
        expect(resolveFragmentRange(anchor, { startOffset: 0, endOffset: 99 })).toBeNull()
    })

    it('start >= end / 负值 / 非有限数 → null', () => {
        const anchor = mountBlock()
        const bads: QuoteFragmentOffsets[] = [
            { startOffset: 5, endOffset: 5 },
            { startOffset: 6, endOffset: 5 },
            { startOffset: -1, endOffset: 3 },
            { startOffset: Number.NaN, endOffset: 3 },
            { startOffset: 0, endOffset: Number.POSITIVE_INFINITY },
        ]
        for (const offsets of bads) expect(resolveFragmentRange(anchor, offsets)).toBeNull()
    })

    it('锚内无 block 容器 → null', () => {
        document.body.innerHTML = '<div data-quote-message-id="m1"><p>plain</p></div>'
        const anchor = document.querySelector('[data-quote-message-id="m1"]')!
        expect(resolveFragmentRange(anchor, { startOffset: 0, endOffset: 3 })).toBeNull()
    })

    it('单段消息同元素双锚（block 锚=消息锚自身）也能解析（2026-09-28 实测坑）', () => {
        // agent 消息单 text block 时 quoteAnchorProps 全落在同一元素
        document.body.innerHTML =
            '<div data-quote-message-id="m1" data-quote-role="agent" data-quote-block=""><p>hello fragment</p></div>'
        const anchor = document.querySelector('[data-quote-message-id="m1"]')!
        const range = resolveFragmentRange(anchor, { startOffset: 6, endOffset: 14 })
        expect(range!.toString()).toBe('fragment')
    })

    it('缺 offsets → null', () => {
        const anchor = mountBlock()
        expect(resolveFragmentRange(anchor, {})).toBeNull()
        expect(resolveFragmentRange(anchor, { startOffset: 1 })).toBeNull()
    })

    it('excerpt 校验：Range 文本与落库 excerpt 不一致（渲染漂移）→ null 兜底', () => {
        const anchor = mountBlock()
        // offset 区间解析成功但文本与 excerpt 不符（如源消息重渲染后文本漂移）
        expect(resolveFragmentRange(anchor, { startOffset: 6, endOffset: 11, excerpt: 'world!' })).toBeNull()
        expect(resolveFragmentRange(anchor, { startOffset: 6, endOffset: 11, excerpt: 'world' })).not.toBeNull()
    })
})

describe('locateQuotedMessage 片段高亮', () => {
    let scrollIntoView: ReturnType<typeof vi.fn>
    /** jsdom 无 Highlight API：按真实形态伪造（CSS.highlights Map + Highlight 构造器） */
    let highlights: Map<string, unknown>

    beforeEach(() => {
        vi.useFakeTimers()
        scrollIntoView = vi.fn()
        Element.prototype.scrollIntoView = scrollIntoView
        highlights = new Map()
        ;(globalThis as { CSS: { highlights?: Map<string, unknown> } }).CSS.highlights = highlights
        ;(globalThis as { Highlight?: unknown }).Highlight = class {
            ranges: Range[]
            constructor(...ranges: Range[]) {
                this.ranges = ranges
            }
        }
    })

    afterEach(() => {
        vi.useRealTimers()
        document.body.innerHTML = ''
        delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView
        const css = globalThis as { CSS: { highlights?: Map<string, unknown> } }
        delete css.CSS.highlights
        delete (globalThis as { Highlight?: unknown }).Highlight
    })

    it('offsets 有效：片段入 CSS.highlights 定时摘除，滚动到片段容器', () => {
        const anchor = mountBlock()
        const textNode = anchor.querySelector('b')!.firstChild!

        locateQuotedMessage('m1', { startOffset: 0, endOffset: 5 })

        expect(highlights.has(QUOTE_FRAGMENT_HIGHLIGHT)).toBe(true)
        const hl = highlights.get(QUOTE_FRAGMENT_HIGHLIGHT) as { ranges: Range[] }
        expect(hl.ranges[0].toString()).toBe('hello')
        // 滚动目标是片段所在元素（长消息中片段可能离消息头很远），非消息锚
        expect(scrollIntoView.mock.instances[0]).toBe(textNode.parentElement)
        // 时长到期摘除高亮
        vi.advanceTimersByTime(QUOTE_FLASH_MS)
        expect(highlights.has(QUOTE_FRAGMENT_HIGHLIGHT)).toBe(false)
    })

    it('offsets 无效：兜底整段闪烁（消息级行为不变）', () => {
        const anchor = mountBlock()
        const target = anchor.querySelector('[data-quote-block]')!

        locateQuotedMessage('m1', { startOffset: 6, endOffset: 999 })

        expect(highlights.has(QUOTE_FRAGMENT_HIGHLIGHT)).toBe(false)
        expect(target.classList.contains(QUOTE_FLASH_CLASS)).toBe(true)
        expect(scrollIntoView.mock.instances[0]).toBe(target)
    })

    it('连续点击：旧片段先摘除再挂新（防定时器提前掐灭新高亮）', () => {
        mountBlock()
        locateQuotedMessage('m1', { startOffset: 0, endOffset: 5 })
        vi.advanceTimersByTime(1000)
        locateQuotedMessage('m1', { startOffset: 6, endOffset: 11 })
        expect(highlights.has(QUOTE_FRAGMENT_HIGHLIGHT)).toBe(true)
        // 第一次的定时器到期不再误摘第二次的高亮
        vi.advanceTimersByTime(1400)
        expect(highlights.has(QUOTE_FRAGMENT_HIGHLIGHT)).toBe(true)
        vi.advanceTimersByTime(1000)
        expect(highlights.has(QUOTE_FRAGMENT_HIGHLIGHT)).toBe(false)
    })
})
