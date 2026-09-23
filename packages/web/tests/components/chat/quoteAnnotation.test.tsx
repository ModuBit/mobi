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
 * 回应批注渲染组件测试（spec .scratch/response-annotations 票 03/04）：
 * QuoteDirectiveMarker 注释按钮（数据解析 / 越界降级 / 点击定位）、
 * AgentAnnotationChip 聚合 chip（计数 / 展开 / 条目点击 / 无 directive 零渲染）。
 */

import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import type { UserQuoteBlock } from '@mobi/shared'
import { QUOTE_DIRECTIVE } from '@mobi/shared'
// 显式初始化 i18n（jsdom navigator.language → en）：组件内 useTranslation 依赖全局实例就绪
import i18n from '@/core/config/i18n'
import { QuoteAnnotationsProvider, QuoteDirectiveMarker } from '@/components/ui/QuoteDirectiveComponents'
import { AgentAnnotationChip } from '@/components/chat/blocks/AgentAnnotationChip'

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
    it('有批注数据：渲染「注释 N」按钮（i18n），点击回调定位对应 quote 的 messageId', () => {
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

describe('AgentAnnotationChip', () => {
    it('有 directive + 批注数据：chip 计数去重，展开列表条目点击定位', () => {
        const onLocate = vi.fn()
        // 同 index 重复出现（handoff 失败模式）计数只算一次
        const text = `回应一 ${d(1)} 回应二 ${d(2)} 重复 ${d(1)}`
        render(<AgentAnnotationChip text={text} quotes={quotes} onLocate={onLocate} />)

        const chip = screen.getByTestId('agent-annotation-chip')
        expect(chip).toHaveTextContent(i18n.t('chat.annotationCount', { count: 2 }))

        fireEvent.click(chip)
        const list = screen.getByTestId('agent-annotation-list')
        expect(list).toBeInTheDocument()
        expect(screen.getByTestId('agent-annotation-item-1')).toHaveTextContent('被引用的内容')
        expect(screen.getByTestId('agent-annotation-item-1')).toHaveTextContent('为什么要这样？')
        expect(screen.getByTestId('agent-annotation-item-2')).toHaveTextContent('用户自己的话')

        fireEvent.click(screen.getByTestId('agent-annotation-item-1'))
        expect(onLocate).toHaveBeenCalledWith('m1')
    })

    it('无 directive 或无批注数据：不渲染（header 槽零改动）', () => {
        const { container } = render(<AgentAnnotationChip text="普通回复" quotes={quotes} onLocate={() => {}} />)
        expect(container).toBeEmptyDOMElement()

        const { container: c2 } = render(<AgentAnnotationChip text={`回复 ${d(1)}`} quotes={[]} onLocate={() => {}} />)
        expect(c2).toBeEmptyDOMElement()
    })

    it('伪造索引（越界）不计数', () => {
        render(<AgentAnnotationChip text={`${d(7)}`} quotes={quotes} onLocate={() => {}} />)
        expect(screen.queryByTestId('agent-annotation-chip')).not.toBeInTheDocument()
    })
})
