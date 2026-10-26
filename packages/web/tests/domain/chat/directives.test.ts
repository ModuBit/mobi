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

// 内联指令通用管线行为锁定：语法扫描 / attrs 解析 / 注册表去重
import { describe, expect, it } from 'vitest'
import { QUOTE_DIRECTIVE } from '@mobi/shared'
// quote 指令的注册在 quoteDirectives 模块加载期发生——去重用例依赖它已注册
import '@/domain/chat/quoteDirectives'
import {
    DIRECTIVE_PREFIX,
    dedupeDirectiveText,
    parseDirectiveAttrs,
    parseDirectiveHits,
    registerDirective,
    truncateIncompleteDirectiveTail,
    truncateIncompleteMarkerTails,
} from '@/domain/chat/directives'

describe('parseDirectiveAttrs', () => {
    it('键值对解析：单条 / 多条 / 含空格值', () => {
        expect(parseDirectiveAttrs('index="1"')).toEqual({ index: '1' })
        expect(parseDirectiveAttrs('a="1" b="two words"')).toEqual({ a: '1', b: 'two words' })
        expect(parseDirectiveAttrs('')).toEqual({})
    })

    it('中文弯引号容错：模型中文语境输出 path=“x” 仍解析（2026-09-29 实踩降级）', () => {
        expect(parseDirectiveAttrs('path=“.mobi/a.png”')).toEqual({ path: '.mobi/a.png' })
        expect(parseDirectiveAttrs('mode=“card” path=“a b.png”')).toEqual({ path: 'a b.png', mode: 'card' })
        // 弯直混排同样命中
        expect(parseDirectiveAttrs('path="a.png”')).toEqual({ path: 'a.png' })
        // 值内撇号不受弯单引号容错影响（只容弯双引号，避免截断 don't.mp3 类文件名）
        expect(parseDirectiveAttrs("path=\"don't.mp3\"")).toEqual({ path: "don't.mp3" })
    })
})

describe('parseDirectiveHits', () => {
    it('单条命中：name/attrs/原文位置', () => {
        const text = `前文 ${QUOTE_DIRECTIVE}{index="2"} 后文`
        const hits = parseDirectiveHits(text)
        expect(hits).toHaveLength(1)
        expect(hits[0]!.name).toBe('quote')
        expect(hits[0]!.attrs).toEqual({ index: '2' })
        expect(text.slice(hits[0]!.start, hits[0]!.end)).toBe(`${QUOTE_DIRECTIVE}{index="2"}`)
    })

    it('未注册指令同样命中（路由降级由消费方负责）；半截不命中', () => {
        const hits = parseDirectiveHits(`${DIRECTIVE_PREFIX}future{x="1"} 中 ${QUOTE_DIRECTIVE}{index="`)
        expect(hits).toHaveLength(1)
        expect(hits[0]!.name).toBe('future')
    })

    it('多条命中按出现顺序、位置互指原文', () => {
        const text = `a ${QUOTE_DIRECTIVE}{index="1"} b ${DIRECTIVE_PREFIX}t{k="v"} c`
        const hits = parseDirectiveHits(text)
        expect(hits.map(h => h.name)).toEqual(['quote', 't'])
        for (const h of hits) expect(text.slice(h.start, h.end)).toBe(h.raw)
    })

    it('前缀变体归一（2026-10-10 生产实锤 c568aa0b）：::: / 全角冒号 / 冒号带空格仍命中且 raw 覆盖变体', () => {
        for (const lead of ['::: ', '：：', ': ：', ': ', ':']) {
            const text = `${lead}mobi-quote{index="1"}`
            const hits = parseDirectiveHits(text)
            expect(hits, lead).toHaveLength(1)
            expect(hits[0]!.name, lead).toBe('quote')
            expect(hits[0]!.attrs, lead).toEqual({ index: '1' })
            expect(text.slice(hits[0]!.start, hits[0]!.end), lead).toBe(text) // raw 含变体前缀，消费方整体摘除
        }
    })

    it('正常散文中的冒号不误吞：缺指令形态（无 {}）不命中', () => {
        expect(parseDirectiveHits('见 ::: mobi-quote 文档章节')).toHaveLength(0)
        expect(parseDirectiveHits('参数是 ：mobi-quote 与 {index}')).toHaveLength(0)
    })
})

