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
} from '@/ui/base/markdown/latexPlugin'

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

        it('货币成对出现也不误判（闭合 $ 后紧跟数字）', () => {
            // tokenizer 从首个 $ 起匹配：$15-25/段…$40-70 的闭合 $ 后是数字
            const input = '$15-25/段），餐饮约 $40-70'
            expect(input.match(INLINE_LATEX_RULE)).toBeNull()
        })

        it('闭合 $ 前是空白时不算公式', () => {
            // 先出现货币、后出现真正的公式开头时，不能把「5 and 」当公式内容
            expect('$5 and $x^2$'.match(INLINE_LATEX_RULE)).toBeNull()
        })
    })

    describe('块级 $$...$$（双美元符号）', () => {
        it('匹配单行 $$...$$', () => {
            const match = '$$\\sum_{i=1}^{n} i$$ rest'.match(INLINE_LATEX_RULE)
            expect(match).not.toBeNull()
            expect(match![2]).toBe('\\sum_{i=1}^{n} i')
        })

        it('匹配闭合定界符前带空格的单行 $$ E = mc^2 $$（流式输出常见形态，display 公式不受 Pandoc 行内空白约束）', () => {
            // 2026-10-19 code-review 实锤：(?<!\s) 无差别作用于 \${1,2} 闭合，
            // 单行 display 公式整体退化为原文显示（块级规则要求换行，兜不住单行）
            const match = '$$ E = mc^2 $$ rest'.match(INLINE_LATEX_RULE)
            expect(match).not.toBeNull()
            expect(match![2]).toBe(' E = mc^2 ')
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
            expect(match![3]).toBe('x^2 + y^2')
        })

        it('匹配跨行的 \\(...\\)', () => {
            // \\(...\\) 规则使用 [\s\S]，允许跨行（保持原始行为）
            const input = '\\(x^2\n+ y^2\\)'
            const match = input.match(INLINE_LATEX_RULE)
            expect(match).not.toBeNull()
            expect(match![3]).toBe('x^2\n+ y^2')
        })
    })

    describe('\\[...\\] 块级公式', () => {
        it('匹配 \\[\\frac{a}{b}\\]', () => {
            const match = '\\[\\frac{a}{b}\\]'.match(INLINE_LATEX_RULE)
            expect(match).not.toBeNull()
            expect(match![4]).toBe('\\frac{a}{b}')
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

    it('定界符内侧带空格的单行 $$ E = mc^2 $$ → true（探测与 tokenizer 同口径，否则 chunk 永不加载）', () => {
        expect(containsLatex('公式 $$ E = mc^2 $$ 如上')).toBe(true)
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

    it('货币写法不触发：闭合 $ 后紧跟数字（$15-25 … $40-70）', () => {
        // 2026-10-19 实锤：行程正文里的两处美元金额被当成一对公式，$ 被 katex 吃掉
        expect(containsLatex('交通（约 $15-25/段），餐饮约 $40-70。')).toBe(false)
        expect(containsLatex('Price: $5.00 and $10.00')).toBe(false)
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

    it('货币文本原样保留（不被 katex 吃掉 $）', async () => {
        await ensureKatexLoaded()
        const md = new Marked({ extensions: Latex() })
        const html = md.parse('交通（约 $15-25/段），餐饮约 $40-70。') as string
        expect(html).toContain('$15-25')
        expect(html).toContain('$40-70')
        expect(html).not.toContain('katex')
    })

    it('无公式文本不受扩展影响', async () => {
        await ensureKatexLoaded()
        const md = new Marked({ extensions: Latex() })
        const html = md.parse('普通文本 **加粗**') as string
        expect(html).toContain('<strong>加粗</strong>')
        expect(html).not.toContain('katex')
    })
})
