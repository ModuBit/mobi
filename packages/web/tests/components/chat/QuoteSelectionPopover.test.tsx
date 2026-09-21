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
 * QuoteSelectionPopover 组件测试：三态渲染（添加 / 超长禁用 / 达上限禁用）
 * 与添加回调。定位是纯样式，不做几何断言。
 */

import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { QuoteSelectionPopover } from '@/components/chat/QuoteSelectionPopover'

afterEach(cleanup)

const rect = new DOMRect(10, 100, 200, 20)
const quote = { messageId: 'm1', role: 'agent' as const, excerpt: '被选文本' }

describe('QuoteSelectionPopover', () => {
    it('add 态：渲染添加按钮，点击回调 quote 并关闭', () => {
        const onAdd = vi.fn()
        const onClose = vi.fn()
        render(<QuoteSelectionPopover state={{ kind: 'add', quote, rect }} onAdd={onAdd} onClose={onClose} />)

        expect(screen.getByTestId('quote-add-button')).toBeInTheDocument()
        expect(screen.queryByTestId('quote-disabled-hint')).not.toBeInTheDocument()

        fireEvent.click(screen.getByTestId('quote-add-button'))
        expect(onAdd).toHaveBeenCalledWith(quote)
        expect(onClose).toHaveBeenCalledTimes(1)
    })

    it('tooLong 态：只渲染禁用提示，无添加按钮', () => {
        render(<QuoteSelectionPopover state={{ kind: 'tooLong', rect }} onAdd={vi.fn()} onClose={vi.fn()} />)
        expect(screen.getByTestId('quote-disabled-hint')).toBeInTheDocument()
        expect(screen.queryByTestId('quote-add-button')).not.toBeInTheDocument()
    })

    it('limitReached 态：只渲染禁用提示，无添加按钮', () => {
        render(<QuoteSelectionPopover state={{ kind: 'limitReached', rect }} onAdd={vi.fn()} onClose={vi.fn()} />)
        expect(screen.getByTestId('quote-disabled-hint')).toBeInTheDocument()
        expect(screen.queryByTestId('quote-add-button')).not.toBeInTheDocument()
    })

    it('禁用态为纯提示条（无动作按钮），点浮层外关闭归调用方——不设独立关闭钮', () => {
        const onClose = vi.fn()
        render(<QuoteSelectionPopover state={{ kind: 'tooLong', rect }} onAdd={vi.fn()} onClose={onClose} />)
        // 提示条不可点击，浮层内没有任何会触发 onClose 的入口
        fireEvent.click(screen.getByTestId('quote-disabled-hint'))
        expect(onClose).not.toHaveBeenCalled()
    })
})
