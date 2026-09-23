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
 * UserBubbleHeader 组件测试：附件层收起形态——引用 chip 展开列表卡、条目点击定位；
 * 纯 text blocks 不渲染（header 槽零改动）。
 */

import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { UserBubbleHeader } from '@/components/chat/userBlocks/UserBubbleHeader'
import type { UserContentBlock } from '@mobi/shared'

afterEach(cleanup)

const blocks: UserContentBlock[] = [
    { type: 'text', text: '正文' },
    { type: 'quote', messageId: 'm1', role: 'agent', excerpt: '被引用的内容', comment: '为什么要这样？' },
]

describe('UserBubbleHeader', () => {
    it('纯 text blocks 不渲染（header 槽零改动）', () => {
        const { container } = render(<UserBubbleHeader blocks={[{ type: 'text', text: '正文' }]} env={{}} />)
        expect(container).toBeEmptyDOMElement()
    })

    it('引用收起为 chip；点击展开列表卡（编号 + excerpt + 评论），条目点击回调定位', () => {
        const onQuoteLocate = vi.fn()
        render(<UserBubbleHeader blocks={blocks} env={{ onQuoteLocate }} />)

        fireEvent.click(screen.getByTestId('user-quote-chip'))
        const list = screen.getByTestId('user-quote-list')
        expect(list).toBeInTheDocument()
        expect(screen.getByTestId('user-quote-item-0')).toHaveTextContent('1.')
        expect(screen.getByTestId('user-quote-item-0')).toHaveTextContent('被引用的内容')
        expect(screen.getByTestId('user-quote-item-0')).toHaveTextContent('为什么要这样？')

        fireEvent.click(screen.getByTestId('user-quote-item-0'))
        expect(onQuoteLocate).toHaveBeenCalledWith('m1')
    })

    it('onQuoteLocate 缺省时条目纯展示（无定位入口语义）', () => {
        render(<UserBubbleHeader blocks={blocks} env={{}} />)
        fireEvent.click(screen.getByTestId('user-quote-chip'))
        expect(screen.getByTestId('user-quote-item-0')).toBeInTheDocument()
    })
})
