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
 * 回应批注渲染组件测试（spec .scratch/response-annotations 票 03）：
 * QuoteDirectiveMarker「引用 N」按钮——数据解析 / 越界降级 / 点击定位。
 */

import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import type { UserQuoteBlock } from '@mobi/shared'
import { QUOTE_DIRECTIVE } from '@mobi/shared'
// 显式初始化 i18n（jsdom navigator.language → en）：组件内 useTranslation 依赖全局实例就绪
import i18n from '@/core/config/i18n'
import { QuoteAnnotationsProvider, QuoteDirectiveMarker } from '@/components/ui/QuoteDirectiveComponents'

afterEach(cleanup)

const quotes: UserQuoteBlock[] = [
    { type: 'quote', messageId: 'm1', role: 'agent', excerpt: '被引用的内容', comment: '为什么要这样？' },
    { type: 'quote', messageId: 'm2', role: 'user', excerpt: '用户自己的话' },
]

const d = (n: number) => `${QUOTE_DIRECTIVE}{index="${n}"}`

function renderMarker(index: number, ctxQuotes?: readonly UserQuoteBlock[], onLocate?: (id: string) => void) {
    return render(
        <QuoteAnnotationsProvider quotes={ctxQuotes} onLocate={onLocate ?? (() => {})}>
            <QuoteDirectiveMarker data-index={String(index)}>{d(index)}</QuoteDirectiveMarker>
        </QuoteAnnotationsProvider>,
    )
}

describe('QuoteDirectiveMarker', () => {
    it('有批注数据：渲染「引用 N」按钮（i18n），点击回调定位对应 quote 的 messageId', () => {
        const onLocate = vi.fn()
        renderMarker(1, quotes, onLocate)

        const btn = screen.getByTestId('quote-annotation-1')
        expect(btn).toHaveTextContent(i18n.t('chat.annotationMarker', { count: 1 }))
        fireEvent.click(btn)
        expect(onLocate).toHaveBeenCalledWith('m1')
    })

    it('index 越界 / 无批注数据：诚实降级为 directive 原文', () => {
        renderMarker(9, quotes)
        expect(screen.queryByTestId('quote-annotation-9')).not.toBeInTheDocument()
        expect(screen.getByText(d(9))).toBeInTheDocument()

        const { container } = render(
            <QuoteDirectiveMarker data-index="1">{d(1)}</QuoteDirectiveMarker>,
        )
        expect(container.querySelector('[data-testid="quote-annotation-1"]')).toBeNull()
    })
})
