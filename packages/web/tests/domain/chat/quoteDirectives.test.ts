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

// quoteDirectives 行为锁定：directive 解析 / 重复剔除 / 计数（spec .scratch/response-annotations 票 03/04）
import { describe, expect, it } from 'vitest'
import { QUOTE_DIRECTIVE } from '@mobi/shared'
import { collectQuoteDirectiveIndexes, dedupeQuoteDirectiveText, parseQuoteDirectives } from '@/domain/chat/quoteDirectives'

const d = (n: number) => `${QUOTE_DIRECTIVE}{index="${n}"}`

describe('parseQuoteDirectives', () => {
    it('无 directive 返回空数组（含形近文本）', () => {
        expect(parseQuoteDirectives('普通正文')).toEqual([])
        expect(parseQuoteDirectives(`注释 1 与 ${QUOTE_DIRECTIVE}{idx="1"}`)).toEqual([])
        // 半截 directive（流式中）：不完整不命中
        expect(parseQuoteDirectives(`前文 ${QUOTE_DIRECTIVE}{index="`)).toEqual([])
    })

    it('单条命中：index 与位置', () => {
        const text = `前文 ${d(2)} 后文`
        expect(parseQuoteDirectives(text)).toEqual([
            { index: 2, start: 3, end: 3 + d(2).length },
        ])
    })

    it('多条命中按出现顺序', () => {
        const text = `${d(1)} 中 ${d(3)} 尾`
        const hits = parseQuoteDirectives(text)
        expect(hits.map(h => h.index)).toEqual([1, 3])
        // 位置互指原文切片
        for (const h of hits) {
            expect(text.slice(h.start, h.end)).toBe(d(h.index))
        }
    })
})

describe('dedupeQuoteDirectiveText', () => {
    it('无 directive 原样返回', () => {
        const text = '普通正文 with :mobi-quote{foo}'
        expect(dedupeQuoteDirectiveText(text)).toBe(text)
    })

    it('同 index 重复只保留首个（渲染层去重，handoff 失败模式）', () => {
        const text = `A ${d(1)} B ${d(1)} C ${d(2)} D ${d(2)} E`
        expect(dedupeQuoteDirectiveText(text)).toBe(`A ${d(1)} B  C ${d(2)} D  E`)
    })

    it('不同 index 互不影响', () => {
        const text = `${d(1)}${d(2)}${d(1)}`
        expect(dedupeQuoteDirectiveText(text)).toBe(`${d(1)}${d(2)}`)
    })
})

describe('collectQuoteDirectiveIndexes', () => {
    it('去重 + 升序（header chip 计数口径）', () => {
        expect(collectQuoteDirectiveIndexes(`${d(2)} ${d(1)} ${d(2)} ${d(3)}`)).toEqual([1, 2, 3])
        expect(collectQuoteDirectiveIndexes('无标记')).toEqual([])
    })
})
