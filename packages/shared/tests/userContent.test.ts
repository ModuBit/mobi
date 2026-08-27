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
import {
    UserContentBlockSchema,
    UserMessageContentSchema,
    normalizeUserContent,
    QUOTE_EXCERPT_MAX,
} from '../src/userContentSchema'

describe('UserContentBlockSchema', () => {
    it('接受 text/image/document/quote 四种 block', () => {
        expect(UserContentBlockSchema.safeParse({ type: 'text', text: 'hi' }).success).toBe(true)
        expect(UserContentBlockSchema.safeParse({
            type: 'image',
            source: { type: 'url', value: '/uploads/a.png', mimeType: 'image/png' },
            id: '1', filename: 'a.png', size: 10,
        }).success).toBe(true)
        expect(UserContentBlockSchema.safeParse({
            type: 'document',
            source: { type: 'url', value: '/uploads/r.pdf' },
            id: '2', filename: 'r.pdf', size: 20,
        }).success).toBe(true)
        expect(UserContentBlockSchema.safeParse({
            type: 'quote', messageId: 'local-x', role: 'agent', excerpt: '…',
        }).success).toBe(true)
    })

    it('拒绝未知 block 类型', () => {
        expect(UserContentBlockSchema.safeParse({ type: 'audio' }).success).toBe(false)
    })
})

describe('UserMessageContentSchema 三形态', () => {
    it('接受 string / 单 block / block 数组', () => {
        expect(UserMessageContentSchema.safeParse('hi').success).toBe(true)
        expect(UserMessageContentSchema.safeParse({ type: 'text', text: 'hi' }).success).toBe(true)
        expect(UserMessageContentSchema.safeParse([{ type: 'text', text: 'hi' }]).success).toBe(true)
    })
})

describe('normalizeUserContent 四形态归一', () => {
    it('string → 单 text block 数组', () => {
        expect(normalizeUserContent('hi')).toEqual([{ type: 'text', text: 'hi' }])
    })

    it('存量平铺 object（含/不含 attachments）→ 数组', () => {
        expect(normalizeUserContent({ type: 'text', text: 'a' })).toEqual([{ type: 'text', text: 'a' }])
        expect(normalizeUserContent({
            type: 'text', text: 'a',
            attachments: [{ id: '1', filename: 'f.pdf', mimeType: 'application/pdf', size: 1, path: '/p/f.pdf' }],
        })).toEqual([
            { type: 'text', text: 'a' },
            {
                type: 'document',
                source: { type: 'url', value: '/p/f.pdf', mimeType: 'application/pdf' },
                id: '1', filename: 'f.pdf', size: 1,
            },
        ])
    })

    it('单 block 对象 → 单元素数组；数组原样通过', () => {
        expect(normalizeUserContent({ type: 'text', text: 'a' })).toEqual([{ type: 'text', text: 'a' }])
        const arr = [{ type: 'text', text: 'a' }] as const
        expect(normalizeUserContent(arr)).toEqual(arr)
    })

    it('畸形输入返回 null；未知 block 被剔除，全未知返回 null', () => {
        expect(normalizeUserContent(42)).toEqual(null)
        expect(normalizeUserContent(null)).toEqual(null)
        // 空串 / 空数组：无有效内容
        expect(normalizeUserContent('')).toEqual(null)
        expect(normalizeUserContent([])).toEqual(null)
        expect(normalizeUserContent([{ type: 'audio' }, { type: 'text', text: 'b' }]))
            .toEqual([{ type: 'text', text: 'b' }])
        expect(normalizeUserContent([{ type: 'audio' }])).toEqual(null)
    })

    it('空 text block 与空串 string 行为一致（null / 跳过）', () => {
        expect(normalizeUserContent({ type: 'text', text: '' })).toEqual(null)
    })

    it('legacy 平铺缺 text 字段但带合法附件时保留附件', () => {
        expect(normalizeUserContent({
            type: 'text',
            attachments: [{ id: '1', filename: 'f.pdf', mimeType: 'application/pdf', size: 1, path: '/p/f.pdf' }],
        })).toEqual([
            { type: 'document', source: { type: 'url', value: '/p/f.pdf', mimeType: 'application/pdf' }, id: '1', filename: 'f.pdf', size: 1 },
        ])
    })

    it('excerpt 超 QUOTE_EXCERPT_MAX 的 quote 被 schema 拒绝', () => {
        const overMax = { type: 'quote', messageId: 'm', role: 'agent', excerpt: 'x'.repeat(QUOTE_EXCERPT_MAX + 1) }
        expect(UserContentBlockSchema.safeParse(overMax).success).toBe(false)
    })

    it('QUOTE_EXCERPT_MAX 为 200', () => {
        expect(QUOTE_EXCERPT_MAX).toBe(200)
    })
})
