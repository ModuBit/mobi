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

import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest'

// Bun jsdom 环境下 navigator.language 未定义，uiStore 初始化需要
// 使用 vi.hoisted 确保在任何模块导入之前执行
vi.hoisted(() => {
    try {
        if (!(globalThis as Record<string, unknown>).navigator || !(navigator as Record<string, unknown>).language) {
            Object.defineProperty(navigator, 'language', { value: 'zh-CN', configurable: true })
        }
    } catch {
        Object.defineProperty(globalThis, 'navigator', {
            value: { language: 'zh-CN', languages: ['zh-CN', 'en'] },
            writable: true,
            configurable: true,
        })
    }
})

import { render, fireEvent } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { ConfigProvider } from 'antd'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ComposerInfoPanel } from '@/components/composer/ComposerInfoPanel'
import type { AgentState, SessionMetadataSummary, DecryptedMessage } from '@/core/data/api/types'
import type { MobiApi } from '@/core/data/api/client'
import type { TodoItem } from '@mobi/shared'

// mock i18next
vi.mock('react-i18next', () => ({
    initReactI18next: { type: '3rdParty', init: vi.fn() },
    useTranslation: () => ({
        t: (key: string) => {
            const map: Record<string, string> = {
                'chat.permission.title': '请求执行权限',
                'chat.todo.allCompleted': '全部完成',
                'chat.todo.completed': '已完成',
                'chat.todo.inProgress': '进行中',
            }
            return map[key] ?? key
        },
    }),
}))

// mock PixelAvatar，jsdom 不支持 canvas
vi.mock('@/components/pixel-avatar/PixelAvatar', () => ({
    PixelAvatar: () => null,
}))

// mock useMessages —— ComposerInfoPanel 内部自取排队消息；返回稳定引用避免重渲染循环。
// 支持可选 select 派生：guard 订阅 boolean、QueuedMessagesSection 订阅排队子集。
const messagesMock = vi.hoisted(() => ({ data: [] as DecryptedMessage[] }))
vi.mock('@/core/data/hooks/queries/useMessages', () => ({
    useMessages: (_sid: unknown, select?: (m: DecryptedMessage[]) => unknown) => ({
        data: select ? select(messagesMock.data) : messagesMock.data,
    }),
}))

/** 构造排队中的 user 消息（lifecycle='queued'） */
function queuedMsg(id: string, text: string): DecryptedMessage {
    return {
        id,
        localId: id,
        seq: null,
        role: 'user',
        content: { content: { text } },
        originalText: text,
        lifecycle: 'queued',
        status: 'completed',
        createdAt: 1000,
    } as unknown as DecryptedMessage
}

/** 构造终态被丢弃的 user 消息（lifecycle='cancelled'/'discarded'） */
function discardedMsg(id: string, text: string, lifecycle: 'cancelled' | 'discarded' = 'discarded'): DecryptedMessage {
    return {
        id,
        localId: id,
        seq: null,
        role: 'user',
        content: { content: { text } },
        originalText: text,
        lifecycle,
        lifecycleAt: 2000,
        status: 'completed',
        createdAt: 1000,
    } as unknown as DecryptedMessage
}

// mock MobiApi
const mockApi = {
    respondPermission: vi.fn(),
} as unknown as MobiApi

const mockMetadata = { flavor: 'claude-code' } as unknown as SessionMetadataSummary

// jsdom 没有 ResizeObserver —— 记录 observe 调用以验证「内容后于挂载出现」时仍能挂 observer
const observeSpy = vi.fn()
beforeAll(() => {
    vi.stubGlobal('ResizeObserver', class {
        observe = observeSpy
        unobserve() {}
        disconnect() {}
    })
})

// ComposerInfoPanel 渲染的 permission 卡片内含 PermissionFooter（用 useQueryClient 失效 session 缓存），
// 需 QueryClientProvider 包裹
const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })

const wrapper = ({ children }: { children: React.ReactNode }) => (
    <ConfigProvider>
        <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </ConfigProvider>
)

const defaultProps = {
    sessionId: 'test-session',
    agentState: null as AgentState | null,
    metadata: mockMetadata,
    api: mockApi,
    disabled: false,
    onPermissionDone: vi.fn(),
    onEditQueued: vi.fn(),
}

