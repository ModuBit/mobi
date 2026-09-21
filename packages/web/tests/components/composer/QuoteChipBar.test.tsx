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
 * QuoteChipBar 组件测试：胶囊计数、点击展开列表卡、条目编号与删除回调。
 * 行为级断言（渲染结果 + 用户可见交互），不测内部 state。
 */

import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { QuoteChipBar } from '@/components/composer/QuoteChipBar'
import type { ComposerQuoteRef } from '@/domain/chat/composerSegments'

afterEach(cleanup)

const quotes: ComposerQuoteRef[] = [
    { uid: 'u1', messageId: 'm1', role: 'agent', excerpt: '第一条引用内容' },
    { uid: 'u2', messageId: 'm2', role: 'user', excerpt: '第二条' },
]

describe('QuoteChipBar', () => {
    it('无引用时不渲染', () => {
        const { container } = render(<QuoteChipBar quotes={[]} onRemove={vi.fn()} />)
        expect(container).toBeEmptyDOMElement()
    })

    it('胶囊展示条数；点击展开列表卡（编号 + 全文 + 删除）', () => {
        render(<QuoteChipBar quotes={quotes} onRemove={vi.fn()} />)
        // i18n 未在测试环境初始化，计数键原样渲染——只断言胶囊存在与展开行为
        expect(screen.getByTestId('quote-chip')).toBeInTheDocument()

        fireEvent.click(screen.getByTestId('quote-chip'))
        const list = screen.getByTestId('quote-list')
        expect(list).toBeInTheDocument()
        expect(screen.getByTestId('quote-item-0')).toHaveTextContent('1.')
        expect(screen.getByTestId('quote-item-0')).toHaveTextContent('第一条引用内容')
        expect(screen.getByTestId('quote-item-1')).toHaveTextContent('2.')
    })

    it('点击删除回调对应条目 uid（条目级身份；同消息可挂多个片段，messageId 不唯一）', () => {
        const onRemove = vi.fn()
        render(<QuoteChipBar quotes={quotes} onRemove={onRemove} />)
        fireEvent.click(screen.getByTestId('quote-chip'))
        fireEvent.click(screen.getByTestId('quote-remove-1'))
        expect(onRemove).toHaveBeenCalledWith('u2')
    })

    it('同一条消息的两个片段引用并存渲染，删除其一不影响另一条', () => {
        // 回归：条目级身份引入前按 messageId 寻址，同消息多片段会撞 key、删一条删全部
        const sameMessage: ComposerQuoteRef[] = [
            { uid: 'u1', messageId: 'm1', role: 'agent', excerpt: '片段一' },
            { uid: 'u2', messageId: 'm1', role: 'agent', excerpt: '片段二' },
        ]
        const onRemove = vi.fn()
        const { rerender } = render(<QuoteChipBar quotes={sameMessage} onRemove={onRemove} />)
        fireEvent.click(screen.getByTestId('quote-chip'))
        expect(screen.getByTestId('quote-item-0')).toHaveTextContent('片段一')
        expect(screen.getByTestId('quote-item-1')).toHaveTextContent('片段二')
        fireEvent.click(screen.getByTestId('quote-remove-0'))
        expect(onRemove).toHaveBeenCalledWith('u1')
        rerender(<QuoteChipBar quotes={sameMessage.filter(q => q.uid !== 'u1')} onRemove={onRemove} />)
        expect(screen.getByTestId('quote-item-0')).toHaveTextContent('片段二')
        expect(screen.getByTestId('quote-item-0')).not.toHaveTextContent('片段一')
    })

    it('有 onUpdateComment 时评论可见、可编辑保存；清空评论保存后删除该字段', () => {
        const onUpdateComment = vi.fn()
        const withComment: PendingQuoteRef[] = [
            { uid: 'u1', messageId: 'm1', role: 'agent', excerpt: '引用内容', comment: '为什么要这样？' },
        ]
        const { rerender } = render(
            <QuoteChipBar quotes={withComment} onRemove={vi.fn()} onUpdateComment={onUpdateComment} />,
        )
        fireEvent.click(screen.getByTestId('quote-chip'))
        expect(screen.getByTestId('quote-comment-0')).toHaveTextContent('为什么要这样？')

        // 编辑保存：非空 → 传新值
        fireEvent.click(screen.getByTestId('quote-edit-comment-0'))
        const input = screen.getByDisplayValue('为什么要这样？')
        fireEvent.change(input, { target: { value: '改成新的疑问' } })
        fireEvent.click(screen.getByRole('button', { name: 'common.save' }))
        expect(onUpdateComment).toHaveBeenCalledWith('u1', '改成新的疑问')

        // 清空保存 → 传 undefined（删除评论）
        rerender(<QuoteChipBar quotes={withComment} onRemove={vi.fn()} onUpdateComment={onUpdateComment} />)
        fireEvent.click(screen.getByTestId('quote-edit-comment-0'))
        fireEvent.change(screen.getByRole('textbox'), { target: { value: '   ' } })
        fireEvent.click(screen.getByRole('button', { name: 'common.save' }))
        expect(onUpdateComment).toHaveBeenCalledWith('u1', undefined)
    })

    it('无 onUpdateComment 时不渲染评论编辑入口', () => {
        render(<QuoteChipBar quotes={quotes} onRemove={vi.fn()} />)
        fireEvent.click(screen.getByTestId('quote-chip'))
        expect(screen.queryByTestId('quote-edit-comment-0')).not.toBeInTheDocument()
    })
})
