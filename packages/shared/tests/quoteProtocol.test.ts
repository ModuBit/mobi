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
 * quote 协议单源模块行为锁定（spec .scratch/quote-protocol-unification 票 01）：
 * 断言「给定输入产出什么」，不断言内部正则实现。派生层（web 渲染管线 /
 * node-core promptBuilder）的形态断言在各包测试。
 */
import { describe, expect, it } from 'vitest'
import type { QuotePairingEntry, UserQuoteBlock } from '../src/userContentSchema'
import {
    MOBI_XML_OPEN,
    QUOTE_ANNOTATION_PROTOCOL,
    QUOTE_TAG_NAMES,
    QUOTE_TAG_NS,
    buildQuoteXml,
    dedupeQuoteXmlText,
    escapeXmlText,
    hasQuoteXmlTag,
    pairQuotesToReplies,
    parseQuoteIndexAttr,
    parseQuoteXmlHits,
    truncateIncompleteQuoteXmlTail,
} from '../src/quoteProtocol'

/** 现行写路径形态（spec .scratch/mobi-xml-namespace：`<mobi:quote/>` 带命名空间） */
const xml = (n: number) => `<mobi:quote index="${n}"/>`
/** 一天龄旧形态（读兼容：2026-10-26~27 的无命名空间 `<quote/>`） */
const xmlLegacy = (n: number) => `<quote index="${n}"/>`

describe('parseQuoteIndexAttr（index 语义单源）', () => {
    it('一基正整数串合法，规范为数字', () => {
        expect(parseQuoteIndexAttr('1')).toBe(1)
        expect(parseQuoteIndexAttr('23')).toBe(23)
    })

    it('非法形态返回 null：缺字段 / 空串 / "0" / 非数字 / 负数 / 小数', () => {
        expect(parseQuoteIndexAttr(undefined)).toBeNull()
        expect(parseQuoteIndexAttr('')).toBeNull()
        expect(parseQuoteIndexAttr('0')).toBeNull()
        expect(parseQuoteIndexAttr('abc')).toBeNull()
        expect(parseQuoteIndexAttr('-1')).toBeNull()
        expect(parseQuoteIndexAttr('1.5')).toBeNull()
    })

    it('前导零规范化（"01" 即 1）——同一编号的两个写法是同一引用', () => {
        expect(parseQuoteIndexAttr('01')).toBe(1)
    })
})

