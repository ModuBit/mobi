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
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import type { ChatBlock } from '@/domain/chat'

// mock antd X 的 Think（jsdom 下太重）：收起隐藏内容 + 标题点击切换，贴合真实组件
// 语义（CSSMotion visible=expanded）——默认展开/收起的行为锁依赖这个保真度
vi.mock('@ant-design/x', () => ({
    Think: ({ children, title, expanded, onExpand }: {
        children?: React.ReactNode
        title?: React.ReactNode
        expanded?: boolean
        onExpand?: (v: boolean) => void
    }) => (
        <div data-testid="tool-call-think" data-expanded={String(expanded)}>
            <div
                data-testid="tool-call-title"
                onClick={() => onExpand?.(!expanded)}
            >{title}</div>
            {expanded ? <div data-testid="tool-call-content">{children}</div> : null}
        </div>
    ),
}))

// mock 工具图标（部分 mock：保留真实导出，只替换图标节点）
vi.mock('@/ui/base/display/toolIcons', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@/ui/base/display/toolIcons')>()
    return {
        ...actual,
        getToolIcon: () => <span data-testid="tool-icon" />,
        StatusToolIcon: ({ name, state }: { name: string; state: string }) => (
            <span data-testid="status-icon" data-state={state} data-name={name} />
        ),
    }
})

// mock ToolDetailDrawer：open 时渲染标记节点，供 drawer 开合断言
vi.mock('@/features/chat/tool-card/ToolDetailDrawer', () => ({
    ToolDetailDrawer: ({ open }: { open?: boolean }) =>
        open ? <div data-testid="tool-detail-drawer" role="dialog" /> : null,
}))

// mock OverflowContainer / FilePathText 为简单 div
vi.mock('@/ui/base/layout/OverflowContainer', () => ({
    OverflowContainer: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
}))
vi.mock('@/ui/base/display/FilePathText', () => ({
    FilePathText: ({ path }: { path: string }) => <span>{path}</span>,
}))

// 工具行新形态的 FileChip 内部走守卫链（router hooks + api），文件级 mock
vi.mock('@tanstack/react-router', () => ({
    useNavigate: () => vi.fn(),
    useParams: () => ({ sessionId: 's1' }),
}))
vi.mock('@/core/data/api/client', async (orig) => {
    const actual = await orig<typeof import('@/core/data/api/client')>()
    return {
        ...actual,
        useMobiApi: () => ({
            sessions: {
                get: async () => ({ data: { session: { id: 's1', active: true } } }),
                resume: vi.fn(async () => ({ data: { sessionId: 's1' } })),
            },
        }),
    }
})

import { ToolCallRenderer } from '@/features/chat/blocks/toolCallBlock'

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

describe('ToolCallRenderer 工具行新形态（动词 + chip + 统计）', () => {
    beforeEach(() => {
        vi.clearAllMocks()
    })
    afterEach(cleanup)

    function makeEditBlock(): Extract<ChatBlock, { kind: 'tool-call' }> {
        return {
            kind: 'tool-call',
            id: 'tool-edit',
            localId: 'local-2',
            createdAt: 1000,
            tool: {
                id: 'tool-edit',
                name: 'Edit',
                input: { file_path: '/demo/src/a.ts', old_string: 'a\nb', new_string: 'x\ny\nz' },
                state: 'completed',
                createdAt: 1000,
                startedAt: null,
                completedAt: null,
                description: null,
                permission: undefined,
            },
            children: [],
        } as unknown as Extract<ChatBlock, { kind: 'tool-call' }>
    }

    it('Edit 标题渲染动词 + 可点击 chip + diff 统计，替代 Edit(path) 文字形态', () => {
        render(<ToolCallRenderer block={makeEditBlock()} metadata={null} sessionId="s1" />)
        const title = screen.getByTestId('tool-call-title')
        const chip = title.querySelector('a.tool-chip-link')
        expect(chip).not.toBeNull()
        expect(chip).toHaveAttribute('href', expect.stringContaining('mobi://file/open'))
        expect(title.textContent).toContain('Edit')
        expect(title.textContent).toContain('+3')
        expect(title.textContent).toContain('−2')
        // 旧形态文字不再出现
        expect(title.textContent).not.toContain('Edit(/demo/src/a.ts)')
    })

    it('Bash 标题 chip 为纯展示（无链接）', () => {
        const block = {
            kind: 'tool-call',
            id: 'tool-bash',
            localId: 'local-3',
            createdAt: 1000,
            tool: {
                id: 'tool-bash',
                name: 'Bash',
                input: { command: 'bun run test' },
                state: 'completed',
                createdAt: 1000,
                startedAt: null,
                completedAt: null,
                description: null,
                permission: undefined,
            },
            children: [],
        } as unknown as Extract<ChatBlock, { kind: 'tool-call' }>

        render(<ToolCallRenderer block={block} metadata={null} sessionId="s1" />)
        const title = screen.getByTestId('tool-call-title')
        expect(title.textContent).toContain('bun run test')
        expect(title.querySelector('a.tool-chip-link')).toBeNull()
    })
})

