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
import { ansiToHtml } from '@/core/lib/ansiUtils'

describe('ansiToHtml', () => {
    it('纯文本原样返回', () => {
        expect(ansiToHtml('hello world')).toBe('hello world')
    })

    it('转义 HTML 特殊字符', () => {
        expect(ansiToHtml('<script>alert(1)</script>')).not.toContain('<script>')
        expect(ansiToHtml('a & b < c > d')).toContain('&amp;')
        expect(ansiToHtml('a & b < c > d')).toContain('&lt;')
    })

    it('渲染 ANSI 颜色代码', () => {
        const result = ansiToHtml('\x1b[31mred text\x1b[0m')
        expect(result).toContain('red text')
        expect(result).toContain('<span')
        expect(result).toContain('style=')
    })

    it('渲染 ANSI 粗体', () => {
        const result = ansiToHtml('\x1b[1mbold\x1b[0m')
        expect(result).toContain('bold')
        expect(result).toContain('font-weight')
    })

    it('渲染 ANSI 暗淡', () => {
        const result = ansiToHtml('\x1b[2mdim\x1b[0m')
        expect(result).toContain('dim')
    })

    it('渲染 ANSI 斜体', () => {
        const result = ansiToHtml('\x1b[3mitalic\x1b[0m')
        expect(result).toContain('italic')
    })

    it('多次调用之间无状态泄漏', () => {
        // 第一次以未关闭的颜色结束
        const first = ansiToHtml('\x1b[32mgreen')
        expect(first).toContain('green')

        // 第二次调用不应继承第一次的颜色状态
        const second = ansiToHtml('plain text')
        expect(second).toBe('plain text')
    })

    it('处理空字符串', () => {
        expect(ansiToHtml('')).toBe('')
    })

    it('处理多行输出', () => {
        const input = 'line1\n\x1b[31mline2\x1b[0m\nline3'
        const result = ansiToHtml(input)
        expect(result).toContain('line1')
        expect(result).toContain('line2')
        expect(result).toContain('line3')
    })
})
