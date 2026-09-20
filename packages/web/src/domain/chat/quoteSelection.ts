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
 * 选区判定器（引用资格决策纯函数）
 *
 * 「能不能引用、为什么不能」的全部规则收口于此：输入选区 Range 与环境信息，
 * 输出引用提案或结构化拒绝原因。DOM 事件监听（PC mouseup / 移动端 selectionchange）
 * 与 popover 只是无逻辑薄壳（票 04），薄壳拿到选区后交由本函数裁决。
 *
 * ## DOM 锚点契约（票 04 接线时由消息渲染层落属性）
 *
 * 判定完全依赖 data-* 属性锚点，不 import 任何 React 组件：
 *
 * - `data-quote-message-id`：消息正文容器锚点，值 = 落库 messageId（引用提案的指针来源）
 * - `data-quote-role`：与 message-id 同元素，值 = "user" | "agent"
 * - `data-quote-allowed="false"`：消息正文容器上的禁用标记——流式生成中的消息
 *   （内容仍在变化）由此标记不可引用；缺省或其他值 = 允许
 * - `data-quote-block`：text block 渲染容器锚点（agent 的 TextBlock 根、user 的
 *   text 视图根）。选区两端必须落在同一 block 容器内，否则按跨 block 拒绝。
 *   消息容器内 block 容器之外的文本（时间戳、页脚等 chrome）不可引用
 * - `data-quote-forbidden`：禁区标记（工具卡内容、thinking 折叠块内容、引用组自身）。
 *   引用组另有 user-select:none 天然选不到，此属性是第二道防御
 *
 * ## 判定优先级（固定顺序，拒绝原因不叠加）
 *
 * 1. 来源资格（disallowedSource）：空选区 / 任一端点无消息锚点、命中禁区、
 *    消息流式中、不在任何 block 容器内、role 值非法
 * 2. 消息归属（crossMessage）：两端消息容器不同（先于 crossBlock——归属不清
 *    比 block 划分是更根本的问题）
 * 3. block 归属（crossBlock）：两端 block 容器不同
 * 4. 条数上限（limitReached）：达 QUOTE_MAX_COUNT（结构性不可满足，先于 tooLong——
 *    此时无论选多短都无法新增引用）
 * 5. 长度上限（tooLong）：选中文本超 QUOTE_EXCERPT_MAX
 *
 * 接受时 excerpt = range.toString()（window 原文，不做任何清洗——引用忠实于所选）。
 */

import { QUOTE_EXCERPT_MAX } from '@mobi/shared'
import { QUOTE_MAX_COUNT, type PendingQuoteRef } from './composerSegments'

/** 判定器输出的拒绝原因（各原因语义见文件头「判定优先级」） */
export type QuoteRejectionReason =
    | 'crossBlock'
    | 'crossMessage'
    | 'disallowedSource'
    | 'tooLong'
    | 'limitReached'

/** 判定结果：引用提案（ok）或携带原因的拒绝 */
export type QuoteSelectionResult =
    | { ok: true; quote: PendingQuoteRef }
    | { ok: false; reason: QuoteRejectionReason }

/** 判定环境：与 DOM 无关的调用方状态 */
export interface QuoteSelectionEnv {
    /** composer 当前已挂引用条数（达 QUOTE_MAX_COUNT 即拒绝） */
    currentQuoteCount: number
}

/** 锚点属性名（集中定义，渲染层接线与判定共用同一词汇） */
const MESSAGE_ID_ATTR = 'data-quote-message-id'
const ROLE_ATTR = 'data-quote-role'
const ALLOWED_ATTR = 'data-quote-allowed'
const BLOCK_ATTR = 'data-quote-block'
const FORBIDDEN_ATTR = 'data-quote-forbidden'

