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
 * 指令族 XML 命名空间通用原语 + artifact 成员语义锁定（spec .scratch/mobi-xml-namespace
 * 票 02）：断言「给定输入产出什么」，不断言内部正则实现。quote 成员的语义绑定
 * （index 合法性等）由 quoteProtocol.test 锁定，此处只锁族通用行为与 artifact 矩阵。
 */
import { describe, expect, it } from 'vitest'
import {
    ARTIFACT_TAG_NAMES,
    ARTIFACT_TAG_NS,
    artifactDedupeKey,
    buildXmlTokenShape,
    dedupeXmlTagText,
    parseArtifactTagAttrs,
    scanXmlTagHits,
    truncateIncompleteXmlTagTail,
} from '../src/mobiXml'
import { mobiXmlDedupeKey, MOBI_XML_FAMILY_OPENS, MOBI_XML_FAMILY_TAG_NAMES } from '../src/mobiXmlFamily'

/** 现行 artifact 写路径形态：`<mobi:artifact path="..." [mode="..."]/>` */
const artifact = (path: string, mode?: string) =>
    `<mobi:artifact path="${path}"${mode ? ` mode="${mode}"` : ''}/>`

/** 族级清单 / 开前缀 / 去重键：mobiXmlFamily 注册表单源派生（此处直接引用锁定真实
 *  族形状，不再同构手抄一份） */
const FAMILY_TAG_NAMES = MOBI_XML_FAMILY_TAG_NAMES
const FAMILY_OPENS = MOBI_XML_FAMILY_OPENS
const familyKeyOf = mobiXmlDedupeKey

describe('parseArtifactTagAttrs（artifact 参数语义单源：DSL 与 XML 两语法共用）', () => {
    it('path + 合法 mode → {path, mode}', () => {
        expect(parseArtifactTagAttrs({ path: '/a/b.png', mode: 'card' })).toEqual({ path: '/a/b.png', mode: 'card' })
        expect(parseArtifactTagAttrs({ path: '/a/v.html', mode: 'viz-wide' })).toEqual({ path: '/a/v.html', mode: 'viz-wide' })
    })

    it('mode 缺省 / 非法 → undefined（容错为 auto，不因拼写降级整条声明）', () => {
        expect(parseArtifactTagAttrs({ path: '/a.png' })).toEqual({ path: '/a.png', mode: undefined })
        expect(parseArtifactTagAttrs({ path: '/a.png', mode: 'CARD' })).toEqual({ path: '/a.png', mode: undefined })
        expect(parseArtifactTagAttrs({ path: '/a.png', mode: 'fullscreen' })).toEqual({ path: '/a.png', mode: undefined })
    })

    it('path 缺失 / 空串 / 纯空白 → null（协议非法，消费方按原文诚实降级）', () => {
        expect(parseArtifactTagAttrs({ mode: 'card' })).toBeNull()
        expect(parseArtifactTagAttrs({ path: '', mode: 'card' })).toBeNull()
        expect(parseArtifactTagAttrs({ path: '   ' })).toBeNull()
    })

    it('artifactDedupeKey：合法 → path；非法 → null（不参与去重）', () => {
        expect(artifactDedupeKey({ path: '/a.png' })).toBe('/a.png')
        expect(artifactDedupeKey({ mode: 'card' })).toBeNull()
    })
})

describe('scanXmlTagHits（族通用标签扫描）', () => {
    it('自闭合 artifact 命中：tagName/attrs/raw/位置齐备', () => {
        const text = `前文 ${artifact('/a.png', 'card')} 后文`
        const hits = scanXmlTagHits(text, ARTIFACT_TAG_NAMES)
        expect(hits).toHaveLength(1)
        expect(hits[0]).toMatchObject({ tagName: 'mobi:artifact', attrs: { path: '/a.png', mode: 'card' } })
        expect(text.slice(hits[0]!.start, hits[0]!.end)).toBe(hits[0]!.raw)
    })

    it('完整回显形态容错命中（模型带内容回显，标签整体消费）', () => {
        const hits = scanXmlTagHits('<mobi:artifact path="/a.png">ignored</mobi:artifact>', ARTIFACT_TAG_NAMES)
        expect(hits).toHaveLength(1)
        expect(hits[0]!.attrs).toEqual({ path: '/a.png' })
    })

    it('quote 与 artifact 混排按原文位置归并；半截不产出命中', () => {
        const hits = scanXmlTagHits(
            `<mobi:quote index="1"/> 中 ${artifact('/b.png')} <quote index="2"/>`,
            FAMILY_TAG_NAMES,
        )
        expect(hits.map(h => h.tagName)).toEqual(['mobi:quote', 'mobi:artifact', 'quote'])
        expect(scanXmlTagHits('尾巴 <mobi:artifact path="/ab', FAMILY_TAG_NAMES)).toEqual([])
    })

    it('中文弯引号容错（与 quote 族同一 parseTagAttrs 单源）', () => {
        const hits = scanXmlTagHits('<mobi:artifact path=“/a.png”/>', ARTIFACT_TAG_NAMES)
        expect(hits[0]!.attrs).toEqual({ path: '/a.png' })
    })
})

