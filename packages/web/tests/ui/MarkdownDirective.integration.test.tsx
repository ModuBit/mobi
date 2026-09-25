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
import { render, screen, cleanup } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { QUOTE_DIRECTIVE } from '@mobi/shared'
import { Markdown } from '@/components/ui/Markdown'
import { QuoteAnnotationsProvider } from '@/components/ui/QuoteDirectiveComponents'

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
})