describe('registerDirective', () => {
    it('前缀不符立即抛错（namespace 防线）', () => {
        expect(() => registerDirective({ directive: ':other-x{', parse: () => null })).toThrow()
    })
})

describe('dedupeDirectiveText（quote 已注册：同 index 只留首个）', () => {
    const d = (n: number) => `${QUOTE_DIRECTIVE}{index="${n}"}`

    it('无 directive 原样返回', () => {
        const text = '普通正文 with :mobi-quote{foo}'
        expect(dedupeDirectiveText(text)).toBe(text)
    })

    it('同 index 重复只保留首个（渲染层去重，handoff 失败模式）', () => {
        const text = `A ${d(1)} B ${d(1)} C ${d(2)} D ${d(2)} E`
        expect(dedupeDirectiveText(text)).toBe(`A ${d(1)} B  C ${d(2)} D  E`)
    })

    it('不同 index 互不影响', () => {
        const text = `${d(1)}${d(2)}${d(1)}`
        expect(dedupeDirectiveText(text)).toBe(`${d(1)}${d(2)}`)
    })

    it('未注册指令与参数非法的命中不参与去重（原样保留）', () => {
        const text = `${DIRECTIVE_PREFIX}future{x="1"} ${DIRECTIVE_PREFIX}future{x="1"} ${QUOTE_DIRECTIVE}{index="0"} ${QUOTE_DIRECTIVE}{index="0"}`
        expect(dedupeDirectiveText(text)).toBe(text)
    })

    it('变体前缀同样进去重管线（快速路径放宽，2026-10-10）', () => {
        // 快速路径曾用 includes(':mobi-')——变体前缀不含该子串会整段跳过去重
        const text = '：：mobi-quote{index="1"} 开头 ::: mobi-quote{index="1"} 结尾'
        expect(dedupeDirectiveText(text)).toBe('：：mobi-quote{index="1"} 开头  结尾')
    })
})

describe('dedupeDirectiveText（quote 新 XML 形态同帧去重，协议统一票 01）', () => {
    const d = (n: number) => `${QUOTE_DIRECTIVE}{index="${n}"}`
    const x = (n: number) => `<quote index="${n}"/>`

    it('同 index 的 XML 重复只保留首个；不同 index 互不影响', () => {
        expect(dedupeDirectiveText(`A ${x(1)} B ${x(1)} C`)).toBe(`A ${x(1)} B  C`)
        expect(dedupeDirectiveText(`${x(1)}${x(2)}${x(1)}`)).toBe(`${x(1)}${x(2)}`)
    })

    it('旧 directive 与新 XML 两语法族各自去重、互不跨族合并', () => {
        const text = `${d(1)} ${x(1)}`
        expect(dedupeDirectiveText(text)).toBe(text)
    })

    it('非法 XML 命中不参与去重（原样保留）', () => {
        const text = `${x(0)} ${x(0)} <quote index="x"/> <quote index="x"/>`
        expect(dedupeDirectiveText(text)).toBe(text)
    })

    it('代码围栏/行内代码内的 XML 字面量受保护，不被协议去重改写（code-review #3）', () => {
        // 围栏里的示例是内容不是协议：首个正文的命中保留、围栏内的字面量原样保留
        const fenced = `正文 ${x(1)}\n\`\`\`xml\n示例 ${x(1)}\n\`\`\``
        expect(dedupeDirectiveText(fenced)).toBe(fenced)
        // 行内代码同理
        const inline = `A ${x(1)} B 写作 \`${x(1)}\` 时表示引用一`
        expect(dedupeDirectiveText(inline)).toBe(inline)
        // 未闭合围栏兜底：围栏开启后的全部内容受保护
        const openFence = `正文 ${x(1)}\n\`\`\`\n示例 ${x(1)}`
        expect(dedupeDirectiveText(openFence)).toBe(openFence)
    })

    it('完全不含任何指令形态的文本零开销原样返回', () => {
        const text = '普通正文，既无冒号指令也无标签'
        expect(dedupeDirectiveText(text)).toBe(text)
    })
})