describe('parseQuoteXmlHits（出向新 XML 形态解析）', () => {
    it('自闭合基础形态：命中 index/原文/位置', () => {
        const text = `前文 ${xml(1)} 后文`
        const hits = parseQuoteXmlHits(text)
        expect(hits).toHaveLength(1)
        expect(hits[0]!.index).toBe(1)
        expect(hits[0]!.raw).toBe(xml(1))
        expect(text.slice(hits[0]!.start, hits[0]!.end)).toBe(xml(1))
    })

    it('容忍模型变体：/> 前空格、多余属性、属性乱序、弯引号', () => {
        for (const tag of [
            '<mobi:quote index="2" />',
            '<mobi:quote role="agent" index="2"/>',
            '<mobi:quote index="2" role="agent"/>',
            '<mobi:quote index=“2”/>',
        ]) {
            const hits = parseQuoteXmlHits(`a ${tag} b`)
            expect(hits, tag).toHaveLength(1)
            expect(hits[0]!.index, tag).toBe(2)
            expect(hits[0]!.raw, tag).toBe(tag)
        }
    })

    it('完整回显形态（带内容）只取 index，raw 覆盖整个标签对', () => {
        const tag = '<mobi:quote index="3">被回显的内容</mobi:quote>'
        const hits = parseQuoteXmlHits(`前 ${tag} 后`)
        expect(hits).toHaveLength(1)
        expect(hits[0]!.index).toBe(3)
        expect(hits[0]!.raw).toBe(tag)
    })

    it('回显内容含 > 与标签样文本不破坏解析', () => {
        const tag = '<mobi:quote index="1">if (a > b) { return <div/>; }</mobi:quote>'
        const hits = parseQuoteXmlHits(tag)
        expect(hits).toHaveLength(1)
        expect(hits[0]!.index).toBe(1)
        expect(hits[0]!.raw).toBe(tag)
    })

    it('回虫回归（2026-10-26 E2E 实锤）：自闭合在前、回显形态在后，命中互不污染', () => {
        // 贪婪 [^>]* 会把自闭合的 / 吃进 attrs、以开放标签形态懒吞到后面的 </quote>
        const text = '越界 <mobi:quote index="9"/> 应保留； 回显 <mobi:quote index="1">内容</mobi:quote> 结尾'
        const hits = parseQuoteXmlHits(text)
        expect(hits.map(h => h.index)).toEqual([9, 1])
        expect(hits[0]!.raw).toBe('<mobi:quote index="9"/>')
        expect(hits[1]!.raw).toBe('<mobi:quote index="1">内容</mobi:quote>')
    })

    it('回虫回归：重复自闭合 + 后随回显，去重只保留首个有效命中', () => {
        const text = 'A <mobi:quote index="1"/> B <mobi:quote index="1"/> C <mobi:quote index="1">内容</mobi:quote>'
        expect(dedupeQuoteXmlText(text)).toBe('A <mobi:quote index="1"/> B  C ')
    })

    it('读兼容：一天龄旧形态 <quote/> 照常解析命中', () => {
        const text = `前 ${xmlLegacy(1)} 中 <quote index="2">旧回显</quote> 后`
        const hits = parseQuoteXmlHits(text)
        expect(hits.map(h => h.index)).toEqual([1, 2])
        expect(hits[0]!.raw).toBe(xmlLegacy(1))
        expect(hits[1]!.raw).toBe('<quote index="2">旧回显</quote>')
    })

    it('跨形态同 index 是同一引用：去重统一摘除后出现者', () => {
        const text = `A ${xml(1)} B ${xmlLegacy(1)} C`
        expect(dedupeQuoteXmlText(text)).toBe(`A ${xml(1)} B  C`)
    })

    it('多条命中按出现顺序、位置互指原文', () => {
        const text = `a ${xml(2)} b ${xml(1)} c`
        const hits = parseQuoteXmlHits(text)
        expect(hits.map(h => h.index)).toEqual([2, 1])
        for (const h of hits) expect(text.slice(h.start, h.end)).toBe(h.raw)
    })

    it('降级矩阵：非法形态不产出命中（消费方按原文诚实降级）', () => {
        // 伪造（无 index）、缺字段、index="0"、非数字 index
        expect(parseQuoteXmlHits('<mobi:quote/>')).toHaveLength(0)
        expect(parseQuoteXmlHits('<mobi:quote>内容</mobi:quote>')).toHaveLength(0)
        expect(parseQuoteXmlHits(xml(0))).toHaveLength(0)
        expect(parseQuoteXmlHits('<mobi:quote index="abc"/>')).toHaveLength(0)
        // 讨论语法本身的散文与形近词不受影响
        expect(parseQuoteXmlHits('用 <mobi:quote> 标签讨论 <quoted 与 </mobi:quote>')).toHaveLength(0)
    })

    it('无任何形态的文本零命中（快速路径）', () => {
        expect(parseQuoteXmlHits('普通正文，完全没有标签')).toHaveLength(0)
        expect(parseQuoteXmlHits('<div>普通 XML 不受影响</div>')).toHaveLength(0)
    })
})

