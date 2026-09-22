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

import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, cleanup } from '@testing-library/react'
import { TextBlock } from '@/components/chat/blocks/TextBlock'

vi.mock('@/components/ui/Markdown', () => ({
    Markdown: ({ content }: { content: string }) => (
        <div data-testid="markdown">{content}</div>
    ),
}))

afterEach(cleanup)

/**
 * 中断消息判定（渲染为纯文本小字）只应命中「整条消息就是 CC 中断标记」的情形。
 * 2026-09-21 事故：子串正则把正文里**引用**了 "[Request interrupted by user]"
 * 的正常回复整条打成纯文本分支，markdown 完全不渲染。
 */
describe('TextBlock 中断判定', () => {
    it('消息本身就是中断标记 → 纯文本分支', () => {
        const { container } = render(<TextBlock text="[Request interrupted by user]" />)
        expect(container.querySelector('[data-testid="markdown"]')).toBeNull()
    })

    it('消息是中断标记变体（for tool use）→ 纯文本分支', () => {
        const { container } = render(<TextBlock text="[Request interrupted by user for tool use]" />)
        expect(container.querySelector('[data-testid="markdown"]')).toBeNull()
    })

    it('正文引用中断标记（mid-text）→ 走 Markdown 渲染', () => {
        const text = '其尾随 tool_result / [Request interrupted by user]（都是 user 类型）须保留在历史里'
        const { getByTestId } = render(<TextBlock text={text} />)
        expect(getByTestId('markdown').textContent).toContain('tool_result')
    })

    it('正文以文字开头、标记在中间 → 走 Markdown 渲染', () => {
        const text = '根因是一条**前提失效的锚点不变量**：[Request interrupted by user] 被引用了'
        const { getByTestId } = render(<TextBlock text={text} />)
        expect(getByTestId('markdown').textContent).toContain('前提失效的锚点不变量')
    })
})
