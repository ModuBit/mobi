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
 * 内联指令 → 渲染组件全链路（真实 x-markdown 管线，模式同 MarkdownActionLink.integration）：
 * 组件测试（quoteAnnotation.test）mock 不了 marked tokenizer / sanitize / components
 * 映射——directive 渲染回归（如 renderer 输出形态变更）只有管线级测试能抓。
 */

import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { QUOTE_DIRECTIVE } from '@mobi/shared'
import { Markdown } from '@/ui/base/markdown/Markdown'
import { QuoteAnnotationsProvider } from '@/ui/shared/quoteDirectiveComponents'

afterEach(cleanup)

const quotes = [
    { type: 'quote', messageId: 'm1', role: 'agent', excerpt: '被引用的内容', comment: '为什么？' },
] as const

describe('Markdown 内联指令（真实渲染管线）', () => {
    it(':mobi-quote{index="1"} 渲染为「引用 1」标注按钮，无原文残留', async () => {
        render(
            <QuoteAnnotationsProvider quotes={quotes} onLocate={() => {}}>
                <Markdown content={`前文 ${QUOTE_DIRECTIVE}{index="1"} 后文`} />
            </QuoteAnnotationsProvider>,
        )
        const marker = await screen.findByTestId('quote-annotation-1')
        expect(marker).toBeInTheDocument()
        // jsdom navigator.language → en，i18n 文案随 locale（引用 N / Quote N）
        expect(marker.textContent).toMatch(/引用 1|Quote 1/)
        // 正文其余部分正常渲染，directive 原文不残留（「前文 」带尾随空格，逐字断言用全文匹配）
        const body = document.body.textContent ?? ''
        expect(body).toContain('前文')
        expect(body).toContain('后文')
        expect(body).not.toContain(`${QUOTE_DIRECTIVE}{index="1"}`)
    })

    // 协议统一出向（spec .scratch/quote-protocol-unification 票 01）：新 XML 形态
    // `<quote index="N"/>` 与旧 directive 同管线收敛到「引用 N」标注
    it('<quote index="1"/> 自闭合渲染为「引用 1」标注，无原文残留', async () => {
        render(
            <QuoteAnnotationsProvider quotes={quotes} onLocate={() => {}}>
                <Markdown content={'前文 <quote index="1"/> 后文'} />
            </QuoteAnnotationsProvider>,
        )
        const marker = await screen.findByTestId('quote-annotation-1')
        expect(marker).toBeInTheDocument()
        expect(marker.textContent).toMatch(/引用 1|Quote 1/)
        const body = document.body.textContent ?? ''
        expect(body).toContain('前文')
        expect(body).toContain('后文')
        expect(body).not.toContain('<quote')
    })

    it('完整回显形态只取 index：渲染标注且回显内容不重复显示', async () => {
        render(
            <QuoteAnnotationsProvider quotes={quotes} onLocate={() => {}}>
                <Markdown content={'前文 <quote index="1">被回显的内容</quote> 后文'} />
            </QuoteAnnotationsProvider>,
        )
        expect(await screen.findByTestId('quote-annotation-1')).toBeInTheDocument()
        const body = document.body.textContent ?? ''
        expect(body).toContain('前文')
        expect(body).toContain('后文')
        // 完整形态被整体替换为标注：内容与标签都不残留
        expect(body).not.toContain('被回显的内容')
        expect(body).not.toContain('<quote')
    })

    it('降级矩阵：index="0" / 越界 / 无批注上下文按原文诚实降级', async () => {
        const { container: c0 } = render(
            <QuoteAnnotationsProvider quotes={quotes} onLocate={() => {}}>
                <Markdown content={'前文 <quote index="0"/> 后文'} />
            </QuoteAnnotationsProvider>,
        )
        await waitFor(() => expect(c0.textContent).toContain('前文'))
        expect(c0.textContent).toContain('<quote index="0"/>')
        expect(c0.querySelector('[data-testid="quote-annotation-0"]')).toBeNull()

        cleanup()
        // 越界（ctx 只有 1 条引用）
        const { container: c9 } = render(
            <QuoteAnnotationsProvider quotes={quotes} onLocate={() => {}}>
                <Markdown content={'前文 <quote index="9"/> 后文'} />
            </QuoteAnnotationsProvider>,
        )
        await waitFor(() => expect(c9.textContent).toContain('前文'))
        expect(c9.textContent).toContain('<quote index="9"/>')
        expect(c9.querySelector('[data-testid="quote-annotation-9"]')).toBeNull()
    })

    it('旧 directive index 非法（"1.5"）→ 原文诚实降级，不渲染标注（code-review #4：校验单源）', async () => {
        // parseInt 截断会把 1.5 当合法 1 渲染引用钮——旧路径必须与新 XML 路径同走 parseQuoteIndexAttr
        const { container } = render(
            <QuoteAnnotationsProvider quotes={quotes} onLocate={() => {}}>
                <Markdown content={`前文 ${QUOTE_DIRECTIVE}{index="1.5"} 后文`} />
            </QuoteAnnotationsProvider>,
        )
        await waitFor(() => expect(container.textContent).toContain('前文'))
        expect(container.querySelector('[data-testid="quote-annotation-1"]')).toBeNull()
        expect(container.textContent).toContain(`${QUOTE_DIRECTIVE}{index="1.5"}`)
    })
})
