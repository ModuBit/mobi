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
 * quote 协议单源模块（spec .scratch/quote-protocol-unification 决策 1/2/3）
 *
 * 引用协议「进出同形」：模型看到引用是 `<quote index role>…</quote>` XML（进向，
 * promptBuilder 组装 / 票 02），输出引用就用同族自闭合 `<quote index="N"/>`（出向，
 * 本模块解析）。三套表示（wire quote block / 进向 XML / 出向引用）的语法常量与
 * 语义在此单源，消费方只派生不私改：
 *
 * - 出向解析：`parseQuoteXmlHits`——新 XML 形态（自闭合优先，容忍模型回显带内容的
 *   完整形态，只取 index）。旧 directive `:mobi-quote{index="N"}`（QUOTE_DIRECTIVE）
 *   保留只读兼容，由 web 既有 markdown 指令注册表继续解析（历史会话渲染，零迁移），
 *   其 index 语义必须经 {@link parseQuoteIndexAttr} 派生——合法性单源在此。
 * - 降级链三层不变：非法（伪造/缺字段/"0"）→ 不产出命中，消费方按原文诚实展示；
 *   越界 → 渲染层纯展示兜底；重复 → {@link dedupeQuoteXmlText} 按 index 去重。
 * - 配对：`pairQuotesToReplies`——批注↔回复的 turn 配对（uuid 优先在票 03 接入，
 *   本期线性推导，语义与 web 既有实现逐条对齐）。
 *
 * 全部纯函数、单 pass 正则、零 IO，浏览器与节点两侧同源可用。
 */

import type { UserContentBlock, UserQuoteBlock } from './userContentSchema'
import {
    MOBI_XML_NS,
    MOBI_XML_OPEN,
    parseTagAttrs,
    buildXmlTokenShape,
    dedupeXmlTagText,
    hasXmlTagOpen,
    scanXmlTagHits,
    truncateIncompleteXmlTagTail,
} from './mobiXml'

// 族通用原语已上移 mobiXml（票 02）：此处 re-export 维持 quote 语义层既有引用面
export { MOBI_XML_NS, MOBI_XML_OPEN, parseTagAttrs }

/** quote 基础标签名（无命名空间——仅作旧形态读兼容的基名，写路径一律用 {@link QUOTE_TAG_NS}） */
export const QUOTE_XML_TAG = 'quote'

/** quote 现行标签名（带命名空间，写路径唯一形态） */
export const QUOTE_TAG_NS = `${MOBI_XML_NS}${QUOTE_XML_TAG}`

/**
 * quote 标签形态清单（读兼容矩阵）：现行在前，旧无命名空间形态（2026-10-26~27
 * 一天龄的 `<quote/>`）只读——历史会话渲染零迁移。跨形态同 index 是同一引用
 * （去重统一处理）。
 */
export const QUOTE_TAG_NAMES: readonly string[] = [QUOTE_TAG_NS, QUOTE_XML_TAG]

/** 各形态标签开前缀（tokenizer 起点扫描用，禁手抄字面量） */
export const QUOTE_TAG_OPENS: readonly string[] = QUOTE_TAG_NAMES.map(t => `<${t}`)

/** 文本含任一 quote 标签形态的快速守卫（去重/保护区/截断共用热路径闸） */
export function hasQuoteXmlTag(text: string): boolean {
    return hasXmlTagOpen(text, QUOTE_TAG_OPENS)
}

/** 全形态合并的 tokenizer 正形（外层整组包裹的锚定语义单源在族模块 buildXmlTokenShape） */
export const QUOTE_XML_TOKEN_SHAPE = buildXmlTokenShape(QUOTE_TAG_NAMES)

/**
 * index 属性语义单源：一基正整数十进制串，规范为数字（"01" 即 1——同一编号的
 * 两个写法是同一引用，去重与展示都按规范数字）。缺字段 / 空串 / "0" / 非数字 /
 * 负数 / 小数返回 null（协议非法，消费方按原文诚实降级）。
 * 旧 directive 与新 XML 两条语法的合法性判定都从这里走，禁止消费方私写正则。
 */