describe('dedupeQuoteXmlText（重复 index 去重：同 index 只留首个）', () => {
    it('同 index 重复只保留首个，其余整体摘除', () => {
        const text = `A ${xml(1)} B ${xml(1)} C ${xml(2)} D ${xml(2)} E`
        expect(dedupeQuoteXmlText(text)).toBe(`A ${xml(1)} B  C ${xml(2)} D  E`)
    })

    it('不同 index 互不影响；摘除后前缀稳定', () => {
        const text = `${xml(1)}${xml(2)}${xml(1)}`
        expect(dedupeQuoteXmlText(text)).toBe(`${xml(1)}${xml(2)}`)
    })

    it('非法命中不参与去重（原样保留）', () => {
        const text = `${xml(0)} ${xml(0)} <mobi:quote index="x"/> <mobi:quote index="x"/>`
        expect(dedupeQuoteXmlText(text)).toBe(text)
    })

    it('保护区内的命中不参与去重也不占号（code-review #3：代码块字面量原样保留）', () => {
        const text = `A ${xml(1)} B ${xml(1)}`
        // 第二个命中落在保护区（代码块区间）→ 原样保留；首个非保护区命中照常揭示
        const ranges = [{ start: text.indexOf('B'), end: text.length }]
        expect(dedupeQuoteXmlText(text, ranges)).toBe(`A ${xml(1)} B ${xml(1)}`)
    })

    it('保护区命中透明：不占去重键，其后的非保护区同名命中仍作为首个保留', () => {
        const text = `${xml(1)} ${xml(1)} ${xml(1)}`
        // 中间的命中在保护区内；首尾都在区外 → 首个保留、中间原样、尾部被摘
        const ranges = [{ start: xml(1).length + 1, end: xml(1).length * 2 + 2 }]
        expect(dedupeQuoteXmlText(text, ranges)).toBe(`${xml(1)} ${xml(1)} `)
    })

    it('无命中原样返回', () => {
        const text = '普通正文'
        expect(dedupeQuoteXmlText(text)).toBe(text)
    })
})

describe('truncateIncompleteQuoteXmlTail（流式原子揭示：未闭合尾巴扣住不进渲染）', () => {
    it('无未闭合尾巴原样返回（已闭合 / 非 quote 标签 / 普通文本）', () => {
        expect(truncateIncompleteQuoteXmlTail(`前文 ${xml(1)} 后文`)).toBe(`前文 ${xml(1)} 后文`)
        expect(truncateIncompleteQuoteXmlTail('a < b 与 <div> x')).toBe('a < b 与 <div> x')
    })

    it('尾部未闭合开标签扣住（drip 半截不进渲染）', () => {
        expect(truncateIncompleteQuoteXmlTail('正文 <mobi:quote index="')).toBe('正文 ')
        expect(truncateIncompleteQuoteXmlTail('正文 <mobi:quote index="1"')).toBe('正文 ')
        expect(truncateIncompleteQuoteXmlTail('正文 <mobi:quote')).toBe('正文 ')
    })

    it('只扣串尾：更早的已闭合标签与正文不受影响', () => {
        const text = `${xml(1)} 后文 <mobi:quote inde`
        expect(truncateIncompleteQuoteXmlTail(text)).toBe(`${xml(1)} 后文 `)
    })

    it('回显形态流式半截（开标签 > 已到、闭合未到）扣住——code-review #1 回归', () => {
        // 旧实现只扣「无 > 的开标签尾巴」，回显半截以 Text commit → 流式裸标签原文
        expect(truncateIncompleteQuoteXmlTail('正文 <mobi:quote index="1">被回显的内')).toBe('正文 ')
        expect(truncateIncompleteQuoteXmlTail('正文 <mobi:quote index="1">')).toBe('正文 ')
        // 回显已闭合则不扣
        expect(truncateIncompleteQuoteXmlTail('正文 <mobi:quote index="1">内容</mobi:quote>'))
            .toBe('正文 <mobi:quote index="1">内容</mobi:quote>')
    })

    it('读兼容：一天龄旧形态的半截尾巴同样扣住', () => {
        expect(truncateIncompleteQuoteXmlTail('正文 <quote index="1">半截')).toBe('正文 ')
        expect(truncateIncompleteQuoteXmlTail(`正文 ${xmlLegacy(1)}`)).toBe(`正文 ${xmlLegacy(1)}`)
    })

    it('完整自闭合在串尾不扣（已完整即揭示，闭合帧语义不倒退）', () => {
        expect(truncateIncompleteQuoteXmlTail(`前文 ${xml(1)}`)).toBe(`前文 ${xml(1)}`)
        expect(truncateIncompleteQuoteXmlTail(`前文 ${xml(1)} `)).toBe(`前文 ${xml(1)} `)
    })

    it('形近词边界：<quoted 与散文闭合对不误扣', () => {
        // <quoted 不是 quote 标签起点；散文里的完整闭合对已闭合，不扣
        expect(truncateIncompleteQuoteXmlTail('用 <mobi:quote> 标签讨论 <quoted 与 </mobi:quote> 语法')).toBe(
            '用 <mobi:quote> 标签讨论 <quoted 与 </mobi:quote> 语法',
        )
    })

    it('泛 XML 正文不扣：模型写普通 XML 内容不受影响', () => {
        expect(truncateIncompleteQuoteXmlTail('配置 <config name="x')).toBe('配置 <config name="x')
    })
})