describe('ComposerInfoPanel', () => {
    beforeEach(() => {
        // 隔离用例：重置排队消息 mock，避免上一用例残留污染
        messagesMock.data = []
        observeSpy.mockClear()
    })

    it('无 todos 和 requests 时返回 null', () => {
        const { container } = render(
            <ComposerInfoPanel {...defaultProps} />,
            { wrapper }
        )
        expect(container.innerHTML).toBe('')
    })

    it('有 todos 时渲染面板', () => {
        const todos: TodoItem[] = [
            { content: '任务A', status: 'in_progress', activeForm: '正在执行任务A' },
        ]
        const { container } = render(
            <ComposerInfoPanel {...defaultProps} todos={todos} />,
            { wrapper }
        )
        expect(container.innerHTML).not.toBe('')
    })

    it('有 permission requests 时渲染面板', () => {
        const agentState = {
            requests: {
                'req-1': { tool: 'Bash', arguments: { command: 'ls' }, createdAt: null },
            },
        } as unknown as AgentState

        const { container } = render(
            <ComposerInfoPanel {...defaultProps} agentState={agentState} />,
            { wrapper }
        )
        expect(container.innerHTML).not.toBe('')
    })

    it('Bash permission 卡片在标题下显示具体命令 subtitle', () => {
        // sdkHints.displayName 让 titleText 只显示工具名，subtitle 补充具体命令
        const agentState = {
            requests: {
                'req-1': {
                    tool: 'Bash',
                    arguments: { command: 'echo hi > test.txt' },
                    createdAt: null,
                    sdkHints: { displayName: 'Bash' },
                },
            },
        } as unknown as AgentState

        const { container } = render(
            <ComposerInfoPanel {...defaultProps} agentState={agentState} />,
            { wrapper }
        )
        // subtitle 显示具体命令
        expect(container.textContent).toContain('echo hi > test.txt')
    })

    it('无 sdkHints 时 titleText 已含具体内容，subtitle 去重不重复显示', () => {
        const agentState = {
            requests: {
                'req-1': { tool: 'Bash', arguments: { command: 'ls -la' }, createdAt: null },
            },
        } as unknown as AgentState

        const { container } = render(
            <ComposerInfoPanel {...defaultProps} agentState={agentState} />,
            { wrapper }
        )
        // titleText 含 "Bash: ls -la"，subtitle 去重后不重复
        expect(container.textContent).toContain('Bash: ls -la')
        // 不应出现两次
        expect((container.textContent ?? '').match(/Bash: ls -la/g)?.length).toBe(1)
    })

    it('工具交互卡片折叠头点击切换 aria-expanded', () => {
        const agentState = {
            requests: {
                'req-1': { tool: 'Bash', arguments: { command: 'ls' }, createdAt: null },
            },
        } as unknown as AgentState

        const { container } = render(
            <ComposerInfoPanel {...defaultProps} agentState={agentState} />,
            { wrapper }
        )
        const toggle = container.querySelector('[data-testid="tool-request-toggle-req-1"]') as HTMLElement
        expect(toggle).toBeTruthy()
        expect(toggle.getAttribute('aria-expanded')).toBe('true')
        fireEvent.click(toggle)
        expect(toggle.getAttribute('aria-expanded')).toBe('false')
        fireEvent.click(toggle)
        expect(toggle.getAttribute('aria-expanded')).toBe('true')
    })

    it('内容后于挂载出现时仍挂载 ResizeObserver（修复空挂载失效）', () => {
        // 空挂载：无任何内容 → return null，scrollRef div 不渲染、observer 未挂
        const { rerender } = render(<ComposerInfoPanel {...defaultProps} />, { wrapper })
        expect(observeSpy).not.toHaveBeenCalled()
        // 内容后出现：重渲染带 todos → hasContent 翻 true、effect 重跑、observer 挂上
        const todos: TodoItem[] = [
            { content: '任务A', status: 'in_progress', activeForm: '正在执行任务A' },
        ]
        rerender(<ComposerInfoPanel {...defaultProps} todos={todos} />)
        expect(observeSpy).toHaveBeenCalled()
    })

    it('溢出容器设置了 maxHeight', () => {        const todos = Array.from({ length: 10 }, (_, i) => ({
            content: `任务${i}`,
            status: 'pending' as const,
            activeForm: `正在执行任务${i}`,
        }))
        const { container } = render(
            <ComposerInfoPanel {...defaultProps} todos={todos} />,
            { wrapper }
        )
        const scrollEl = container.querySelector('.hide-scrollbar') as HTMLElement
        expect(scrollEl).toBeTruthy()
        expect(scrollEl.style.maxHeight).toBe('40dvh')
    })

    it('有排队消息时渲染排队条并回填编辑', () => {
        const onEditQueued = vi.fn()
        messagesMock.data = [queuedMsg('q-1', '排队的内容预览')]
        const { container, unmount } = render(
            <ComposerInfoPanel {...defaultProps} onEditQueued={onEditQueued} />,
            { wrapper }
        )
        // 排队条展示消息预览文本
        expect(container.textContent).toContain('排队的内容预览')
        // 编辑按钮存在（具体取消/编辑交互由 QueuedMessagesBar 自身测试覆盖）
        expect(container.querySelectorAll('button').length).toBeGreaterThan(0)
        unmount()
    })

    it('queued 空 + discarded 有 + 无其他面板内容 → 面板渲染丢弃分区（hasContent 门禁不吞掉）', () => {
        // turn 死亡常态：无 requests/todos/tasks/agents，唯一可见性来源是丢弃分区
        messagesMock.data = [discardedMsg('d-1', '被丢弃的内容预览')]
        const { container, unmount } = render(
            <ComposerInfoPanel {...defaultProps} />,
            { wrapper }
        )
        // 面板不因 hasQueued=false 卸载
        expect(container.innerHTML).not.toBe('')
        // 丢弃分区标题 + 消息预览可见
        expect(container.textContent).toContain('chat.queued.discardedTitle')
        expect(container.textContent).toContain('被丢弃的内容预览')
        // 丢弃条目无操作按钮
        expect(container.querySelectorAll('button').length).toBe(0)
        unmount()
    })

    it('有 running agents 时渲染面板', async () => {
        const { useRunningAgentsStore } = await import('@/core/data/stores/runningAgentsStore')
        const mockBlock = {
            kind: 'tool-call' as const,
            id: 'agent-1',
            localId: null,
            createdAt: Date.now(),
            tool: {
                id: 'agent-1',
                name: 'Task',
                state: 'running' as const,
                input: { subagent_type: 'Explore', description: '测试' },
                createdAt: Date.now(),
                startedAt: Date.now(),
                completedAt: null,
                description: null,
            },
            children: [],
        }
        useRunningAgentsStore.getState().setAgents('test-session', [{
            block: mockBlock,
            subagentType: 'Explore',
            description: '测试',
        }])

        const { container, unmount } = render(
            <ComposerInfoPanel {...defaultProps} />,
            { wrapper }
        )
        expect(container.innerHTML).not.toBe('')
        unmount()
        useRunningAgentsStore.getState().clearSession('test-session')
    })
})