describe('truncateIncompleteDirectiveTail（drip 原子揭示：未闭合尾巴扣住不进渲染）', () => {
    it('无未闭合尾巴原样返回', () => {
        const text = `前文 ${QUOTE_DIRECTIVE}{index="1"} 后文`
        expect(truncateIncompleteDirectiveTail(text)).toBe(text)
    })

    it('尾部未闭合 directive 扣住（drip 半截不进 x-markdown）', () => {
        expect(truncateIncompleteDirectiveTail('正文 :mobi-quote{index="')).toBe('正文 ')
        expect(truncateIncompleteDirectiveTail('正文 :mobi-quote')).toBe('正文 ')
        // 变体前缀的半截尾巴同样扣住（同源放宽）
        expect(truncateIncompleteDirectiveTail('正文 ::: mobi-quote{index="')).toBe('正文 ')
    })

    it('已闭合尾巴 + 更早的未闭合（第一个未闭合位置截断）', () => {
        // 前一条已闭合不受影响；截断发生在其后新出现的未闭合处
        const text = ':mobi-quote{index="1"} 后文 :mobi-quote{index="'
        expect(truncateIncompleteDirectiveTail(text)).toBe(':mobi-quote{index="1"} 后文 ')
    })

    it('闭合后不再截断（闭合帧一次性完整进入渲染）', () => {
        const text = ':mobi-quote{index="1"}'
        expect(truncateIncompleteDirectiveTail(text)).toBe(text)
    })

    it('非指令的冒号文本不受影响', () => {
        const text = '比例 3:1 与时间 12:30'
        expect(truncateIncompleteDirectiveTail(text)).toBe(text)
    })
})

describe('dedupeDirectiveText（artifact XML 形态，mobi-xml-namespace 票 02）', () => {
    const a = (p: string, mode?: string) => `<mobi:artifact path="${p}"${mode ? ` mode="${mode}"` : ''}/>`

    it('同 path 只留首个；不同 path 都保留', () => {
        expect(dedupeDirectiveText(`A ${a('/x.png')} B ${a('/x.png')} C`)).toBe(`A ${a('/x.png')} B  C`)
        expect(dedupeDirectiveText(`${a('/x.png')}${a('/y.png')}`)).toBe(`${a('/x.png')}${a('/y.png')}`)
    })

    it('quote 与 artifact 键空间隔离：index 与 path 同值不互删', () => {
        const text = '<mobi:quote index="1"/><mobi:artifact path="1"/>'
        expect(dedupeDirectiveText(text)).toBe(text)
    })

    it('非法命中（缺 path）不参与去重，原样保留', () => {
        const text = `${a('/x.png')}<mobi:artifact mode="card"/>`
        expect(dedupeDirectiveText(text)).toBe(text)
    })
})

describe('truncateIncompleteMarkerTails（artifact XML 尾巴扣住，票 02）', () => {
    it('半截 artifact 开标签尾巴扣住；完整自闭合/回显不扣', () => {
        expect(truncateIncompleteMarkerTails('图 <mobi:artifact path="/ab')).toBe('图 ')
        expect(truncateIncompleteMarkerTails('图 <mobi:artifact path="/a.png">回显中')).toBe('图 ')
        const done = '图 <mobi:artifact path="/a.png"/> 与 <mobi:quote index="1"/>'
        expect(truncateIncompleteMarkerTails(done)).toBe(done)
    })
})
