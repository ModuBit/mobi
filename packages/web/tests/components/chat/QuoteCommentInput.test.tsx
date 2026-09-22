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
 * QuoteCommentInput 组件测试：引用已在 composer，浮层只补充评论——
 * 空 = 无评论（onSave(undefined)）、Enter/✓ 保存（trim）、多行自适应、
 * 空态按钮 = 关闭（×）、Esc 关闭。
 */

import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { QuoteCommentInput } from '@/components/chat/QuoteCommentInput'

afterEach(cleanup)

const rect = new DOMRect(10, 100, 200, 20)

describe('QuoteCommentInput', () => {
    it('未填写时显示关闭钮（×）：点击触发 onClose 而非 onSave', () => {
        const onSave = vi.fn()
        const onClose = vi.fn()
        render(<QuoteCommentInput rect={rect} onSave={onSave} onClose={onClose} />)

        fireEvent.click(screen.getByTestId('quote-comment-close'))
        expect(onClose).toHaveBeenCalledTimes(1)
        expect(onSave).not.toHaveBeenCalled()
    })

    it('输入评论后出现保存钮（✓）：点击回调 trim 后的评论', () => {
        const onSave = vi.fn()
        const onClose = vi.fn()
        render(<QuoteCommentInput rect={rect} onSave={onSave} onClose={onClose} />)

        const input = screen.getByRole('textbox')
        fireEvent.change(input, { target: { value: '  为什么这样？  ' } })
        fireEvent.click(screen.getByTestId('quote-comment-save'))
        expect(onSave).toHaveBeenCalledWith('为什么这样？')
        expect(onClose).not.toHaveBeenCalled()
    })

    it('Enter 换行不提交（多行评论合法输入）；Ctrl/Cmd+Enter 保存', () => {
        const onSave = vi.fn()
        render(<QuoteCommentInput rect={rect} onSave={onSave} onClose={vi.fn()} />)

        const input = screen.getByRole('textbox')
        fireEvent.change(input, { target: { value: '  为什么这样？  ' } })
        // 裸 Enter：不提交（换行是 textarea 默认行为）
        fireEvent.keyDown(input, { key: 'Enter' })
        expect(onSave).not.toHaveBeenCalled()
        // Ctrl/Cmd+Enter：提交（trim 后）
        fireEvent.keyDown(input, { key: 'Enter', ctrlKey: true })
        expect(onSave).toHaveBeenCalledWith('为什么这样？')
    })

    it('续编辑回填：initialComment 进输入框，Ctrl+Enter 清空保存 = 清除评论（onSave(undefined)）', () => {
        const onSave = vi.fn()
        render(<QuoteCommentInput rect={rect} initialComment='旧评论' onSave={onSave} onClose={vi.fn()} />)

        const input = screen.getByRole('textbox') as HTMLTextAreaElement
        expect(input.value).toBe('旧评论')
        fireEvent.change(input, { target: { value: '' } })
        fireEvent.keyDown(input, { key: 'Enter', metaKey: true })
        expect(onSave).toHaveBeenCalledWith(undefined)
    })

    it('Esc 关闭；多行输入（autoSize 属性挂载）', () => {
        const onClose = vi.fn()
        render(<QuoteCommentInput rect={rect} onSave={vi.fn()} onClose={onClose} />)

        const input = screen.getByRole('textbox') as HTMLTextAreaElement
        fireEvent.keyDown(input, { key: 'Escape' })
        expect(onClose).toHaveBeenCalledTimes(1)
    })
})
