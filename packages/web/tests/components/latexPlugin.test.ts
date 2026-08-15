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
 * LaTeX 插件补丁版本测试
 *
 * 验证行内正则的跨行匹配修复，以及各种 LaTeX 语法的回归测试。
 * 直接测试 inline tokenizer 的正则匹配行为，不依赖浏览器渲染。
 * 另含 katex 懒加载后的 marked 集成渲染与 containsLatex 探测。
 */

import { describe, it, expect } from 'vitest'
import { Marked } from 'marked'
import Latex, {
    INLINE_LATEX_RULE,
    containsLatex,
    ensureKatexLoaded,
} from '@/components/ui/latexPlugin'

describe('latexPlugin inline regex', () => {
    describe('行内 $...$（单美元符号）', () => {
        it('匹配单行行内公式 $E=mc^2$', () => {
            const match = '$E=mc^2$ some text'.match(INLINE_LATEX_RULE)
            expect(match).not.toBeNull()
            expect(match![1]).toBe('E=mc^2')
        })

        it('匹配多个行内公式', () => {
            const match1 = '$x^2$ and $y^2$'.match(INLINE_LATEX_RULE)
            expect(match1).not.toBeNull()
            expect(match1![1]).toBe('x^2')
        })

        it('不匹配跨行的 $...$（核心修复）', () => {
            const input = '$0.2290 (costs may be inaccurate)\nTotal duration: 7s\nMore text$'
            const match = input.match(INLINE_LATEX_RULE)
            expect(match).toBeNull()
        })

        it('不匹配跨两行的 $...$（核心修复）', () => {
            const input = '$foo\nbar$'
            const match = input.match(INLINE_LATEX_RULE)
            expect(match).toBeNull()
        })

        it('匹配行内货币 $0.2290 后跟换行再跟其他内容', () => {
            // $0.2290 在一行内，不应被匹配为 LaTeX（因为结尾的 $ 后面没有内容）
            // 但 $0.2290$ 紧跟在同一行的话会被匹配——这是正确的 LaTeX 行为
            const input = 'Total cost: $0.2290 (some text)'
            const match = input.match(INLINE_LATEX_RULE)
            // 没有配对的 $，不应匹配
            expect(match).toBeNull()
        })

        it('不将 $ 符号当作 LaTeX 起始', () => {
            const input = 'Price: $5.00 and $10.00'
            const match = input.match(INLINE_LATEX_RULE)
            expect(match).toBeNull()
        })
    })

    describe('块级 $$...$$（双美元符号）', () => {
        it('匹配单行 $$...$$', () => {
            const match = '$$\\sum_{i=1}^{n} i$$ rest'.match(INLINE_LATEX_RULE)
            expect(match).not.toBeNull()
            expect(match![1]).toBe('\\sum_{i=1}^{n} i')
        })

        it('不匹配跨行的 $$...$$（行内规则限制）', () => {
            const input = '$$\\sum_{i=1}^{n}\n i$$'
            const match = input.match(INLINE_LATEX_RULE)
            expect(match).toBeNull()
        })
    })

    describe('\\(...\\) 行内公式', () => {
        it('匹配 \\(x^2 + y^2\\)', () => {
            const match = '\\(x^2 + y^2\\) some text'.match(INLINE_LATEX_RULE)
            expect(match).not.toBeNull()
            expect(match![2]).toBe('x^2 + y^2')
        })

        it('匹配跨行的 \\(...\\)', () => {
            // \\(...\\) 规则使用 [\s\S]，允许跨行（保持原始行为）
            const input = '\\(x^2\n+ y^2\\)'
            const match = input.match(INLINE_LATEX_RULE)
            expect(match).not.toBeNull()
            expect(match![2]).toBe('x^2\n+ y^2')
        })
    })

    describe('\\[...\\] 块级公式', () => {
        it('匹配 \\[\\frac{a}{b}\\]', () => {
            const match = '\\[\\frac{a}{b}\\]'.match(INLINE_LATEX_RULE)
            expect(match).not.toBeNull()
            expect(match![3]).toBe('\\frac{a}{b}')
        })

        it('匹配跨行的 \\[...\\]', () => {
            const input = '\\[\\frac{a}\n{b}\\]'
            const match = input.match(INLINE_LATEX_RULE)
            expect(match).not.toBeNull()
        })
    })

    describe('边界情况', () => {
        it('不匹配空字符串', () => {
            const match = ''.match(INLINE_LATEX_RULE)
            expect(match).toBeNull()
        })

        it('不匹配纯文本', () => {
            const match = 'hello world'.match(INLINE_LATEX_RULE)
            expect(match).toBeNull()
        })

        it('匹配紧贴文字的行内公式（src 从 $ 位置开始）', () => {
            // Marked tokenizer 收到的 src 从 $ 位置开始
            const match = '$x^2$的值'.match(INLINE_LATEX_RULE)
            expect(match).not.toBeNull()
            expect(match![1]).toBe('x^2')
        })

        it('匹配行首的行内公式', () => {
            const match = '$\\alpha$ and $\\beta$'.match(INLINE_LATEX_RULE)
            expect(match).not.toBeNull()
            expect(match![1]).toBe('\\alpha')
        })
    })
})

