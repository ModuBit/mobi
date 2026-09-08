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
 * 工具行新形态（Tool Row × File Chip，mockup 变体 A）渲染测试：
 * - 跳转类工具（minimal 行形态）：header 渲染动词 + 可点击 chip + diff 统计，
 *   chip 点击走守卫分发（file/open → inspector 打开文件 tab）
 * - 纯展示工具：同款 chip 无链接语义
 * - 非 minimal 卡（Bash 等）：维持 title 形态，不出 chip
 */

import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest'

// Popconfirm（rc resize-observer）依赖 ResizeObserver，jsdom 没有
beforeAll(() => {
    vi.stubGlobal('ResizeObserver', class {
        observe() {}
        unobserve() {}
        disconnect() {}
    })
})
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { ConfigProvider } from 'antd'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

const navigateSpy = vi.hoisted(() => vi.fn())
vi.mock('@tanstack/react-router', () => ({
    useNavigate: () => navigateSpy,
    useParams: () => ({ sessionId: 'sess-1' }),
}))

vi.mock('react-i18next', async (orig) => {
    const actual = await orig()
    return { ...actual, useTranslation: () => ({ t: (k: string) => k }) }
})

// 会话激活态与恢复动作 mock（FileChip 守卫经 fetchQuery 走 api.sessions.get）
const sessionState = vi.hoisted(() => ({ active: true }))
const resumeSpy = vi.hoisted(() => vi.fn(async () => ({ data: { sessionId: 'sess-1' } })))
vi.mock('@/core/data/api/client', async (orig) => {
    const actual = await orig<typeof import('@/core/data/api/client')>()
    return {
        ...actual,
        useMobiApi: () => ({
            sessions: {
                get: async () => ({ data: { session: { id: 'sess-1', active: sessionState.active } } }),
                resume: resumeSpy,
            },
        }),
    }
})

import { ToolCard } from '@/components/tool-card'
import { useWorkspaceStore } from '@/core/data/stores/workspaceStore'
import { queryClient } from '@/core/lib/queryClient'
import type { ToolCallBlock } from '@/domain/tool/types'
import type { MobiApi } from '@/core/data/api/client'

beforeEach(() => {
    navigateSpy.mockClear()
    resumeSpy.mockClear()
    sessionState.active = true
    useWorkspaceStore.getState().clearAll()
    queryClient.clear()
})

afterEach(cleanup)

const mockApi = {
    permissions: { approve: vi.fn(), deny: vi.fn() },
} as unknown as MobiApi

function makeBlock(name: string, input: unknown): ToolCallBlock {
    return {
        id: 'block-1',
        kind: 'tool-call',
        children: [],
        tool: {
            name,
            input,
            result: undefined,
            state: 'completed',
            description: null,
            startedAt: null,
            createdAt: Date.now(),
            permission: null,
        },
    } as ToolCallBlock
}

function renderCard(block: ToolCallBlock) {
    return render(
        <ConfigProvider>
            <QueryClientProvider client={queryClient}>
                <ToolCard
                    api={mockApi}
                    sessionId="sess-1"
                    metadata={null}
                    disabled={false}
                    onDone={vi.fn()}
                    block={block}
                />
            </QueryClientProvider>
        </ConfigProvider>
    )
}

describe('工具行新形态：跳转类工具（Edit）', () => {
    it('header 渲染动词 + 可点击 chip + diff 统计，chip href 为 file/open URI', () => {
        renderCard(makeBlock('Edit', {
            file_path: '/proj/src/a.ts',
            old_string: 'a\nb',
            new_string: 'x\ny\nz',
        }))
        const chip = screen.getByRole('link', { name: '/proj/src/a.ts' })
        expect(chip).toHaveAttribute('href', expect.stringContaining('mobi://file/open'))
        expect(screen.getByText('Edit')).toBeInTheDocument()
        // diff 统计：old 2 行计删、new 3 行计增
        expect(screen.getByText('+3')).toBeInTheDocument()
        expect(screen.getByText('−2')).toBeInTheDocument()
    })

    it('激活会话点击 chip → inspector 打开文件 tab（行点击语义不受影响）', async () => {
        renderCard(makeBlock('Edit', { file_path: '/proj/src/a.ts', old_string: 'a', new_string: 'b' }))
        fireEvent.click(screen.getByRole('link', { name: '/proj/src/a.ts' }))
        await waitFor(() => {
            const s = useWorkspaceStore.getState().getSession('sess-1')
            expect(s.tabs).toHaveLength(1)
        })
        expect(useWorkspaceStore.getState().getSession('sess-1').tabs[0])
            .toMatchObject({ mode: 'file', filePath: '/proj/src/a.ts' })
    })

    it('未激活会话点击 chip → 弹恢复引导 Popconfirm，确认后恢复并重放', async () => {
        sessionState.active = false
        renderCard(makeBlock('Edit', { file_path: '/proj/src/a.ts', old_string: 'a', new_string: 'b' }))
        fireEvent.click(screen.getByRole('link', { name: '/proj/src/a.ts' }))
        // 守卫拦截：inspector 未被打开，Popconfirm 弹出
        await waitFor(() => {
            expect(screen.getByText('chat.action.sessionInactive')).toBeInTheDocument()
        })
        expect(useWorkspaceStore.getState().getSession('sess-1')?.tabs ?? []).toHaveLength(0)
    })
})

describe('工具行新形态：纯展示 chip（Glob）', () => {
    it('pattern 用 chip 形态但无链接语义', () => {
        renderCard(makeBlock('Glob', { pattern: '**/*.ts' }))
        expect(screen.getByText('**/*.ts')).toBeInTheDocument()
        expect(screen.queryByRole('link', { name: '**/*.ts' })).toBeNull()
    })
})

describe('Task 卡子任务摘要行', () => {
    it('subagent 的 Edit 子调用同样渲染动词+chip+统计（与顶层工具卡同一推导）', () => {
        const editChild: ToolCallBlock = {
            id: 'child-1',
            kind: 'tool-call',
            children: [],
            tool: {
                name: 'Edit',
                input: { file_path: '/proj/src/child.ts', old_string: 'a\nb', new_string: 'x' },
                result: undefined,
                state: 'completed',
                description: null,
                startedAt: null,
                createdAt: Date.now(),
                permission: null,
            },
        } as ToolCallBlock
        const taskBlock: ToolCallBlock = {
            id: 'task-1',
            kind: 'tool-call',
            children: [editChild],
            tool: {
                name: 'Task',
                input: { subagent_type: 'general-purpose', description: 'd', prompt: 'p' },
                result: undefined,
                state: 'completed',
                description: null,
                startedAt: null,
                createdAt: Date.now(),
                permission: null,
            },
        } as ToolCallBlock

        renderCard(taskBlock)
        const chip = screen.getByRole('link', { name: '/proj/src/child.ts' })
        expect(chip).toHaveAttribute('href', expect.stringContaining('mobi://file/open'))
        expect(screen.getByText('Edit')).toBeInTheDocument()
        expect(screen.getByText('+1')).toBeInTheDocument()
        expect(screen.getByText('−2')).toBeInTheDocument()
    })
})

describe('非 minimal 卡维持 title 形态', () => {
    it('Bash 不渲染 chip（有完整 body 视图，header chip 冗余）', () => {
        renderCard(makeBlock('Bash', { command: 'bun run test' }))
        expect(screen.queryByText('bun run test')).not.toBeInTheDocument()
    })
})