describe('pairQuotesToReplies（批注↔回复线性配对，语义与 web 既有实现一致）', () => {
    const quote = (messageId: string): UserQuoteBlock =>
        ({ type: 'quote', messageId, role: 'agent', excerpt: `摘录-${messageId}` })
    const user = (id: string, ...quotes: UserQuoteBlock[]): QuotePairingEntry =>
        ({ side: 'user', id, blocks: quotes.length > 0 ? [...quotes, { type: 'text', text: '正文' }] : [{ type: 'text', text: '正文' }] })
    const agent = (id: string): QuotePairingEntry => ({ side: 'agent', id })

    it('常规一轮：同轮多条 agent 消息共享该轮引用；下一轮 user 换血', () => {
        const map = pairQuotesToReplies([user('u1', quote('m1')), agent('r1'), agent('r2'), user('u2', quote('m2')), agent('r3')])
        expect(map.get('r1')?.[0].messageId).toBe('m1')
        expect(map.get('r2')?.[0].messageId).toBe('m1')
        expect(map.get('r3')?.[0].messageId).toBe('m2')
    })

    it('steer 场景（u1/u2/r1/r2）：回复归属最近一条 user', () => {
        const map = pairQuotesToReplies([user('u1', quote('m1')), user('u2', quote('m2')), agent('r1'), agent('r2')])
        expect(map.get('r1')?.[0].messageId).toBe('m2')
        expect(map.get('r2')?.[0].messageId).toBe('m2')
    })

    it('未回复的 user 不累积错位（e32acfef 生产实锤的 FIFO 队列越跑越偏）', () => {
        const map = pairQuotesToReplies([
            user('u1', quote('m1')),
            user('u2', quote('m2')), agent('r2'),
            user('u3', quote('m3')), agent('r3'),
        ])
        expect(map.get('r2')?.[0].messageId).toBe('m2')
        expect(map.get('r3')?.[0].messageId).toBe('m3')
    })

    it('无引用 user 是边界：其后的回复不沿用上一轮引用', () => {
        const map = pairQuotesToReplies([user('u1', quote('m1')), agent('r1'), user('u2'), agent('r2')])
        expect(map.get('r1')?.[0].messageId).toBe('m1')
        expect(map.has('r2')).toBe(false)
    })

    it('会话无任何引用返回空 Map', () => {
        expect(pairQuotesToReplies([user('u1'), agent('r1')]).size).toBe(0)
        expect(pairQuotesToReplies([]).size).toBe(0)
    })

    it('常量契约：标签清单现行在前，族前缀带命名空间', () => {
        expect(QUOTE_TAG_NS).toBe('mobi:quote')
        expect(QUOTE_TAG_NAMES).toEqual(['mobi:quote', 'quote'])
        expect(MOBI_XML_OPEN).toBe('<mobi:')
        expect(hasQuoteXmlTag(`${xml(1)} 文本`)).toBe(true)
        expect(hasQuoteXmlTag(`${xmlLegacy(1)} 文本`)).toBe(true)
        expect(hasQuoteXmlTag('普通 <div> 文本')).toBe(false)
    })
})

