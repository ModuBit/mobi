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
 * 折叠组长面板末尾的「收起」出口：条目数超过阈值才出现，点击即折叠该组。
 *
 * Think 与 ToolCallRenderer 走桩件——断言的是本组件持有的 expanded 契约与按钮出现条件，
 * 不牵连 antdx 折叠动效与工具卡渲染。
 */

import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import type { ReactNode } from 'react'
import type { ToolCallBlock } from '@/domain/chat'
import type { ChatBlockContext } from '@/features/chat/blocks/index'

vi.mock('react-i18next', async (orig) => {
    const actual = await orig<typeof import('react-i18next')>()
    return { ...actual, useTranslation: () => ({ t: (k: string) => k }) }
})

vi.mock('@ant-design/x', () => ({
    Think: ({ expanded, onExpand, title, children }: {
        expanded: boolean
        onExpand: (next: boolean) => void
        title: ReactNode
        children: ReactNode
    }) => (
        <div>
            <div data-testid="group-header" onClick={() => onExpand(!expanded)}>{title}</div>
            {expanded ? <div data-testid="group-content">{children}</div> : null}
        </div>
    ),
}))

vi.mock('@/features/chat/blocks/toolCallBlock', () => ({
    TOOL_THINK_CONTENT_STYLES: {},
    ToolCallRenderer: ({ block }: { block: ToolCallBlock }) => <div data-testid="tool-item">{block.id}</div>,
}))

import { ToolCallGroupRenderer, COLLAPSE_FOOTER_MIN_ITEMS } from '@/features/chat/blocks/toolCallGroupBlock'

afterEach(cleanup)

function makeToolCall(id: string): ToolCallBlock {
    return {
        kind: 'tool-call',
        id,
        localId: null,
        createdAt: 1000,
        tool: {
            id,
            name: 'Bash',
            state: 'completed',
            input: {},
            createdAt: 1000,
            startedAt: null,
            completedAt: null,
            description: null,
        },
        children: [],
    }
}

function renderGroup(count: number): void {
    const blocks = Array.from({ length: count }, (_, i) => makeToolCall(`tc-${i}`))
    render(<ToolCallGroupRenderer blocks={blocks} {...({} as ChatBlockContext)} />)
    fireEvent.click(screen.getByTestId('group-header'))
}

const collapseButton = () => screen.queryByRole('button', { name: 'chat.group.collapse' })

describe('折叠组的末尾收起出口', () => {
    it('阈值内条目不出现（组头就在视野里）', () => {
        renderGroup(COLLAPSE_FOOTER_MIN_ITEMS)
        expect(screen.getAllByTestId('tool-item')).toHaveLength(COLLAPSE_FOOTER_MIN_ITEMS)
        expect(collapseButton()).toBeNull()
    })

    it('超过阈值出现', () => {
        renderGroup(COLLAPSE_FOOTER_MIN_ITEMS + 1)
        expect(collapseButton()).not.toBeNull()
    })

    it('点击即折叠该组（展开态交回未展开）', () => {
        renderGroup(COLLAPSE_FOOTER_MIN_ITEMS + 1)
        fireEvent.click(collapseButton()!)
        expect(screen.queryByTestId('group-content')).toBeNull()
    })
})