export function parseQuoteIndexAttr(value: string | undefined): number | null {
    if (value === undefined || !/^\d+$/.test(value)) return null
    const index = Number(value)
    return index > 0 ? index : null
}

/** 出向引用命中：模型回复文本里的一处合法引用标记 */
export interface QuoteOutboundHit {
    /** 规范化的一基引用编号 */
    index: number
    /** 命中原文（自闭合标签或完整标签对），消费方整体摘除/替换 */
    raw: string
    start: number
    end: number
}

/** attrs 串 → 键值表：族通用实现单源在 mobiXml.parseTagAttrs（本模块 re-export） */

/**
 * 出向解析：模型回复文本 → 引用命中序列（按出现顺序，跨形态合并）。
 *
 * 只认正形（自闭合 / 完整回显带闭合标签收口）：流式半截（无 `>` 或未收口）
 * 不产出命中——半截由流式截断扣住（`truncateIncompleteQuoteXmlTail`），闭合帧
 * 一次性完整进入渲染。index 非法（伪造/缺字段/"0"）不产出命中，原文诚实降级。
 * 读兼容：一天龄旧形态 `<quote/>` 与现行 `<mobi:quote/>` 同等解析，同 index 同引用。
 * 扫描实现走族通用 {@link scanXmlTagHits}（quote 语义 = 标签族 + index 合法性过滤）。
 */
export function parseQuoteXmlHits(text: string): QuoteOutboundHit[] {
    if (!hasQuoteXmlTag(text)) return []
    const hits: QuoteOutboundHit[] = []
    for (const hit of scanXmlTagHits(text, QUOTE_TAG_NAMES)) {
        const index = parseQuoteIndexAttr(hit.attrs.index)
        if (index === null) continue
        hits.push({ index, raw: hit.raw, start: hit.start, end: hit.end })
    }
    return hits
}

/** quote 去重键 = 规范化一基 index；非法（伪造/缺字段/"0"）→ null 不参与去重。
 *  族级去重（web directives 混排 quote+artifact 单趟）与本模块 {@link dedupeQuoteXmlText}
 *  共用本判定，禁止消费方私写。 */
export function quoteDedupeKey(attrs: Record<string, string>): string | null {
    const index = parseQuoteIndexAttr(attrs.index)
    return index === null ? null : String(index)
}

/**
 * 出向去重：同 index 只保留首次出现，其余从文本整体摘除。输入变化时输出保持
 * 前缀稳定（后来的重复只会让尾部更短）——与流式渲染的 append-only 假设兼容。
 * 非法命中不参与去重（原样保留）；旧 directive 的去重走 web 既有注册表管线
 * （含前缀变体容错），两语法族各自去重、互不跨族合并。实现委托族通用
 * {@link dedupeXmlTagText}（quote 语义 = 标签族 + 本模块去重键）。
 *
 * protectedRanges（code-review #3）：调用方标出的「协议无权改写」区间（如 markdown
 * 代码围栏/行内代码——代码示例里的 `<quote/>` 是内容不是协议）。完全落在保护区内的
 * 命中透明处理：不摘除、不占去重键（其后的区外同名命中仍按首个处理）；跨界命中不保护
 * （调用方按完整区间计算，标签要么在内要么在外，跨界只出现在调用方算错的帧）。
 */
export function dedupeQuoteXmlText(
    text: string,
    protectedRanges?: readonly Readonly<{ start: number; end: number }>[],
): string {
    return dedupeXmlTagText(text, QUOTE_TAG_NAMES, hit => quoteDedupeKey(hit.attrs), protectedRanges)
}

/**
 * 流式原子揭示：drip 半截的开标签尾巴扣住不进渲染（x-markdown 的流式 recognizer
 * 不覆盖自定义扩展，半截 Text commit 后闭合不重识别）。仅扣串尾，闭合帧一次性
 * 完整进入渲染；模型真输出无闭合字面量时流结束诚实呈现（静态路径不截断）。
 * 实现委托族通用 {@link truncateIncompleteXmlTagTail}（quote 语义 = 标签前缀族）。
 */