describe('pairQuotesToReplies（批注↔回复 uuid 命中优先 + 线性兜底，票 03）', () => {
    const quote = (messageId: string): UserQuoteBlock =>
        ({ type: 'quote', messageId, role: 'agent', excerpt: `摘录-${messageId}` })
    const user = (id: string, opts?: { nativeId?: string; quotes?: UserQuoteBlock[] }): QuotePairingEntry =>
        ({ side: 'user', id, ...(opts?.nativeId ? { nativeId: opts.nativeId } : {}), blocks: [{ type: 'text', text: '正文' }, ...(opts?.quotes ?? [])] })
    const agent = (id: string, userMessageUuid?: string): QuotePairingEntry =>
        ({ side: 'agent', id, ...(userMessageUuid ? { userMessageUuid } : {}) })

    it('uuid 命中：回复配到回戳指向的那条 user（steer 乱序也能各归其主）', () => {
        // u1 先发、u2 steer 插入；r1 实际回答 u1（官方回戳 A）——线性推导会错配成 u2
        const map = pairQuotesToReplies([
            user('u1', { nativeId: 'A', quotes: [quote('m1')] }),
            user('u2', { nativeId: 'B', quotes: [quote('m2')] }),
            agent('r1', 'A'),
            agent('r2', 'B'),
        ])
        expect(map.get('r1')?.[0].messageId).toBe('m1')
        expect(map.get('r2')?.[0].messageId).toBe('m2')
    })

    it('回戳指向无引用的 user：uuid 命中 → 空配对（不沿用上一轮）', () => {
        const map = pairQuotesToReplies([
            user('u1', { nativeId: 'A', quotes: [quote('m1')] }),
            agent('r1', 'A'),
            user('u2', { nativeId: 'B' }),
            agent('r2', 'B'),
        ])
        expect(map.get('r1')?.[0].messageId).toBe('m1')
        expect(map.has('r2')).toBe(false)
    })

    it('回戳 miss（历史消息未绑定 uuid）：该回复线性兜底到最近一条 user', () => {
        const map = pairQuotesToReplies([
            user('u1', { nativeId: 'A', quotes: [quote('m1')] }),
            user('u2', { quotes: [quote('m2')] }),
            agent('r1', 'B'), // B 不在绑定索引里（u2 无 nativeId）
        ])
        expect(map.get('r1')?.[0].messageId).toBe('m2')
    })

    it('未回戳的 agent 帧（同轮后续帧）继承本轮回戳；user 边界重置继承', () => {
        // 同轮多条 assistant 帧：仅首帧带回戳，后续帧继承；跨 user 后继承失效走线性
        const map = pairQuotesToReplies([
            user('u1', { nativeId: 'A', quotes: [quote('m1')] }),
            agent('r1-thinking', 'A'),
            agent('r2-text'), // 同轮未回戳帧 → 继承 A
            user('u2', { nativeId: 'B', quotes: [quote('m2')] }),
            agent('r3'), // 继承已被 u2 重置 → 线性兜底 u2
        ])
        expect(map.get('r1-thinking')?.[0].messageId).toBe('m1')
        expect(map.get('r2-text')?.[0].messageId).toBe('m1')
        expect(map.get('r3')?.[0].messageId).toBe('m2')
    })

    it('全线性兜底回归：无任何 uuid 时语义与票 01 线性推导逐条一致', () => {
        const map = pairQuotesToReplies([
            user('u1', { quotes: [quote('m1')] }),
            user('u2', { quotes: [quote('m2')] }),
            agent('r1'),
            agent('r2'),
        ])
        expect(map.get('r1')?.[0].messageId).toBe('m2')
        expect(map.get('r2')?.[0].messageId).toBe('m2')
    })

    it('e32acfef 错位回归（uuid 路径）：未回复的 user 不累积错位', () => {
        const map = pairQuotesToReplies([
            user('u1', { nativeId: 'A', quotes: [quote('m1')] }),
            user('u2', { nativeId: 'B', quotes: [quote('m2')] }), agent('r2', 'B'),
            user('u3', { nativeId: 'C', quotes: [quote('m3')] }), agent('r3', 'C'),
        ])
        expect(map.get('r2')?.[0].messageId).toBe('m2')
        expect(map.get('r3')?.[0].messageId).toBe('m3')
    })
})

