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
    QUOTE_XML_TAG,
    dedupeQuoteXmlText,
    pairQuotesToReplies,
    parseQuoteIndexAttr,
    parseQuoteXmlHits,
    truncateIncompleteQuoteXmlTail,
} from '../src/quoteProtocol'

const xml = (n: number) => `<quote index="${n}"/>`

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
            '<quote index="2" />',
            '<quote role="agent" index="2"/>',
            '<quote index="2" role="agent"/>',
            '<quote index=“2”/>',
        ]) {
            const hits = parseQuoteXmlHits(`a ${tag} b`)
            expect(hits, tag).toHaveLength(1)
            expect(hits[0]!.index, tag).toBe(2)
            expect(hits[0]!.raw, tag).toBe(tag)
        }
    })

    it('完整回显形态（带内容）只取 index，raw 覆盖整个标签对', () => {
        const tag = '<quote index="3">被回显的内容</quote>'
        const hits = parseQuoteXmlHits(`前 ${tag} 后`)
        expect(hits).toHaveLength(1)
        expect(hits[0]!.index).toBe(3)
        expect(hits[0]!.raw).toBe(tag)
    })

    it('回显内容含 > 与标签样文本不破坏解析', () => {
        const tag = '<quote index="1">if (a > b) { return <div/>; }</quote>'
        const hits = parseQuoteXmlHits(tag)
        expect(hits).toHaveLength(1)
        expect(hits[0]!.index).toBe(1)
        expect(hits[0]!.raw).toBe(tag)
    })

    it('多条命中按出现顺序、位置互指原文', () => {
        const text = `a ${xml(2)} b ${xml(1)} c`
        const hits = parseQuoteXmlHits(text)
        expect(hits.map(h => h.index)).toEqual([2, 1])
        for (const h of hits) expect(text.slice(h.start, h.end)).toBe(h.raw)
    })

    it('降级矩阵：非法形态不产出命中（消费方按原文诚实降级）', () => {
        // 伪造（无 index）、缺字段、index="0"、非数字 index
        expect(parseQuoteXmlHits('<quote/>')).toHaveLength(0)
        expect(parseQuoteXmlHits('<quote>内容</quote>')).toHaveLength(0)
        expect(parseQuoteXmlHits(xml(0))).toHaveLength(0)
        expect(parseQuoteXmlHits('<quote index="abc"/>')).toHaveLength(0)
        // 讨论语法本身的散文与形近词不受影响
        expect(parseQuoteXmlHits('用 <quote> 标签讨论 <quoted 与 </quote>')).toHaveLength(0)
    })

    it('无任何形态的文本零命中（快速路径）', () => {
        expect(parseQuoteXmlHits('普通正文，完全没有标签')).toHaveLength(0)
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
        const text = `${xml(0)} ${xml(0)} <quote index="x"/> <quote index="x"/>`
        expect(dedupeQuoteXmlText(text)).toBe(text)
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
        expect(truncateIncompleteQuoteXmlTail('正文 <quote index="')).toBe('正文 ')
        expect(truncateIncompleteQuoteXmlTail('正文 <quote index="1"')).toBe('正文 ')
        expect(truncateIncompleteQuoteXmlTail('正文 <quote')).toBe('正文 ')
    })

    it('只扣串尾：更早的已闭合标签与正文不受影响', () => {
        const text = `${xml(1)} 后文 <quote inde`
        expect(truncateIncompleteQuoteXmlTail(text)).toBe(`${xml(1)} 后文 `)
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

    it('QUOTE_XML_TAG 常量与 XML 形态字面量一致', () => {
        expect(QUOTE_XML_TAG).toBe('quote')
    })
})