describe('truncateIncompleteXmlTagTail（流式原子揭示，族通用）', () => {
    it('半截开标签尾巴扣住：artifact 与 quote 形态同等', () => {
        expect(truncateIncompleteXmlTagTail('看图 <mobi:artifact path="/ab', FAMILY_OPENS))
            .toBe('看图 ')
        expect(truncateIncompleteXmlTagTail('A <mobi:quote index="', FAMILY_OPENS)).toBe('A ')
        expect(truncateIncompleteXmlTagTail('A <quote index="1', FAMILY_OPENS)).toBe('A ')
    })

    it('完整自闭合 / 完整回显不扣；形近词（<mobiar / <mobi:artifactx）不误扣', () => {
        const done = `图 ${artifact('/a.png')} 与 <mobi:quote index="1"/>`
        expect(truncateIncompleteXmlTagTail(done, FAMILY_OPENS)).toBe(done)
        const echo = '<mobi:artifact path="/a.png">x</mobi:artifact> 尾'
        expect(truncateIncompleteXmlTagTail(echo, FAMILY_OPENS)).toBe(echo)
        const lookalike = '正文 <mobiar 与 <mobi:artifactx 讨论协议本身'
        expect(truncateIncompleteXmlTagTail(lookalike, FAMILY_OPENS)).toBe(lookalike)
    })
})

describe('dedupeXmlTagText（族通用去重，键空间按标签名隔离）', () => {
    it('同 path 的 artifact 重复只保留首次，不同 path 都保留', () => {
        expect(dedupeXmlTagText(`A ${artifact('/a.png')} B ${artifact('/a.png')} C`, FAMILY_TAG_NAMES, familyKeyOf))
            .toBe(`A ${artifact('/a.png')} B  C`)
        expect(dedupeXmlTagText(`${artifact('/a.png')}${artifact('/b.png')}`, FAMILY_TAG_NAMES, familyKeyOf))
            .toBe(`${artifact('/a.png')}${artifact('/b.png')}`)
    })

    it('quote 与 artifact 键空间隔离：index="1" 与 path="1" 不互删', () => {
        const text = '<mobi:quote index="1"/><mobi:artifact path="1"/>'
        expect(dedupeXmlTagText(text, FAMILY_TAG_NAMES, familyKeyOf)).toBe(text)
    })

    it('非法命中（缺 path 的 artifact / 非法 index 的 quote）不参与去重，原样保留', () => {
        const text = `${artifact('/a.png')}<mobi:artifact mode="card"/><mobi:quote index="x"/>`
        expect(dedupeXmlTagText(text, FAMILY_TAG_NAMES, familyKeyOf)).toBe(text)
    })

    it('protectedRanges：代码区间内的字面量受保护（不摘除不占键），其后的区外命中仍按首个处理', () => {
        const inner = artifact('/a.png')
        const text = `${inner} A ${inner} B ${inner}`
        const protectedFirst = [{ start: 0, end: inner.length }]
        // 首个受保护：不摘除、不占去重键 → 第二个成为首个合法命中保留，第三个摘除
        expect(dedupeXmlTagText(text, FAMILY_TAG_NAMES, familyKeyOf, protectedFirst))
            .toBe(`${inner} A ${inner} B `)
    })
})

describe('buildXmlTokenShape（tokenizer 正形）', () => {
    it('外层整组 ^ 锚定：任意成员形态在串首命中、串中不命中（alternation 锚定回归）', () => {
        const re = new RegExp(`^${buildXmlTokenShape(FAMILY_TAG_NAMES)}`)
        expect(re.test('<mobi:quote index="1"/>')).toBe(true)
        expect(re.test('<quote index="1"/>')).toBe(true)
        expect(re.test('<mobi:artifact path="/a"/>')).toBe(true)
        expect(re.test('前文 <mobi:quote index="1"/>')).toBe(false)
    })

    it('alternation 的 < 逐分支携带：裸标签名（artifact/quote）不误命中', () => {
        const re = new RegExp(`^${buildXmlTokenShape(FAMILY_TAG_NAMES)}`)
        expect(re.test('artifact path="/a"')).toBe(false)
        expect(re.test('quote index="1"')).toBe(false)
    })
})