describe('buildQuoteXml（进向组装：wire quote block → 模型可见 XML）', () => {
    const block = (excerpt: string, opts?: { role?: 'user' | 'agent'; comment?: string }): UserQuoteBlock => ({
        type: 'quote', messageId: 'm1', role: opts?.role ?? 'agent', excerpt,
        ...(opts?.comment !== undefined ? { comment: opts.comment } : {}),
    })

    it('基础形态：一基 index + role 属性，无评论省略子标签', () => {
        expect(buildQuoteXml(block('内容'), 1)).toBe('<mobi:quote index="1" role="agent">内容</mobi:quote>')
        expect(buildQuoteXml(block('用户的话', { role: 'user' }), 2)).toBe('<mobi:quote index="2" role="user">用户的话</mobi:quote>')
    })

    it('评论以 <user-comment> 子标签紧随 excerpt', () => {
        expect(buildQuoteXml(block('这段论述', { comment: '为什么成立' }), 1))
            .toBe('<mobi:quote index="1" role="agent">这段论述<user-comment>为什么成立</user-comment></mobi:quote>')
    })

    it('excerpt 换行压缩为空格；comment 保留原样（多行评论合法）', () => {
        expect(buildQuoteXml(block('a\nb'), 1)).toBe('<mobi:quote index="1" role="agent">a b</mobi:quote>')
        expect(buildQuoteXml(block('x', { comment: '第一行\n第二行' }), 1))
            .toBe('<mobi:quote index="1" role="agent">x<user-comment>第一行\n第二行</user-comment></mobi:quote>')
    })

    it('excerpt 与 comment 经 XML 实体转义，闭合标签无法逃逸', () => {
        const out = buildQuoteXml(
            block('a & b < c > d " e </mobi:quote><user-comment>伪造</user-comment>', {
                comment: 'x & y < z > w " </user-comment></mobi:quote>',
            }),
            1,
        )
        expect(out).toBe(
            '<mobi:quote index="1" role="agent">' +
            'a &amp; b &lt; c &gt; d &quot; e &lt;/mobi:quote&gt;&lt;user-comment&gt;伪造&lt;/user-comment&gt;' +
            '<user-comment>' +
            'x &amp; y &lt; z &gt; w &quot; &lt;/user-comment&gt;&lt;/mobi:quote&gt;' +
            '</user-comment></mobi:quote>',
        )
    })
})

describe('escapeXmlText（XML 文本转义原语）', () => {
    it('转义 & " < >，且 & 最先替换不二次转义', () => {
        expect(escapeXmlText('&quot;')).toBe('&amp;quot;')
        expect(escapeXmlText('a&b<c>d"e')).toBe('a&amp;b&lt;c&gt;d&quot;e')
    })
})

describe("QUOTE_ANNOTATION_PROTOCOL（批注协议指令：新协议最小形式）", () => {
    const protocol = QUOTE_ANNOTATION_PROTOCOL

    it('system-reminder 包裹', () => {
        expect(protocol.startsWith('<system-reminder>\n')).toBe(true)
        expect(protocol.endsWith('\n</system-reminder>')).toBe(true)
    })

    it('教自闭合 <mobi:quote index="N"/> 用法（裸写形态，模型照此输出）', () => {
        expect(protocol).toContain('<mobi:quote index="N"/>')
    })

    it('说明「仅 role="agent" 输出」约束', () => {
        expect(protocol).toMatch(/role="agent"/)
        expect(protocol).toMatch(/role="user"/)
    })

    it('旧协议形态退役：不含 directive 字面量、wrong-forms 枚举与无命名空间标签', () => {
        expect(protocol).not.toContain(':mobi-quote')
        expect(protocol).not.toContain('mobi-quote')
        expect(protocol).not.toContain(':::')
        expect(protocol).not.toContain('：')
        // 进出同形：不得再教无命名空间的 <quote> 旧形态
        expect(protocol).not.toMatch(/[^:]<quote[ >]/)
    })
})
