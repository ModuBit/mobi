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
 * QuoteCommentInput 组件测试：评论可选（空 = 无评论引用）、Enter 保存、
 * Shift+Enter 换行不提交、取消不创建。
 */

import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { QuoteCommentInput } from '@/components/chat/QuoteCommentInput'
import type { PendingQuoteRef } from '@/domain/chat/composerSegments'

afterEach(cleanup)

const quote: PendingQuoteRef = { messageId: 'm1', role: 'agent', excerpt: '被选文本' }
const rect = new DOMRect(10, 100, 200, 20)

describe('QuoteCommentInput', () => {
    it('空评论直接保存：回调原 quote（无 comment 字段）', () => {
        const onConfirm = vi.fn()
        render(<QuoteCommentInput quote={quote} rect={rect} onConfirm={onConfirm} onCancel={vi.fn()} />)

        fireEvent.click(screen.getByTestId('quote-comment-save'))
        expect(onConfirm).toHaveBeenCalledWith({ messageId: 'm1', role: 'agent', excerpt: '被选文本' })
    })

    it('输入评论后 Enter 保存：回调带 comment（trim 后）', () => {
        const onConfirm = vi.fn()
        render(<QuoteCommentInput quote={quote} rect={rect} onConfirm={onConfirm} onCancel={vi.fn()} />)

        const input = screen.getByRole('textbox')
        fireEvent.change(input, { target: { value: '  为什么这样？  ' } })
        fireEvent.keyDown(input, { key: 'Enter', shiftKey: false })
        expect(onConfirm).toHaveBeenCalledWith({ ...quote, comment: '为什么这样？' })
    })

    it('Shift+Enter 换行不提交', () => {
        const onConfirm = vi.fn()
        render(<QuoteCommentInput quote={quote} rect={rect} onConfirm={onConfirm} onCancel={vi.fn()} />)

        const input = screen.getByRole('textbox')
        fireEvent.keyDown(input, { key: 'Enter', shiftKey: true })
        expect(onConfirm).not.toHaveBeenCalled()
    })

    it('取消回调（按钮与 Esc）', () => {
        const onCancel = vi.fn()
        render(<QuoteCommentInput quote={quote} rect={rect} onConfirm={vi.fn()} onCancel={onCancel} />)

        fireEvent.click(screen.getByRole('button', { name: 'common.cancel' }))
        expect(onCancel).toHaveBeenCalledTimes(1)

        fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Escape' })
        expect(onCancel).toHaveBeenCalledTimes(2)
    })
})
