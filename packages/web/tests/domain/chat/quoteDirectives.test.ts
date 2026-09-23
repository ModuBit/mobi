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

// quoteDirectives 行为锁定：directive 解析 / 重复剔除（spec .scratch/response-annotations 票 03）
import { describe, expect, it } from 'vitest'
import { QUOTE_DIRECTIVE } from '@mobi/shared'
import { collectQuoteAnnotationsByAgentId, dedupeQuoteDirectiveText, parseQuoteDirectives } from '@/domain/chat/quoteDirectives'
import type { UserContentBlock } from '@mobi/shared'
import type { ChatBlock } from '@/domain/chat/types'

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

describe('collectQuoteAnnotationsByAgentId（批注↔回复 turn 配对）', () => {
    const quote = (messageId: string, excerpt = `摘录-${messageId}`) =>
        ({ type: 'quote', messageId, role: 'agent', excerpt }) as UserContentBlock
    const user = (id: string, ...quotes: UserContentBlock[]): ChatBlock =>
        ({ kind: 'user-text', id, localId: id, createdAt: 0, blocks: quotes })
    const agent = (id: string): ChatBlock =>
        ({ kind: 'agent-text', id, localId: id, createdAt: 0, text: `回复-${id}` })

    it('常规一轮：同轮多条 agent 消息共享该轮引用；下一轮 user 换血', () => {
        const blocks = [user('u1', quote('m1')), agent('r1'), agent('r2'), user('u2', quote('m2')), agent('r3')]
        const map = collectQuoteAnnotationsByAgentId(blocks)
        expect(map.get('r1')?.[0].messageId).toBe('m1')
        expect(map.get('r2')?.[0].messageId).toBe('m1')
        expect(map.get('r3')?.[0].messageId).toBe('m2')
    })

    it('steer 场景：回复落库前用户连发多条，回复按 FIFO 消费最早未配对的 user 引用', () => {
        // 块序 u1, u2, r1, r2（r1 是对 u1 的回复，r2 才处理 u2 的 steer）——线性覆盖会让 r1 错配 u2
        const blocks = [user('u1', quote('m1')), user('u2', quote('m2')), agent('r1'), agent('r2')]
        const map = collectQuoteAnnotationsByAgentId(blocks)
        expect(map.get('r1')?.[0].messageId).toBe('m1')
        expect(map.get('r2')?.[0].messageId).toBe('m2')
    })

    it('无引用 user 是边界：其后的回复不沿用上一轮引用', () => {
        const blocks = [user('u1', quote('m1')), agent('r1'), user('u2'), agent('r2')]
        const map = collectQuoteAnnotationsByAgentId(blocks)
        expect(map.get('r1')?.[0].messageId).toBe('m1')
        expect(map.has('r2')).toBe(false)
    })

    it('会话无任何引用返回共享空 Map', () => {
        expect(collectQuoteAnnotationsByAgentId([user('u1'), agent('r1')])).toBe(collectQuoteAnnotationsByAgentId([]))
    })
})
