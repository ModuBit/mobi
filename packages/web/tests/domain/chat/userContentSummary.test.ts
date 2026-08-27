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

import { describe, expect, it } from 'vitest'
import { summarizeBlocks, joinSummaries } from '../../../src/domain/chat/userContentSummary'

const LABELS = { file: '[文件]', image: '[图片]', quote: '[引用]' }

describe('summarizeBlocks', () => {
    it('text 原文依次连接', () => {
        expect(summarizeBlocks([{ type: 'text', text: 'hi' }], LABELS)).toBe('hi')
        expect(summarizeBlocks([{ type: 'text', text: 'a' }, { type: 'text', text: 'b' }], LABELS)).toBe('ab')
    })

    it('非 text block 以标签占位，顺序保持', () => {
        expect(summarizeBlocks([
            { type: 'document', source: { type: 'url', value: '/a.pdf' }, id: 'd', filename: 'a.pdf', size: 1 },
            { type: 'image', source: { type: 'url', value: '/b.png' }, id: 'i', filename: 'b.png', size: 2 },
            { type: 'quote', messageId: 'm', role: 'agent', excerpt: 'x' },
            { type: 'text', text: 'hi' },
        ], LABELS)).toBe('[文件][图片][引用]hi')
    })

    it('空数组返回空串', () => {
        expect(summarizeBlocks([], LABELS)).toBe('')
    })
})

describe('joinSummaries', () => {
    it('非空摘要 join；全空返回 null', () => {
        expect(joinSummaries(['a', null, '', 'b'])).toBe('a\nb')
        expect(joinSummaries(['', null])).toBe(null)
    })
})
