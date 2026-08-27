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
 * 验证 sanitizeUserMessage 对 LaTeX 行内公式的预处理行为。
 *
 * 背景：Claude API 的 prompt injection 过滤器会拦截消息中的 $...$ 语法，
 * 导致返回 400 invalid_request_error。
 * 将 $...$ 替换为 \(...\) 可绕过此限制，且两种语法在 LaTeX 中等价。
 *
 * @see packages/cli/src/claude/claudeRemote.ts
 */

import { describe, it, expect } from 'vitest'
import { sanitizeUserMessage, sanitizePayload } from '@/claude/claudeRemote'

describe('sanitizeUserMessage', () => {
    it('应将单行内 LaTeX 公式 $...$ 替换为 \\(...\\)', () => {
        const input = '推导勾股定理 $a^2 + b^2 = c^2$ 的过程如下'
        const expected = '推导勾股定理 \\(a^2 + b^2 = c^2\\) 的过程如下'
        expect(sanitizeUserMessage(input)).toBe(expected)
    })

    it('应处理消息中多个 $...$ 公式', () => {
        const input = '面积 $S = \\pi r^2$，周长 $C = 2\\pi r$'
        const expected = '面积 \\(S = \\pi r^2\\)，周长 \\(C = 2\\pi r\\)'
        expect(sanitizeUserMessage(input)).toBe(expected)
    })

    it('应处理仅包含 $...$ 的纯公式消息', () => {
        const input = '$E = mc^2$'
        const expected = '\\(E = mc^2\\)'
        expect(sanitizeUserMessage(input)).toBe(expected)
    })

    it('不应对已转义的 \\$ 进行替换', () => {
        const input = '价格 \\$100，公式 $x^2$'
        const expected = '价格 \\$100，公式 \\(x^2\\)'
        expect(sanitizeUserMessage(input)).toBe(expected)
    })

    it('不包含 $ 的普通文本应保持不变', () => {
        const input = '你好，请帮我写一个排序算法'
        expect(sanitizeUserMessage(input)).toBe(input)
    })

    it('不应处理块级公式 $$...$$（只替换单层 $）', () => {
        const input = '$$\\int_a^b f(x)dx = F(b) - F(a)$$'
        expect(sanitizeUserMessage(input)).toBe(input)
    })

    it('应处理包含换行符的消息（只替换同一行内的 $...$）', () => {
        const input = '第一行 $a+b$\n第二行 $c+d$'
        const expected = '第一行 \\(a+b\\)\n第二行 \\(c+d\\)'
        expect(sanitizeUserMessage(input)).toBe(expected)
    })

    it('应处理空字符串', () => {
        expect(sanitizeUserMessage('')).toBe('')
    })
})

describe('sanitizePayload', () => {
    it('string 形态行为与 sanitizeUserMessage 一致', () => {
        expect(sanitizePayload('成本是 $a+b$，注意开销')).toBe('成本是 \\(a+b\\)，注意开销')
        expect(sanitizePayload('无公式的普通文本')).toBe('无公式的普通文本')
    })

    it('数组形态：text 元素转义、image 原样保留、元素顺序不变', () => {
        const imageBlock = {
            type: 'image' as const,
            source: { type: 'base64' as const, media_type: 'image/png' as const, data: 'aGVsbG8=' },
        }
        const payload = [
            { type: 'text' as const, text: '这张图里 $x+y$ 的含义是什么？' },
            imageBlock,
            { type: 'text' as const, text: '另外解释 $z^2$ 项' },
        ]
        const result = sanitizePayload(payload)
        expect(result).toEqual([
            { type: 'text', text: '这张图里 \\(x+y\\) 的含义是什么？' },
            imageBlock,
            { type: 'text', text: '另外解释 \\(z^2\\) 项' },
        ])
    })

    it('数组形态：不含 $ 的 text 元素保持原样，不产生多余拷贝差异', () => {
        const payload = [{ type: 'text' as const, text: '普通文本' }]
        expect(sanitizePayload(payload)).toEqual([{ type: 'text', text: '普通文本' }])
    })
})
