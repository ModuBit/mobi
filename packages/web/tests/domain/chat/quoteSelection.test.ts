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
 * quoteSelection（选区判定器）决策表测试
 * jsdom 构造符合锚点契约的 DOM + Range，覆盖全部接受路径与全部拒绝原因，
 * 不依赖真实选择事件（DOM 事件监听与 popover 是票 04 的薄壳，不在本测试范围）
 */

import { describe, it, expect, afterEach } from 'vitest'
import { resolveQuoteSelection } from '@/domain/chat/quoteSelection'
import { QUOTE_EXCERPT_MAX } from '@mobi/shared'
import { QUOTE_MAX_COUNT } from '@/domain/chat/composerSegments'

// ── DOM 构造辅助：按锚点契约搭出最小聊天 DOM ──

let root: HTMLElement | null = null

function mount(): HTMLElement {
    root = document.createElement('div')
    document.body.appendChild(root)
    return root
}

afterEach(() => {
    root?.remove()
    root = null
})

interface MessageOptions {
    id: string
    role: 'user' | 'agent'
    /** 流式生成中：容器标记 data-quote-allowed="false" */
    streaming?: boolean
}

/** 消息正文容器（data-quote-message-id + data-quote-role 锚点） */
function appendMessage(parent: HTMLElement, opts: MessageOptions): HTMLElement {
    const msg = document.createElement('div')
    msg.setAttribute('data-quote-message-id', opts.id)
    msg.setAttribute('data-quote-role', opts.role)
    if (opts.streaming) msg.setAttribute('data-quote-allowed', 'false')
    parent.appendChild(msg)
    return msg
}

/** text block 渲染容器（data-quote-block 锚点），返回容器与其文本节点 */
function appendBlock(message: HTMLElement, text: string): { block: HTMLElement; textNode: Text } {
    const block = document.createElement('div')
    block.setAttribute('data-quote-block', '')
    const p = document.createElement('p')
    const textNode = document.createTextNode(text)
    p.appendChild(textNode)
    block.appendChild(p)
    message.appendChild(block)
    return { block, textNode }
}

/** 禁区容器（data-quote-forbidden：工具卡 / thinking 折叠块 / 引用组通用），返回其文本节点 */
function appendForbidden(parent: HTMLElement, text: string): Text {
    const zone = document.createElement('div')
    zone.setAttribute('data-quote-forbidden', '')
    const textNode = document.createTextNode(text)
    zone.appendChild(textNode)
    parent.appendChild(zone)
    return textNode
}

function makeRange(startNode: Node, startOffset: number, endNode: Node, endOffset: number): Range {
    const range = document.createRange()
    range.setStart(startNode, startOffset)
    range.setEnd(endNode, endOffset)
    return range
}

// ── 决策表 ──

