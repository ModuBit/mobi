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
 * normalizeLatexSyntax 单元测试：自研定界 → remark-math 语法的归一规则
 */

import { describe, it, expect } from 'vitest'
import { normalizeLatexSyntax } from '@/components/ui/latexSyntax'

describe('normalizeLatexSyntax', () => {
    it('\\(...\\) 单行 → $...$', () => {
        expect(normalizeLatexSyntax('质能方程 \\(E=mc^2\\) 可知')).toBe('质能方程 $E=mc^2$ 可知')
    })

    it('\\(...\\) 跨行 → 独立成段的 $$...$$（remark-math 行内不跨行）', () => {
        expect(normalizeLatexSyntax('\\(a +\nb\\)')).toBe('\n$$\na +\nb\n$$\n')
    })

    it('\\[...\\] → 独立成段的 $$...$$', () => {
        expect(normalizeLatexSyntax('前文 \\[\\frac{a}{b}\\] 后文')).toBe('前文 \n$$\n\\frac{a}{b}\n$$\n 后文')
    })

    it('数学体内 {align*} → {aligned}', () => {
        expect(normalizeLatexSyntax('\\[\\begin{align*}x &= 1\\end{align*}\\]'))
            .toBe('\n$$\n\\begin{aligned}x &= 1\\end{aligned}\n$$\n')
        expect(normalizeLatexSyntax('\\(\\begin{align*}x=1\\end{align*}\\)'))
            .toBe('$\\begin{aligned}x=1\\end{aligned}$')
    })

    it('正文里的 {align*} 不被改动（只改数学体内）', () => {
        expect(normalizeLatexSyntax('配置 {align*} 字段')).toBe('配置 {align*} 字段')
    })

    it('fenced code 内的定界符原样保留', () => {
        const src = '```tex\n\\(x^2\\)\n```'
        expect(normalizeLatexSyntax(src)).toBe(src)
    })

    it('行内 code 内的定界符原样保留', () => {
        const src = '用 `\\(x\\)` 表示'
        expect(normalizeLatexSyntax(src)).toBe(src)
    })

    it('未配对的 \\( 不改动', () => {
        expect(normalizeLatexSyntax('只有 \\( 一个')).toBe('只有 \\( 一个')
    })

    it('已配对的 $...$ 不受影响', () => {
        expect(normalizeLatexSyntax('行内 $E=mc^2$ 公式')).toBe('行内 $E=mc^2$ 公式')
    })
})

describe('normalizeLatexSyntax 跨行单 $ 对转义（旧栈核心修复平移）', () => {
    it('跨行单 $ 对转义为 \\$ 字面量', () => {
        expect(normalizeLatexSyntax('$0.2290\nsome text\n$')).toBe('\\$0.2290\nsome text\n\\$')
    })

    it('单行 $...$ 不受影响', () => {
        expect(normalizeLatexSyntax('行内 $E=mc^2$ 公式')).toBe('行内 $E=mc^2$ 公式')
    })

    it('跨行 $$ 块级公式不受影响', () => {
        expect(normalizeLatexSyntax('$$\nE=mc^2\n$$')).toBe('$$\nE=mc^2\n$$')
    })

    it('同段先有单行公式再有孤立 $：单行公式保留，孤立 $ 无配对不处理', () => {
        const out = normalizeLatexSyntax('前 $x$ 中\n文后 $y')
        expect(out).toContain('$x$')
        // remark-math 从左到右消费 $x$，无配对的 $y 保持字面量，无需转义
        expect(out).toContain('$y')
    })

    it('跨行对与单行公式共存（真实场景）：跨行对转义、公式保留', () => {
        const out = normalizeLatexSyntax('价格 $0.5\n某文本\n$ 与公式 $E=mc^2$')
        expect(out).toContain('\\$0.5\n某文本\n\\$')
        expect(out).toContain('$E=mc^2$')
    })
})
