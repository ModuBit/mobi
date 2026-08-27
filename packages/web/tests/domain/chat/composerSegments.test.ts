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
 * composerSegments 单元测试
 * Composer 分段 ↔ UserContentBlock[] 序列化往返：固定顺序 / quote 上限与截断 / 纯文本退化
 */

import { describe, it, expect } from 'vitest'
import {
    serializeSegments,
    deserializeSegments,
    isSegmentEmpty,
    emptySegments,
} from '@/domain/chat/composerSegments'

const seg = {
    text: '帮我看看',
    files: [{ id: 'f1', filename: 'r.pdf', path: '/u/r.pdf', mimeType: 'application/pdf', size: 5 }],
    images: [{ id: 'g1', filename: 'p.png', path: '/u/p.png', mimeType: 'image/png', size: 7 }],
    quotes: [{ messageId: 'm1', role: 'agent' as const, excerpt: 'E' }],
}

describe('composerSegments', () => {
    it('serializeSegments 固定顺序 files(document)→images→quote→text', () => {
        expect(serializeSegments(seg)).toEqual([
            { type: 'document', source: { type: 'url', value: '/u/r.pdf', mimeType: 'application/pdf' }, id: 'f1', filename: 'r.pdf', size: 5 },
            { type: 'image', source: { type: 'url', value: '/u/p.png', mimeType: 'image/png' }, id: 'g1', filename: 'p.png', size: 7 },
            { type: 'quote', messageId: 'm1', role: 'agent', excerpt: 'E' },
            { type: 'text', text: '帮我看看' },
        ])
    })

    it('deserializeSegments 往返还原分段', () => {
        expect(deserializeSegments(serializeSegments(seg))).toEqual(seg)
    })

    it('纯文本退化单 text block / 空 segments 返回空数组', () => {
        expect(serializeSegments({ text: 'hi', files: [], images: [], quotes: [] })).toEqual([{ type: 'text', text: 'hi' }])
        expect(serializeSegments({ text: '', files: [], images: [], quotes: [] })).toEqual([])
    })

    it('excerpt 超 QUOTE_EXCERPT_MAX(200) 序列化时截断；仅取首条 quote', () => {
        const s = {
            ...seg,
            quotes: [
                { messageId: 'm1', role: 'user' as const, excerpt: 'x'.repeat(300) },
                { messageId: 'm2', role: 'user' as const, excerpt: 'y'.repeat(10) },
            ],
        }
        const out = serializeSegments(s)
        const quotes = out.filter(b => b.type === 'quote')
        // 仅首条参与发送
        expect(quotes).toHaveLength(1)
        expect(out.find(b => b.type === 'quote')).toMatchObject({ excerpt: 'x'.repeat(200), messageId: 'm1' })
    })

    it('previewUrl 存在时透传，不存在时不产生多余字段', () => {
        const withPreview = serializeSegments({
            ...seg,
            images: [{ ...seg.images[0]!, previewUrl: '/api/files/prev' }],
        })
        const img = withPreview.find(b => b.type === 'image') as Record<string, unknown>
        expect(img.previewUrl).toBe('/api/files/prev')

        const noPreview = serializeSegments(seg)
        const doc = noPreview.find(b => b.type === 'document') as Record<string, unknown>
        expect('previewUrl' in doc).toBe(false)
    })

    it('text 仅 trim 后非空才入列；deserialize 多 text block join(\'\\n\') 合并', () => {
        expect(serializeSegments({ text: '   ', files: [], images: [], quotes: [] })).toEqual([])

        const round = deserializeSegments([
            { type: 'text', text: '第一段' },
            { type: 'document', source: { type: 'url', value: '/u/a.pdf', mimeType: 'application/pdf' }, id: 'd1', filename: 'a.pdf', size: 1 },
            { type: 'text', text: '第二段' },
        ])
        expect(round.text).toBe('第一段\n第二段')
        expect(round.files).toEqual([{ id: 'd1', filename: 'a.pdf', path: '/u/a.pdf', mimeType: 'application/pdf', size: 1 }])
        expect(round.images).toEqual([])
        expect(round.quotes).toEqual([])
    })

    it('isSegmentEmpty：纯空白文本 + 无附件 + 无引用为空', () => {
        expect(isSegmentEmpty(emptySegments())).toBe(true)
        expect(isSegmentEmpty({ text: '  \n ', files: [], images: [], quotes: [] })).toBe(true)
        expect(isSegmentEmpty({ ...emptySegments(), text: 'hi' })).toBe(false)
        expect(isSegmentEmpty({ ...emptySegments(), images: [seg.images[0]!] })).toBe(false)
    })
})