describe('ToolCallBlock 后台 Agent drawer（批次 B，spec D5）', () => {
    afterEach(cleanup)

    function makeBgAgentBlock(): Extract<ChatBlock, { kind: 'tool-call' }> {
        return {
            kind: 'tool-call',
            id: 'tool-bg-agent',
            localId: null,
            createdAt: 1000,
            tool: {
                id: 'tool-bg-agent',
                name: 'Agent',
                input: { prompt: 'x', run_in_background: true },
                state: 'running',
                createdAt: 1000,
                startedAt: 1000,
                completedAt: null,
                description: null,
                agentSummary: '后台研究中…',
            },
            children: [],
        } as Extract<ChatBlock, { kind: 'tool-call' }>
    }

    it('isBgAgent（run_in_background input）的 Agent 卡片点击打开 drawer', () => {
        render(
            <ToolCallRenderer
                block={makeBgAgentBlock()}
                metadata={null}
                sessionId="s1"
            />,
        )

        // 初始不打开 drawer；「查看详情」在卡片内容里，先点标题展开（真实 Think 语义）
        expect(screen.queryByTestId('tool-detail-drawer')).not.toBeInTheDocument()
        fireEvent.click(screen.getByTestId('tool-call-title'))
        // 点击「查看详情」入口（stopPropagation 后走 handleViewDetail）
        fireEvent.click(screen.getByTestId('tool-view-detail'))
        expect(screen.getByTestId('tool-detail-drawer')).toBeInTheDocument()
    })

    it('disableDrawer（drawer 内嵌套块）不渲染「查看详情」死链入口（review fix2 C4）', () => {
        render(
            <ToolCallRenderer
                block={makeBgAgentBlock()}
                metadata={null}
                sessionId="s1"
                disableDrawer
            />,
        )

        // 入口隐藏：展开后也不渲染（drawer 内点击本就无响应的死链不再渲染）
        fireEvent.click(screen.getByTestId('tool-call-title'))
        expect(screen.queryByTestId('tool-view-detail')).not.toBeInTheDocument()
        expect(screen.queryByTestId('tool-detail-drawer')).not.toBeInTheDocument()
    })
})

describe('ToolCallRenderer 问答卡（AskUserQuestion）默认展开（2026-10-31 用户决策）', () => {
    afterEach(cleanup)

    function makeAskBlock(): Extract<ChatBlock, { kind: 'tool-call' }> {
        return {
            kind: 'tool-call',
            id: 'tool-ask',
            localId: null,
            createdAt: 1000,
            tool: {
                id: 'tool-ask',
                name: 'AskUserQuestion',
                input: {
                    questions: [
                        { header: '修法确认', question: '根因修正后，按哪个方案修？', multiSelect: false, options: [{ label: '按修正方案修（推荐）', description: null, preview: null }] },
                        { header: '发布', question: '顺带报上游吗？', multiSelect: false, options: [{ label: '报', description: null, preview: null }] },
                    ],
                },
                state: 'completed',
                createdAt: 1000,
                startedAt: 1000,
                completedAt: 2000,
                description: null,
                permission: {
                    id: 'tool-ask',
                    status: 'approved',
                    answers: { '根因修正后，按哪个方案修？': ['按修正方案修（推荐）'] },
                },
                result: '"根因修正后，按哪个方案修？"="按修正方案修（推荐）"',
            },
            children: [],
        } as unknown as Extract<ChatBlock, { kind: 'tool-call' }>
    }

    it('挂载即展开：问题与答案直接可见，无需点击（问答摘要两行形态在 AskUserQuestionView.test 锁）', () => {
        render(<ToolCallRenderer block={makeAskBlock()} metadata={null} sessionId="s1" />)

        const content = screen.getByTestId('tool-call-content')
        expect(content.textContent).toContain('根因修正后，按哪个方案修？')
        expect(content.textContent).toContain('按修正方案修（推荐）')
        // 旧「→ 同行连接」形态不再出现（问题/答案分离的 DOM 结构归视图层测试）
        expect(content.textContent).not.toContain('→')
    })

    it('其他工具默认收起：内容不渲染，点标题后才展开', () => {
        const block = makeWriteBlock({ state: 'completed' })
        block.tool.result = 'wrote 1 line'
        block.tool.permission = undefined

        render(<ToolCallRenderer block={block} metadata={null} sessionId="s1" />)

        expect(screen.queryByTestId('tool-call-content')).not.toBeInTheDocument()
        fireEvent.click(screen.getByTestId('tool-call-title'))
        expect(screen.getByTestId('tool-call-content')).toBeInTheDocument()
    })
})
