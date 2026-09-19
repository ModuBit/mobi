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
import { buildPromptFromBlocks, stripPngTextChunks } from '@/utils/promptBuilder'

let dir: string
beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'prompt-builder-'))
    // PNG 魔数头，内容真假不影响转换（只读文件字节做 base64）
    writeFileSync(join(dir, 'pic.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]))
})
afterAll(() => rmSync(dir, { recursive: true, force: true }))

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

/** 构造 PNG chunk（length + type + data + crc；crc 填 0——剥离函数不校验 CRC） */
function pngChunk(type: string, data: Buffer): Buffer {
    const len = Buffer.alloc(4)
    len.writeUInt32BE(data.length)
    return Buffer.concat([len, Buffer.from(type, 'ascii'), data, Buffer.alloc(4)])
}

/** 组装 PNG：签名 + chunks；tEXt 的 data 为「keyword\0text」形态 */
function pngWith(chunks: Buffer[]): Buffer {
    return Buffer.concat([PNG_SIGNATURE, ...chunks])
}

describe('stripPngTextChunks', () => {
    it('剥离全部 tEXt chunk，其余 chunk 逐字节保留', () => {
        const ihdr = pngChunk('IHDR', Buffer.alloc(13))
        const idat = pngChunk('IDAT', Buffer.from([1, 2, 3]))
        const text1 = pngChunk('tEXt', Buffer.from('application/x.excalidraw\0{"type":"excalidraw"}'))
        const text2 = pngChunk('tEXt', Buffer.from('Software\0excalidraw'))
        const iend = pngChunk('IEND', Buffer.alloc(0))

        const out = stripPngTextChunks(pngWith([ihdr, text1, idat, text2, iend]))

        expect(out.equals(pngWith([ihdr, idat, iend]))).toBe(true)
    })

    it('无 tEXt 的 PNG 原样返回（等值但允许新 Buffer）', () => {
        const ihdr = pngChunk('IHDR', Buffer.alloc(13))
        const idat = pngChunk('IDAT', Buffer.from([9]))
        const input = pngWith([ihdr, idat])
        expect(stripPngTextChunks(input).equals(input)).toBe(true)
    })

    it('非 PNG 输入原样返回（不解析不改动）', () => {
        const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3])
        expect(stripPngTextChunks(jpeg).equals(jpeg)).toBe(true)
    })

    it('截断/畸形输入不抛异常，原样或安全产出返回', () => {
        const truncated = Buffer.from([0x89, 0x50, 0x4e, 0x47])
        expect(() => stripPngTextChunks(truncated)).not.toThrow()
    })
})

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

    it('data source 图片走 @path 降级并锁定产出 @<value>', () => {
        // data 形态仅留骨架占位（落库恒用 url），读取恒降级
        const r = buildPromptFromBlocks([{
            type: 'image',
            source: { type: 'data', value: 'aGVsbG8=', mimeType: 'image/png' },
            id: 'i2', filename: 'x.png', size: 5,
        }])
        expect(r).toBe('@aGVsbG8=')
    })

    it('成功+失败图片混合 → 数组含一个 image 元素 + 一个含 @path 失败路径的 text 元素', () => {
        const r = buildPromptFromBlocks([
            img(join(dir, 'pic.png')),            // 读取成功 → base64 image 元素
            img('/nonexistent/y.png'),            // 读取失败 → @path 降级入缓冲
            { type: 'text', text: 'hi' },         // 正文并入缓冲，末尾冲刷为 text 元素
        ])
        expect(r).toEqual([
            { type: 'image', source: { type: 'base64', media_type: 'image/png', data: base64OfPng } },
            { type: 'text', text: '@/nonexistent/y.png\n\nhi' },
        ])
    })

    it('空数组退化为空串', () => {
        expect(buildPromptFromBlocks([])).toBe('')
    })

    it('带内嵌 scene 的 PNG：发送的 base64 是剥离 tEXt 后的字节', () => {
        // 画板产物：scene 内嵌在 tEXt chunk，发 SDK 前剥离（对模型无意义，白占 payload）
        const text = pngChunk('tEXt', Buffer.from('application/x.excalidraw\0{"type":"excalidraw","version":2}'))
        const imgData = pngChunk('IDAT', Buffer.from([7, 7, 7]))
        const png = pngWith([text, imgData])
        const pngPath = join(dir, 'sketch.excalidraw.png')
        writeFileSync(pngPath, png)

        const r = buildPromptFromBlocks([img(pngPath)])
        expect(Array.isArray(r)).toBe(true)
        const image = (r as Extract<typeof r, Array<object>>).find(el => el.type === 'image') as { source: { data: string } }
        const decoded = Buffer.from(image.source.data, 'base64')
        expect(decoded.equals(pngWith([imgData]))).toBe(true)
        // 保险：原始字节确实含 tEXt（证明剥离真的发生了）
        expect(png.includes('tEXt')).toBe(true)
    })

    it('超过单图字节上限的图片降级 @path（API base64 5MB 上限防线）', () => {
        const bigPath = join(dir, 'big.png')
        writeFileSync(bigPath, Buffer.concat([PNG_SIGNATURE, Buffer.alloc(4 * 1024 * 1024, 1)]))
        expect(buildPromptFromBlocks([img(bigPath)])).toBe(`@${bigPath}`)
    })
})
