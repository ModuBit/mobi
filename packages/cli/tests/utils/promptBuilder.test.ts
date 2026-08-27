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

// buildPromptFromBlocks 行为锁定：blocks → SDK prompt 的位置性转换
// 无成功图片时退化为 string（现状形态零差异）；有图片时输出 Anthropic content 数组
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { UserContentBlock } from '@mobi/shared'

vi.mock('@/ui/logger', () => ({
    logger: { warn: vi.fn(), debug: vi.fn(), info: vi.fn(), error: vi.fn() },
}))

// vi.mock 之上再导入被测模块（vitest 会把 vi.mock 提升到文件顶部）
import { buildPromptFromBlocks } from '@/utils/promptBuilder'

let dir: string
beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'prompt-builder-'))
    // PNG 魔数头，内容真假不影响转换（只读文件字节做 base64）
    writeFileSync(join(dir, 'pic.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]))
})
afterAll(() => rmSync(dir, { recursive: true, force: true }))

const img = (path: string, mime = 'image/png'): UserContentBlock => ({
    type: 'image', source: { type: 'url', value: path, mimeType: mime }, id: 'i1', filename: 'pic.png', size: 4,
})
const doc = (path: string): UserContentBlock => ({
    type: 'document', source: { type: 'url', value: path, mimeType: 'application/pdf' }, id: 'd1', filename: 'r.pdf', size: 9,
})
const base64OfPng = Buffer.from([0x89, 0x50, 0x4e, 0x47]).toString('base64')

describe('buildPromptFromBlocks', () => {
    it('纯文本 → string 形态（与现状零差异）', () => {
        expect(buildPromptFromBlocks([{ type: 'text', text: '你好' }])).toBe('你好')
    })

    it('全文档 → @path 单行空格合并 + 正文换段', () => {
        const r = buildPromptFromBlocks([doc('/a.pdf'), doc('/b.pdf'), { type: 'text', text: '看下' }])
        expect(r).toBe('@/a.pdf @/b.pdf\n\n看下')
    })

    it('doc→image→quote→text 全序：位置镜像 + 图片转 base64', () => {
        const r = buildPromptFromBlocks([
            doc('/a.pdf'),
            img(join(dir, 'pic.png')),
            { type: 'quote', messageId: 'm1', role: 'agent', excerpt: 'CCR backend…' },
            { type: 'text', text: '为什么走不通' },
        ])
        expect(r).toEqual([
            { type: 'text', text: '@/a.pdf' },
            { type: 'image', source: { type: 'base64', media_type: 'image/png', data: base64OfPng } },
            // quote 与其后的正文是缓冲冲刷产生的两个相邻 text 元素——设计如此（Anthropic 拼接语义）
            { type: 'text', text: '[引用 agent]：CCR backend…' },
            { type: 'text', text: '为什么走不通' },
        ])
    })

    it('图片读取失败降级 @path 且整体退化为 string', () => {
        expect(buildPromptFromBlocks([img('/nonexistent/x.png'), { type: 'text', text: 'hi' }]))
            .toBe('@/nonexistent/x.png\n\nhi')
    })

    it('不支持的多模态 MIME（svg）降级 @path', () => {
        expect(buildPromptFromBlocks([img(join(dir, 'pic.png'), 'image/svg+xml')]))
            .toBe(`@${join(dir, 'pic.png')}`)
    })

    it('quote 换行压缩为空格', () => {
        expect(buildPromptFromBlocks([{ type: 'quote', messageId: 'm', role: 'user', excerpt: 'a\nb' }]))
            .toBe('[引用 user]：a b')
    })

    it('纯附件无正文：@path 自身即内容', () => {
        expect(buildPromptFromBlocks([doc('/a.pdf')])).toBe('@/a.pdf')
    })

    it('空数组退化为空串', () => {
        expect(buildPromptFromBlocks([])).toBe('')
    })
})
