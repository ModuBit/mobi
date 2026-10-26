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
/** 出向 XML 形态标签名（与进向 `<quote index role>` 同族语法） */
export const QUOTE_XML_TAG = 'quote'

/**
 * XML 形态完整正形（无 g 标志的源串）：自闭合 `<quote …/>` 或完整回显
 * `<quote …>…</quote>`。attrs 段不含 `>`；web markdown tokenizer 用 `^` 锚定派生
 * （同一正形，扫描与 tokenizer 判定不漂移）。
 */
export const QUOTE_XML_SHAPE = `<${QUOTE_XML_TAG}\\b([^>]*)(?:/>|>([\\s\\S]*?)</${QUOTE_XML_TAG}>)`

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

/** attrs 值允许的引号：直引号 + 中文弯引号（模型中文语境输出易带弯引号，容错而非降级；
 *  与 web 旧指令 attrs 解析同一哲学）。值不含引号字符，协议不定义转义。 */
const QUOTE_XML_ATTR_RE = /([a-zA-Z][\w-]*)\s*=\s*["“”]([^"“”]*)["“”]/g

const QUOTE_XML_RE = new RegExp(QUOTE_XML_SHAPE, 'g')

/** 开标签 attrs 串 → 键值表（同名后者覆盖；自闭合尾斜杠不是合法 attr，自然忽略） */
function parseQuoteXmlAttrs(raw: string): Record<string, string> {
    const attrs: Record<string, string> = {}
    for (const m of raw.matchAll(QUOTE_XML_ATTR_RE)) {
        attrs[m[1]!] = m[2]!
    }
    return attrs
}

/**
 * 出向解析：模型回复文本 → 引用命中序列（按出现顺序）。
 *
 * 只认正形（自闭合 / 完整回显带 `</quote>` 收口）：流式半截（无 `>` 或未收口）
 * 不产出命中——半截由流式截断扣住（`truncateIncompleteQuoteXmlTail`），闭合帧
 * 一次性完整进入渲染。index 非法（伪造/缺字段/"0"）不产出命中，原文诚实降级。
 */
export function parseQuoteXmlHits(text: string): QuoteOutboundHit[] {
    // 快速路径：绝大多数正文不含标签前缀，免整串正则（渲染热路径每帧调用）
    if (!text.includes(`<${QUOTE_XML_TAG}`)) return []
    const hits: QuoteOutboundHit[] = []
    QUOTE_XML_RE.lastIndex = 0
    for (let m = QUOTE_XML_RE.exec(text); m; m = QUOTE_XML_RE.exec(text)) {
        const index = parseQuoteIndexAttr(parseQuoteXmlAttrs(m[1] ?? '').index)
        if (index === null) continue
        hits.push({ index, raw: m[0], start: m.index, end: m.index + m[0].length })
    }
    return hits
}

/**
 * 出向去重：同 index 只保留首次出现，其余从文本整体摘除。输入变化时输出保持
 * 前缀稳定（后来的重复只会让尾部更短）——与流式渲染的 append-only 假设兼容。
 * 非法命中不参与去重（原样保留）；旧 directive 的去重走 web 既有注册表管线
 * （含前缀变体容错），两语法族各自去重、互不跨族合并。
 */
export function dedupeQuoteXmlText(text: string): string {
    if (!text.includes(`<${QUOTE_XML_TAG}`)) return text
    const seen = new Set<number>()
    let out = ''
    let cursor = 0
    let removedAny = false
    for (const hit of parseQuoteXmlHits(text)) {
        if (seen.has(hit.index)) {
            out += text.slice(cursor, hit.start)
            cursor = hit.end
            removedAny = true
            continue
        }
        seen.add(hit.index)
    }
    // 无剔除则原样返回（避免无谓的字符串重建，历史消息每帧渲染都走这里）
    if (!removedAny) return text
    return out + text.slice(cursor)
}

/** 未闭合尾巴：`<quote` 开标签已出现但 `>` 未到达——只在**串尾**命中，正文里
 *  带后随 `>` 的形近文本（讨论语法本身）不受影响。 */
const INCOMPLETE_QUOTE_XML_TAIL_RE = new RegExp(`<${QUOTE_XML_TAG}\\b[^>]*$`)

/**
 * 流式原子揭示：drip 半截的开标签尾巴扣住不进渲染（x-markdown 的流式 recognizer
 * 不覆盖自定义扩展，半截 Text commit 后闭合不重识别）。仅扣串尾，闭合帧一次性
 * 完整进入渲染；模型真输出无闭合字面量时流结束诚实呈现（静态路径不截断）。
 */
export function truncateIncompleteQuoteXmlTail(text: string): string {
    const m = text.match(INCOMPLETE_QUOTE_XML_TAIL_RE)
    return m ? text.slice(0, m.index) : text
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
}

/**
 * 批注↔回复的 turn 配对（spec .scratch/response-annotations 语义收编，票 01 线性
 * 推导、票 03 升级 uuid 优先）：每条 agent 回复配「触发它的那条 user 消息」的引用，
 * 与 CLI 协议注入同语义。
 *
 * 归属按条目顺序线性推导：user 之后、下一个 user 之前的所有 agent 都属于这一轮
 * （一轮常有 thinking/text 分段产生的多条 agent）。steer 场景（u1/u2/r1/r2）下
 * 回复归属最近一条 user——模型看到的最新协议注入就是它。
 *
 * 历史教训（2026-10-20 生产实锤 e32acfef）：旧实现用 FIFO 队列、每条 agent 消费
 * 一个 user——一轮多条 agent 会吞掉后续 user，没有产出正文的 user（工具轮/中断轮）
 * 在队列里残留，队列长度越跑越偏。线性推导不消费、不残留。
 */
export function pairQuotesToReplies(entries: readonly QuotePairingEntry[]): ReadonlyMap<string, UserQuoteBlock[]> {
    const hasAnyQuote = entries.some(e => e.side === 'user' && e.blocks?.some(b => b.type === 'quote'))
    if (!hasAnyQuote) return new Map()

    const byId = new Map<string, UserQuoteBlock[]>()
    let currentQuotes: UserQuoteBlock[] = []
    for (const entry of entries) {
        if (entry.side === 'user') {
            currentQuotes = (entry.blocks ?? []).filter((b): b is UserQuoteBlock => b.type === 'quote')
        } else if (currentQuotes.length > 0) {
            byId.set(entry.id, currentQuotes)
        }
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
    return `<quote index="${index}" role="${block.role}">${inner}</quote>`
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
export function buildQuoteAnnotationProtocol(): string {
    return [
        '<system-reminder>',
        'Some `<quote>` elements in this message (role="agent") are response annotations:',
        'excerpts the user selected from your earlier replies, optionally followed by a',
        '<user-comment> with the user\'s question or clarification. Address every annotation',
        'and every user comment.',
        '',
        'When you address an annotation, emit its self-closing form <quote index="N"/>',
        'inline at the single most relevant point in your reply, where N is that quote\'s',
        'one-based `index` in this message. Emit these tags only for quotes with',
        'role="agent"; never for role="user" quotes.',
        '</system-reminder>',
    ].join('\n')
}
