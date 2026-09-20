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
import { groupUserBlocks } from '../../../src/domain/chat/userContent'
import type { UserImageBlock, UserQuoteBlock, UserTextBlock } from '@mobi/shared'

const text = (t: string): UserTextBlock => ({ type: 'text', text: t })

const image = (id: string): UserImageBlock => ({
    type: 'image',
    id,
    filename: `${id}.png`,
    size: 100,
    source: { type: 'url', value: `.mobi/uploads/${id}.png` },
})

describe('groupUserBlocks', () => {
    it('连续 image 归并为一段 images', () => {
        const groups = groupUserBlocks([image('a'), image('b'), image('c')])
        expect(groups).toEqual([{ kind: 'images', blocks: [image('a'), image('b'), image('c')] }])
    })

    it('text 打断归并：images 只聚合相邻段，保持发送侧分段顺序', () => {
        const groups = groupUserBlocks([image('a'), text('说明'), image('b')])
        expect(groups).toHaveLength(3)
        expect(groups[0]).toMatchObject({ kind: 'images' })
        expect(groups[1]).toMatchObject({ kind: 'block', block: text('说明') })
        expect(groups[2]).toMatchObject({ kind: 'images' })
    })

    it('document 归并行为不回归（既有语义）', () => {
        const doc = {
            type: 'document' as const, id: 'd1', filename: 'f.pdf', size: 1,
            source: { type: 'url' as const, value: '.mobi/uploads/f.pdf' },
        }
        const groups = groupUserBlocks([doc, doc])
        expect(groups).toEqual([{ kind: 'documents', blocks: [doc, doc] }])
    })

    it('连续 quote 归并为一段 quotes（引用组合并容器的分段保证）', () => {
        const quote: UserQuoteBlock = { type: 'quote', messageId: 'm1', role: 'agent', excerpt: 'e1' }
        const quote2: UserQuoteBlock = { type: 'quote', messageId: 'm2', role: 'user', excerpt: 'e2' }
        const groups = groupUserBlocks([quote, quote2, image('a')])
        expect(groups).toEqual([
            { kind: 'quotes', blocks: [quote, quote2] },
            { kind: 'images', blocks: [image('a')] },
        ])
    })

    it('quote 被 text 打断则不跨段归并（保持分段顺序；wire 侧 quote 恒连续）', () => {
        const quote: UserQuoteBlock = { type: 'quote', messageId: 'm1', role: 'agent', excerpt: 'e' }
        const groups = groupUserBlocks([quote, text('说明'), quote])
        expect(groups).toHaveLength(3)
        expect(groups[0]).toMatchObject({ kind: 'quotes' })
        expect(groups[1]).toMatchObject({ kind: 'block', block: text('说明') })
        expect(groups[2]).toMatchObject({ kind: 'quotes' })
    })
})
