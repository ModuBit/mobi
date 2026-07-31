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
 * ToolCallRenderer 审批中（pending）渲染测试
 * 验证：审批请求出现时，chat 区也渲染工具卡片（不因 hasPermission return null 而隐藏）
 */

import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import type { ChatBlock } from '@/domain/chat'

// mock antd X 的 Think（jsdom 下太重），返回简单容器
vi.mock('@ant-design/x', () => ({
    Think: ({ children, title }: { children?: React.ReactNode; title?: React.ReactNode }) => (
        <div data-testid="tool-call-think">
            <div data-testid="tool-call-title">{title}</div>
            {children}
        </div>
    ),
}))

// mock 工具图标（部分 mock：保留真实导出，只替换图标节点）
vi.mock('@/components/tool-card/toolIcons', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@/components/tool-card/toolIcons')>()
    return {
        ...actual,
        getToolIcon: () => <span data-testid="tool-icon" />,
        StatusStateIcon: ({ state }: { state: string }) => <span data-testid="status-icon" data-state={state} />,
    }
})

// mock ToolDetailDrawer（无需在审批场景验证）
vi.mock('@/components/tool-card/ToolDetailDrawer', () => ({
    ToolDetailDrawer: () => null,
}))

// mock OverflowContainer / FilePathText 为简单 div
vi.mock('@/components/ui/OverflowContainer', () => ({
    OverflowContainer: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
}))
vi.mock('@/components/ui/FilePathText', () => ({
    FilePathText: ({ path }: { path: string }) => <span>{path}</span>,
}))

import { ToolCallRenderer } from '@/components/chat/blocks/ToolCallBlock'

function makeWriteBlock(overrides: Partial<{ state: ChatBlock extends { kind: 'tool-call' } ? import('@/domain/chat').ChatToolCall['state'] : never }> = {}): Extract<ChatBlock, { kind: 'tool-call' }> {
    return {
        kind: 'tool-call',
        id: 'tool-write',
        localId: 'local-1',
        createdAt: 1000,
        tool: {
            id: 'tool-write',
            name: 'Write',
            input: { file_path: '/demo/hello.txt', content: 'hello' },
            state: 'pending',
            createdAt: 1000,
            startedAt: null,
            completedAt: null,
            description: null,
            permission: { id: 'tool-write', status: 'pending' },
        },
        children: [],
    } as Extract<ChatBlock, { kind: 'tool-call' }>
}

describe('ToolCallRenderer 审批中（pending）渲染', () => {
    beforeEach(() => {
        vi.clearAllMocks()
    })
    afterEach(cleanup)

    it('pending 权限时渲染工具卡片（标题 + 输入预览），不因 hasPermission 隐藏', () => {
        const block = makeWriteBlock()

        render(
            <ToolCallRenderer
                block={block}
                metadata={null}
                sessionId="s1"
            />,
        )

        // 卡片本体渲染
        expect(screen.getByTestId('tool-call-think')).toBeInTheDocument()
        // 标题含工具名（Write）与文件路径
        expect(screen.getByTestId('tool-call-title').textContent).toContain('Write')
    })

    it('pending 时不渲染审批操作按钮（Allow/Deny 由 ComposerInfoPanel 承担）', () => {
        const block = makeWriteBlock()

        render(
            <ToolCallRenderer
                block={block}
                metadata={null}
                sessionId="s1"
            />,
        )

        // 审批按钮不应出现在 chat 区卡片里
        expect(screen.queryByText(/Allow/i)).not.toBeInTheDocument()
        expect(screen.queryByText(/Deny/i)).not.toBeInTheDocument()
    })

    it('completed 状态渲染结果（非 pending）', () => {
        const block = makeWriteBlock({ state: 'completed' })
        block.tool.result = 'wrote 1 line'
        block.tool.permission = undefined

        render(
            <ToolCallRenderer
                block={block}
                metadata={null}
                sessionId="s1"
            />,
        )

        expect(screen.getByTestId('tool-call-think')).toBeInTheDocument()
        expect(screen.getByTestId('tool-call-title').textContent).toContain('Write')
    })
})