export function truncateIncompleteQuoteXmlTail(text: string): string {
    return truncateIncompleteXmlTagTail(text, QUOTE_TAG_OPENS)
}

/**
 * 配对输入项的协议中性形态：调用方把消息序列投影为 user / agent 两类条目，
 * user 项携带 content blocks（quote block 由此筛出），agent 项只需身份。
 * 中间性质的条目（工具轮、事件等）直接不投影——配对语义里它们不参与、
 * 不打断（user 引用跨工具轮仍归属其后的回复）。
 */
export interface QuotePairingEntry {
    side: 'user' | 'agent'
    id: string
    /** side='user' 的消息 content；agent 项可省略 */
    blocks?: readonly UserContentBlock[]
    /** side='user' 的官方发送 uuid（SDKUserMessage.uuid = 发送链路 push 时生成、
     *  落库 metadata.nativeId）。缺省 = 未绑定（历史会话/异常路径），该条目只参与
     *  线性推导、不进 uuid 索引 */
    nativeId?: string
    /** side='agent' 的官方回戳（SDK assistant 帧 user_message_uuid：本 turn 回答的
     *  那条 user 消息的客户端 uuid）。缺省 = 本帧未回戳（同轮后续帧/旧生产者）——
     *  继承本轮已见回戳（user 边界重置），全无回戳走线性兜底 */
    userMessageUuid?: string
}

/**
 * 批注↔回复的 turn 配对（spec 决策 5，票 03 升级 uuid 官方绑定）：每条 agent 回复
 * 配「触发它的那条 user 消息」的引用，与 CLI 协议注入同语义。
 *
 * 配对两级：
 * 1. **uuid 命中优先**——agent 条目带官方回戳（user_message_uuid）且能在 uuid 索引
 *    （user 条目 nativeId → 引用）命中时，直接绑定回戳指向的那条 user。steer 场景
 *    （u1/u2/r1/r2 交错）下各归其主，不依赖顺序假设。
 * 2. **线性推导兜底**——回戳缺失（同轮后续帧：仅 turn 首帧回戳，继承本轮回戳，
 *    user 边界重置）或回戳未命中索引（历史消息未绑定 uuid）时，归属最近一条 user。
 *    全员无 uuid 时语义与票 01 线性推导逐条一致（e32acfef 回归锁定）。
 *
 * 历史教训（2026-10-20 生产实锤 e32acfef）：旧实现用 FIFO 队列、每条 agent 消费
 * 一个 user——一轮多条 agent 会吞掉后续 user，没有产出正文的 user（工具轮/中断轮）
 * 在队列里残留，队列长度越跑越偏。线性推导不消费、不残留。
 */
/** 会话无引用时的共享空结果（零分配早退——web 渲染热路径每帧调用，ReadonlyMap 契约下共享安全） */
export const EMPTY_QUOTES_MAP: ReadonlyMap<string, UserQuoteBlock[]> = new Map()

export function pairQuotesToReplies(entries: readonly QuotePairingEntry[]): ReadonlyMap<string, UserQuoteBlock[]> {
    const hasAnyQuote = entries.some(e => e.side === 'user' && e.blocks?.some(b => b.type === 'quote'))
    if (!hasAnyQuote) return EMPTY_QUOTES_MAP
    const byId = new Map<string, UserQuoteBlock[]>()
    /** uuid 索引：user 条目 nativeId → 该消息的引用（无引用消息也入索引，uuid 命中 = 空配对） */
    const byNativeId = new Map<string, UserQuoteBlock[]>()
    let currentQuotes: UserQuoteBlock[] = []
    /** 本轮已见的最新回戳（同轮后续 agent 帧继承；user 边界重置——跨轮继承即错配） */
    let lastStamp: string | undefined

    for (const entry of entries) {
        if (entry.side === 'user') {
            currentQuotes = (entry.blocks ?? []).filter((b): b is UserQuoteBlock => b.type === 'quote')
            if (entry.nativeId !== undefined) byNativeId.set(entry.nativeId, currentQuotes)
            lastStamp = undefined
            continue
        }
        if (entry.userMessageUuid !== undefined) lastStamp = entry.userMessageUuid
        // uuid 命中优先（含命中「无引用消息」→ 空数组）；miss 回落线性
        const quotes = (lastStamp !== undefined && byNativeId.get(lastStamp)) || currentQuotes
        if (quotes.length > 0) byId.set(entry.id, quotes)
    }
    return byId
}

