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
 * 选区引用锚点接线测试：renderChatBlock 渲染的 agent-text / user-text 气泡
 * 必须落出判定器契约的 data-quote-* 属性——渲染层与 quoteSelection 判定器的
 * 契约测试（拼写漂移在这里抓出），不重复判定器的决策表。
 */

import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import type { AgentTextBlock, UserTextBlock } from '@/domain/chat'
import { renderChatBlock, type ChatBlockContext } from '@/components/chat/blocks'

vi.mock('@/components/ui/Markdown', () => ({
    Markdown: ({ content }: { content: string }) => <div data-testid="md">{content}</div>,
}))

afterEach(cleanup)

const ctx = {
    metadata: null,
    isThinking: false,
} as unknown as ChatBlockContext

function makeAgentText(overrides: Partial<AgentTextBlock> = {}): AgentTextBlock {
    return {
        kind: 'agent-text',
        id: 'agent-1',
        localId: 'local-1',
        createdAt: 1000,
        text: 'agent 正文',
        isSnapshot: false,
        ...overrides,
    }
}

function makeUserText(overrides: Partial<UserTextBlock> = {}): UserTextBlock {
    return {
        kind: 'user-text',
        id: 'user-1',
        localId: 'local-u1',
        createdAt: 1000,
        blocks: [{ type: 'text', text: '用户正文' }],
        ...overrides,
    }
}

describe('选区引用锚点接线（renderChatBlock）', () => {
    it('agent-text：消息 + block 锚齐备，落库后可引用', () => {
        render(renderChatBlock(makeAgentText(), ctx))
        const anchor = screen.getByTestId('md').parentElement!
        expect(anchor).toHaveAttribute('data-quote-message-id', 'local-1')
        expect(anchor).toHaveAttribute('data-quote-role', 'agent')
        expect(anchor).toHaveAttribute('data-quote-block')
        expect(anchor).not.toHaveAttribute('data-quote-allowed')
    })

    it('agent-text 流式/snapshot 中：落 data-quote-allowed="false"', () => {
        render(renderChatBlock(makeAgentText({ isStreaming: true }), ctx))
        const anchor = screen.getByTestId('md').parentElement!
        expect(anchor).toHaveAttribute('data-quote-allowed', 'false')

        cleanup()
        render(renderChatBlock(makeAgentText({ isSnapshot: true }), ctx))
        expect(screen.getByTestId('md').parentElement!).toHaveAttribute('data-quote-allowed', 'false')
    })

    it('agent-text 未落库（localId null）：无消息锚点（判定器按来源不合格拒绝）', () => {
        render(renderChatBlock(makeAgentText({ localId: null }), ctx))
        expect(screen.getByTestId('md').parentElement).not.toHaveAttribute('data-quote-message-id')
    })

    it('user-text：消息锚在气泡层，text 视图落 block 锚', () => {
        render(renderChatBlock(makeUserText(), ctx))
        const textEl = screen.getByText('用户正文')
        const blockAnchor = textEl.closest('[data-quote-block]')
        expect(blockAnchor).toBeInTheDocument()
        expect(blockAnchor!.closest('[data-quote-message-id]')).toHaveAttribute('data-quote-message-id', 'local-u1')
        expect(blockAnchor!.closest('[data-quote-role]')).toHaveAttribute('data-quote-role', 'user')
    })
})
