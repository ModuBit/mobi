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
 * footnotePlugin 单元测试
 *
 * 覆盖 extractFootnotes 的核心场景：无脚注、正常提取、代码块保护、
 * 流式不完整定义、多链接 description 提取等。
 */

import { describe, it, expect } from 'vitest'
import { extractFootnotes } from '@/components/ui/footnotePlugin'

describe('extractFootnotes', () => {
    it('无脚注内容直接返回原文', () => {
        const result = extractFootnotes('hello world')
        expect(result.cleanContent).toBe('hello world')
        expect(result.footnotes).toEqual([])
    })

    it('含 [^ 但不含 ]: 时快速返回原文', () => {
        const content = 'some text [^1] and more'
        const result = extractFootnotes(content)
        expect(result.cleanContent).toBe(content)
        expect(result.footnotes).toEqual([])
    })

    it('提取单个简单脚注定义', () => {
        const content = '正文[^1]\n\n[^1]: 脚注内容'
        const { cleanContent, footnotes } = extractFootnotes(content)
        expect(cleanContent).toBe('正文[^1]')
        expect(footnotes).toEqual([{
            key: 'fn-1',
            num: 1,
            title: '脚注内容',
            url: undefined,
            description: undefined,
        }])
    })

    it('提取含链接的脚注定义', () => {
        const content = '正文[^1]\n\n[^1]: [Alibaba](https://example.com)'
        const { cleanContent, footnotes } = extractFootnotes(content)
        expect(cleanContent).toBe('正文[^1]')
        expect(footnotes).toEqual([{
            key: 'fn-1',
            num: 1,
            title: 'Alibaba',
            url: 'https://example.com',
            description: undefined,
        }])
    })

    it('提取含链接和额外描述的脚注', () => {
        const content = '[^1]: [文档](https://example.com) 额外说明文字'
        const { footnotes } = extractFootnotes(content)
        expect(footnotes[0].title).toBe('文档')
        expect(footnotes[0].url).toBe('https://example.com')
        expect(footnotes[0].description).toBe('额外说明文字')
    })

    it('多个脚注按序号提取', () => {
        const content = [
            '正文[^1][^2][^3]',
            '',
            '[^1]: 第一个',
            '[^2]: [第二个](https://b.com)',
            '[^3]: 第三个',
        ].join('\n')
        const { footnotes, cleanContent } = extractFootnotes(content)
        expect(footnotes).toHaveLength(3)
        expect(footnotes[0].num).toBe(1)
        expect(footnotes[1].num).toBe(2)
        expect(footnotes[1].url).toBe('https://b.com')
        expect(footnotes[2].num).toBe(3)
        // 正文保留引用，定义被移除
        expect(cleanContent).toContain('[^1]')
        expect(cleanContent).toContain('[^2]')
        expect(cleanContent).toContain('[^3]')
        expect(cleanContent).not.toContain('[^1]:')
    })

    it('跳过代码围栏内的伪脚注定义', () => {
        const content = [
            '正文[^1]',
            '',
            '```',
            '[^2]: 这不该被提取',
            '```',
            '',
            '[^1]: 真正的脚注',
        ].join('\n')
        const { footnotes, cleanContent } = extractFootnotes(content)
        expect(footnotes).toHaveLength(1)
        expect(footnotes[0].num).toBe(1)
        expect(cleanContent).toContain('[^2]: 这不该被提取')
    })

    it('跳过波浪线围栏内的伪脚注定义', () => {
        const content = [
            '正文[^1]',
            '',
            '~~~',
            '[^2]: 这不该被提取',
            '~~~',
            '',
            '[^1]: 真正的脚注',
        ].join('\n')
        const { footnotes } = extractFootnotes(content)
        expect(footnotes).toHaveLength(1)
        expect(footnotes[0].num).toBe(1)
    })

    it('空定义行不被提取（流式场景）', () => {
        const content = '正文[^1]\n\n[^1]:'
        const { footnotes, cleanContent } = extractFootnotes(content)
        expect(footnotes).toEqual([])
        // 空定义行保留在原文中
        expect(cleanContent).toContain('[^1]:')
    })

    it('多链接 description 只保留链接外文字', () => {
        const content = '[^1]: [链接A](https://a.com) 和 [链接B](https://b.com) 的说明'
        const { footnotes } = extractFootnotes(content)
        // title 取第一个链接
        expect(footnotes[0].title).toBe('链接A')
        expect(footnotes[0].url).toBe('https://a.com')
        // description 移除所有链接后保留剩余文字（replace 后可能留多余空格）
        expect(footnotes[0].description?.replace(/\s+/g, ' ').trim()).toBe('和 的说明')
    })

    it('清洗后不产生多余空行', () => {
        const content = 'A\n\n[^1]: X\n\n[^2]: Y\n\nB'
        const { cleanContent } = extractFootnotes(content)
        expect(cleanContent).not.toMatch(/\n{3,}/)
    })
})