describe('resolveQuoteSelection', () => {
    it('接受路径：agent 消息单 block 内选区 → 输出引用提案（messageId/role 取自容器、excerpt 为选中文本原文）', () => {
        const parent = mount()
        const msg = appendMessage(parent, { id: 'm1', role: 'agent' })
        const { textNode } = appendBlock(msg, '前半段，后半段')

        const result = resolveQuoteSelection(makeRange(textNode, 0, textNode, 3), { currentQuoteCount: 0 })

        expect(result).toEqual({ ok: true, quote: { messageId: 'm1', role: 'agent', excerpt: '前半段' } })
    })

    it('接受路径：user 消息正文选区 → role=user', () => {
        const parent = mount()
        const msg = appendMessage(parent, { id: 'm2', role: 'user' })
        const { textNode } = appendBlock(msg, '帮我看看这段代码')

        const result = resolveQuoteSelection(makeRange(textNode, 0, textNode, 4), { currentQuoteCount: 0 })

        expect(result).toEqual({ ok: true, quote: { messageId: 'm2', role: 'user', excerpt: '帮我看看' } })
    })

    it('接受路径：block 内跨子元素选区（嵌套标签间）仍属单 block', () => {
        const parent = mount()
        const msg = appendMessage(parent, { id: 'm1', role: 'agent' })
        const block = document.createElement('div')
        block.setAttribute('data-quote-block', '')
        const first = document.createTextNode('加粗')
        const strong = document.createElement('strong')
        const second = document.createTextNode('内容')
        strong.appendChild(second)
        block.append(first, strong)
        msg.appendChild(block)

        // 选区从普通文本跨入 <strong> 内部——两端最近的 block 容器是同一个
        const result = resolveQuoteSelection(makeRange(first, 0, second, 2), { currentQuoteCount: 0 })

        expect(result).toEqual({ ok: true, quote: { messageId: 'm1', role: 'agent', excerpt: '加粗内容' } })
    })

    it(`接受路径（边界）：恰好 ${QUOTE_EXCERPT_MAX} 字 → 接受`, () => {
        const parent = mount()
        const msg = appendMessage(parent, { id: 'm1', role: 'agent' })
        const fullText = 'x'.repeat(QUOTE_EXCERPT_MAX)
        const { textNode } = appendBlock(msg, fullText)

        const result = resolveQuoteSelection(makeRange(textNode, 0, textNode, QUOTE_EXCERPT_MAX), { currentQuoteCount: 0 })

        expect(result).toEqual({ ok: true, quote: { messageId: 'm1', role: 'agent', excerpt: fullText } })
    })

    it(`接受路径（边界）：已挂 ${QUOTE_MAX_COUNT - 1} 条引用时的第 ${QUOTE_MAX_COUNT} 条 → 接受`, () => {
        const parent = mount()
        const msg = appendMessage(parent, { id: 'm1', role: 'agent' })
        const { textNode } = appendBlock(msg, '第三条引用')

        const result = resolveQuoteSelection(makeRange(textNode, 0, textNode, 5), { currentQuoteCount: QUOTE_MAX_COUNT - 1 })

        expect(result).toEqual({ ok: true, quote: { messageId: 'm1', role: 'agent', excerpt: '第三条引用' } })
    })

    it('拒绝 crossBlock：同一消息内跨两个 text block 的选区（text→tool→text 场景的两端正文）', () => {
        const parent = mount()
        const msg = appendMessage(parent, { id: 'm1', role: 'agent' })
        const first = appendBlock(msg, '工具前的正文')
        appendForbidden(msg, '（工具卡输出，非正文）')
        const second = appendBlock(msg, '工具后的正文')

        const result = resolveQuoteSelection(
            makeRange(first.textNode, 0, second.textNode, 3),
            { currentQuoteCount: 0 },
        )

        expect(result).toEqual({ ok: false, reason: 'crossBlock' })
    })

    it('拒绝 crossMessage：选区锚点横跨两条消息', () => {
        const parent = mount()
        const msgA = appendMessage(parent, { id: 'm1', role: 'user' })
        const a = appendBlock(msgA, '第一条消息')
        const msgB = appendMessage(parent, { id: 'm2', role: 'agent' })
        const b = appendBlock(msgB, '第二条消息')

        const result = resolveQuoteSelection(makeRange(a.textNode, 0, b.textNode, 3), { currentQuoteCount: 0 })

        expect(result).toEqual({ ok: false, reason: 'crossMessage' })
    })

    it('消息边界与 block 边界重叠时按 crossMessage（消息归属判定优先于 block 判定）', () => {
        const parent = mount()
        const msgA = appendMessage(parent, { id: 'm1', role: 'agent' })
        const a = appendBlock(msgA, '消息 A 的 block 一')
        const msgB = appendMessage(parent, { id: 'm2', role: 'agent' })
        const b = appendBlock(msgB, '消息 B 的 block 二')

        // 两端既不同 block 也不同消息——期望先报告跨消息
        const result = resolveQuoteSelection(makeRange(a.textNode, 0, b.textNode, 3), { currentQuoteCount: 0 })

        expect(result).toEqual({ ok: false, reason: 'crossMessage' })
    })

    it('拒绝 disallowedSource：流式生成中的消息（data-quote-allowed="false"）', () => {
        const parent = mount()
        const msg = appendMessage(parent, { id: 'm1', role: 'agent', streaming: true })
        const { textNode } = appendBlock(msg, '正在生成的内容')

        const result = resolveQuoteSelection(makeRange(textNode, 0, textNode, 4), { currentQuoteCount: 0 })

        expect(result).toEqual({ ok: false, reason: 'disallowedSource' })
    })

    it('拒绝 disallowedSource：工具卡禁区内的选区', () => {
        const parent = mount()
        const msg = appendMessage(parent, { id: 'm1', role: 'agent' })
        const forbiddenText = appendForbidden(msg, 'tool_use 的输入参数文本')

        const result = resolveQuoteSelection(makeRange(forbiddenText, 0, forbiddenText, 5), { currentQuoteCount: 0 })

        expect(result).toEqual({ ok: false, reason: 'disallowedSource' })
    })

    it('拒绝 disallowedSource：thinking 折叠块禁区内的选区', () => {
        const parent = mount()
        const msg = appendMessage(parent, { id: 'm1', role: 'agent' })
        const thinkingText = appendForbidden(msg, '思考过程草稿')

        const result = resolveQuoteSelection(makeRange(thinkingText, 0, thinkingText, 4), { currentQuoteCount: 0 })

        expect(result).toEqual({ ok: false, reason: 'disallowedSource' })
    })

    it('拒绝 disallowedSource：引用组自身内的选区（user-select:none 之外的防御层）', () => {
        const parent = mount()
        const msg = appendMessage(parent, { id: 'm1', role: 'user' })
        appendBlock(msg, '普通正文')
        const quoteGroupText = appendForbidden(msg, '被引用的旧文本')

        const result = resolveQuoteSelection(makeRange(quoteGroupText, 0, quoteGroupText, 3), { currentQuoteCount: 0 })

        expect(result).toEqual({ ok: false, reason: 'disallowedSource' })
    })

    it('拒绝 disallowedSource：消息正文容器之内、text block 容器之外（如页脚时间戳等 chrome 文本）', () => {
        const parent = mount()
        const msg = appendMessage(parent, { id: 'm1', role: 'agent' })
        appendBlock(msg, '正文')
        const chrome = document.createTextNode('10:24')
        msg.appendChild(chrome)

        const result = resolveQuoteSelection(makeRange(chrome, 0, chrome, 5), { currentQuoteCount: 0 })

        expect(result).toEqual({ ok: false, reason: 'disallowedSource' })
    })

    it('拒绝 disallowedSource：选区完全落在任何消息容器之外（如 composer 区域）', () => {
        const parent = mount()
        const outside = document.createTextNode('composer 里的提示文本')
        parent.appendChild(outside)

        const result = resolveQuoteSelection(makeRange(outside, 0, outside, 7), { currentQuoteCount: 0 })

        expect(result).toEqual({ ok: false, reason: 'disallowedSource' })
    })

    it('拒绝 disallowedSource：选区一端在消息内、另一端漏出到消息外', () => {
        const parent = mount()
        const msg = appendMessage(parent, { id: 'm1', role: 'agent' })
        const { textNode } = appendBlock(msg, '正文文本')
        const outside = document.createTextNode('页面其他文本')
        parent.appendChild(outside)

        const result = resolveQuoteSelection(makeRange(textNode, 0, outside, 4), { currentQuoteCount: 0 })

        expect(result).toEqual({ ok: false, reason: 'disallowedSource' })
    })

    it('拒绝 disallowedSource：空选区（collapsed range 无可引用内容）', () => {
        const parent = mount()
        const msg = appendMessage(parent, { id: 'm1', role: 'agent' })
        const { textNode } = appendBlock(msg, '正文文本')

        const result = resolveQuoteSelection(makeRange(textNode, 2, textNode, 2), { currentQuoteCount: 0 })

        expect(result).toEqual({ ok: false, reason: 'disallowedSource' })
    })

    it(`拒绝 tooLong：选区 ${QUOTE_EXCERPT_MAX + 1} 字超过上限`, () => {
        const parent = mount()
        const msg = appendMessage(parent, { id: 'm1', role: 'agent' })
        const longText = 'y'.repeat(QUOTE_EXCERPT_MAX + 1)
        const { textNode } = appendBlock(msg, longText)

        const result = resolveQuoteSelection(makeRange(textNode, 0, textNode, QUOTE_EXCERPT_MAX + 1), { currentQuoteCount: 0 })

        expect(result).toEqual({ ok: false, reason: 'tooLong' })
    })

    it(`拒绝 limitReached：已挂 ${QUOTE_MAX_COUNT} 条引用（恰好达上限）`, () => {
        const parent = mount()
        const msg = appendMessage(parent, { id: 'm1', role: 'agent' })
        const { textNode } = appendBlock(msg, '还想再引一条')

        const result = resolveQuoteSelection(makeRange(textNode, 0, textNode, 5), { currentQuoteCount: QUOTE_MAX_COUNT })

        expect(result).toEqual({ ok: false, reason: 'limitReached' })
    })

    it('达上限与超长并存时按 limitReached（条数上限是结构性不可满足，优先于长度修正）', () => {
        const parent = mount()
        const msg = appendMessage(parent, { id: 'm1', role: 'agent' })
        const longText = 'z'.repeat(QUOTE_EXCERPT_MAX + 1)
        const { textNode } = appendBlock(msg, longText)

        const result = resolveQuoteSelection(makeRange(textNode, 0, textNode, QUOTE_EXCERPT_MAX + 1), { currentQuoteCount: QUOTE_MAX_COUNT })

        expect(result).toEqual({ ok: false, reason: 'limitReached' })
    })
})