/**
 * XML 文本转义（& " < >）——协议内嵌自由文本防标签逃逸的唯一实现（原 node-core
 * xmlEscape 上移：进向组装在 shared，转义原语必须随协议同层）。
 *
 * `&` 必须最先替换：放后面会把刚生成的实体（如 `&quot;`）里的 `&` 再转义一遍，
 * 变成 `&amp;quot;`。转义字符集是最怕漂移的安全原语，新增调用方直接复用，不要再抄一份。
 *
 * 注：claudeRemote 的 bash 输出转义（仅 & < >，控制 token 膨胀）与 serviceManager 的
 * plist 转义（含 '，属 XML 属性位）字符集是按场景有意收窄/扩展的，不在此收口范围。
 */
export function escapeXmlText(s: string): string {
    return s
        .replace(/&/g, '&amp;')
        .replace(/"/g, '&quot;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
}

/**
 * 进向组装（spec 决策 3，票 02）：wire quote block → 模型可见 XML 片段——
 * `<quote index="1" role="agent">被选文本<user-comment>评论</user-comment></quote>`，
 * 无评论省略子标签。与出向 `<quote index="N"/>` 同族语法（进出同形，模型无需建立
 * 两套语法的映射）。excerpt 与 comment 是用户可控的自由文本，经 XML 实体转义防止
 * `</quote>` 逃逸破坏结构（引用代码片段等含尖括号内容同样安全）。index 从 1 起、
 * 按 quote block 出现顺序编号（一基，与出向命中 index 同源），与 composer 引用编号一致。
 */
export function buildQuoteXml(block: UserQuoteBlock, index: number): string {
    // excerpt 沿用既有的换行压缩（选区可能含软换行），comment 保留原样（多行评论是合法输入）
    const excerpt = escapeXmlText(block.excerpt.replace(/\s*\n\s*/g, ' '))
    const inner = block.comment !== undefined
        ? `${excerpt}<user-comment>${escapeXmlText(block.comment)}</user-comment>`
        : excerpt
    return `<mobi:quote index="${index}" role="${block.role}">${inner}</mobi:quote>`
}

/**
 * 回应批注协议指令（spec 决策 4，票 02）：当本次消息含 agent 角色引用时，在首个
 * `<quote>` 前注入一段 `<system-reminder>` 指令（Claude 系模型对该标记有专门的
 * 注意力权重）。
 *
 * 新协议最小形式：进出同形后模型看到的引用语法就是它该输出的语法，无需映射教学；
 * 只说明自闭合标记的用法与「仅 agent 角色输出」约束。旧协议为修补模型语法记岔
 * 累积的 wrong-forms 枚举（全角冒号、`:::`、反引号包裹等）随旧协议退役；新协议的
 * 错误形态在使用中观察，不做预置教学。
 */
export const QUOTE_ANNOTATION_PROTOCOL = [
    '<system-reminder>',
    'Some `<mobi:quote>` elements in this message (role="agent") are response annotations:',
    'excerpts the user selected from your earlier replies, optionally followed by a',
    '<user-comment> with the user\'s question or clarification. Address every annotation',
    'and every user comment.',
    '',
    'When you address an annotation, emit its self-closing form <mobi:quote index="N"/>',
    'inline at the single most relevant point in your reply, where N is that quote\'s',
    'one-based `index` in this message. Emit these tags only for quotes with',
    'role="agent"; never for role="user" quotes.',
    '</system-reminder>',
].join('\n')