/** 单个选区端点的锚点解析结果 */
interface EndpointContext {
    /** 向上找到的最近消息正文容器（null = 端点不在任何消息正文内） */
    messageEl: HTMLElement | null
    /** 向上找到的最近 text block 容器（null = 不在任何 block 容器内） */
    blockEl: HTMLElement | null
    /** 端点到消息容器之间是否命中禁区标记 */
    forbidden: boolean
}

/** 端点通过来源资格检查后的形态（messageEl / blockEl 均已就位） */
interface QuotableEndpoint {
    messageEl: HTMLElement
    blockEl: HTMLElement
}

/**
 * 从端点节点向上爬 DOM，收集消息容器 / block 容器 / 禁区三个锚点信息。
 * 爬到消息容器即停（block 容器必然在消息容器之内）；到根都没遇到消息容器
 * 说明端点在消息正文之外（composer、页面 chrome 等）。
 */
function resolveEndpointContext(node: Node): EndpointContext {
    let el = node.nodeType === Node.TEXT_NODE ? node.parentElement : (node as HTMLElement | null)
    let blockEl: HTMLElement | null = null
    for (; el; el = el.parentElement) {
        if (el.hasAttribute(FORBIDDEN_ATTR)) {
            return { messageEl: null, blockEl: null, forbidden: true }
        }
        if (!blockEl && el.hasAttribute(BLOCK_ATTR)) blockEl = el
        if (el.hasAttribute(MESSAGE_ID_ATTR)) {
            return { messageEl: el, blockEl, forbidden: false }
        }
    }
    return { messageEl: null, blockEl, forbidden: false }
}

/** 来源资格检查：非禁区 + 消息锚点与 block 锚点齐备 + 消息非流式生成中 */
function isQuotable(ctx: EndpointContext): ctx is EndpointContext & QuotableEndpoint {
    if (ctx.forbidden) return false
    if (!ctx.messageEl || !ctx.blockEl) return false
    // 缺省 / 任意其他值 = 允许；仅显式 "false"（流式中）拒绝
    return ctx.messageEl.getAttribute(ALLOWED_ATTR) !== 'false'
}

/**
 * 选区判定器：对「能否引用、为何不能」的唯一裁决点（决策表见测试 quoteSelection.test.ts）。
 * 纯函数，DOM 类型（Range/Node）由 jsdom 或真实浏览器提供，不发起任何 IO。
 */
export function resolveQuoteSelection(range: Range, env: QuoteSelectionEnv): QuoteSelectionResult {
    const text = range.toString()
    // 空选区（collapsed）或未覆盖任何文本：无可引用内容，按来源不合格拒绝
    if (range.collapsed || text.length === 0) {
        return { ok: false, reason: 'disallowedSource' }
    }

    const start = resolveEndpointContext(range.startContainer)
    const end = resolveEndpointContext(range.endContainer)

    // ① 来源资格：任一端点不合格即整体不合格（流式中 / 禁区 / 无锚点 / 非 block 正文）
    if (!isQuotable(start) || !isQuotable(end)) {
        return { ok: false, reason: 'disallowedSource' }
    }

    const role = start.messageEl.getAttribute(ROLE_ATTR)
    if (role !== 'user' && role !== 'agent') {
        return { ok: false, reason: 'disallowedSource' }
    }

    // ② 消息归属：先于 block 判定
    if (start.messageEl !== end.messageEl) {
        return { ok: false, reason: 'crossMessage' }
    }

    // ③ block 归属
    if (start.blockEl !== end.blockEl) {
        return { ok: false, reason: 'crossBlock' }
    }

    // ④ 条数上限（结构性不可满足，先于长度）
    if (env.currentQuoteCount >= QUOTE_MAX_COUNT) {
        return { ok: false, reason: 'limitReached' }
    }

    // ⑤ 长度上限
    if (text.length > QUOTE_EXCERPT_MAX) {
        return { ok: false, reason: 'tooLong' }
    }

    const messageId = start.messageEl.getAttribute(MESSAGE_ID_ATTR) ?? ''
    return { ok: true, quote: { messageId, role, excerpt: text } }
}