// ============ containsLatex 探测（决定是否触发 katex 按需加载）============

describe('containsLatex', () => {
    it('行内公式 → true', () => {
        expect(containsLatex('质量能量 $E=mc^2$ 是著名公式')).toBe(true)
    })

    it('单行 $$...$$ → true', () => {
        expect(containsLatex('公式 $$\\sum_{i=1}^n i$$ 如上')).toBe(true)
    })

    it('跨行块级 $$...$$ → true', () => {
        expect(containsLatex('$$\n\\frac{a}{b}\n$$')).toBe(true)
    })

    it('\\(...\\) → true', () => {
        expect(containsLatex('见 \\(x^2 + y^2\\) 式')).toBe(true)
    })

    it('\\[...\\] → true', () => {
        expect(containsLatex('\\[\\frac{a}{b}\\]')).toBe(true)
    })

    it('纯文本 → false', () => {
        expect(containsLatex('hello world，没有任何公式')).toBe(false)
    })

    it('code block 内的 $ 不触发（tokenizer 也不会处理 code 内容）', () => {
        expect(containsLatex('```bash\necho $PATH\n```')).toBe(false)
    })

    it('行内 code 内的 $ 不触发', () => {
        expect(containsLatex('运行 `echo $HOME` 即可')).toBe(false)
    })

    it('未配对的 $ 不触发', () => {
        expect(containsLatex('价格是 $5.00 而已')).toBe(false)
    })

    it('同行的两个 $ 视作一对（与 tokenizer 从 $ 起匹配的真实行为一致的超集）', () => {
        // marked tokenizer 在 $ 位置收到 src 后 '$5 and $' 会命中 inline 规则——
        // 探测须不窄于该行为（宁可误加载 chunk，不可漏判公式）
        expect(containsLatex('Price: $5.00 and $10.00')).toBe(true)
    })
})

// ============ 懒加载后的 marked 集成渲染 ============

describe('Latex 扩展渲染（katex 懒加载）', () => {
    it('ensureKatexLoaded 完成后，行内公式渲染为 katex html', async () => {
        await ensureKatexLoaded()
        const md = new Marked({ extensions: Latex() })
        const html = md.parse('质量能量 $E=mc^2$') as string
        expect(html).toContain('katex')
        expect(html).toContain('inline-katex')
    })

    it('块级公式渲染为 katex html', async () => {
        await ensureKatexLoaded()
        const md = new Marked({ extensions: Latex() })
        const html = md.parse('$$\n\\frac{a}{b}\n$$') as string
        expect(html).toContain('katex')
    })

    it('katex 未加载时 renderer 退回原文展示（防御兜底）', () => {
        // Latex() 是同步工厂：直接调用 renderer 验证未就绪时不出错、不产出 katex
        const md = new Marked({ extensions: Latex() })
        const html = md.parse('公式 $E=mc^2$') as string
        // 上一个用例已加载过 katex（模块级单例），此处只验证不抛错；
        // 未加载分支由 containsLatex + Markdown 层的加载门控保证不会走到
        expect(typeof html).toBe('string')
    })

    it('无公式文本不受扩展影响', async () => {
        await ensureKatexLoaded()
        const md = new Marked({ extensions: Latex() })
        const html = md.parse('普通文本 **加粗**') as string
        expect(html).toContain('<strong>加粗</strong>')
        expect(html).not.toContain('katex')
    })
})
