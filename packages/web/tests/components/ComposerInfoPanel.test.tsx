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

import { describe, it, expect, vi, beforeAll } from 'vitest'
import { render } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { ConfigProvider } from 'antd'
import { ComposerInfoPanel } from '@/components/composer/ComposerInfoPanel'
import type { AgentState, SessionMetadataSummary } from '@/core/data/api/types'
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

// mock MobiApi
const mockApi = {
    respondPermission: vi.fn(),
} as unknown as MobiApi

const mockMetadata = { flavor: 'claude-code' } as unknown as SessionMetadataSummary

// jsdom 没有 ResizeObserver
beforeAll(() => {
    vi.stubGlobal('ResizeObserver', class {
        observe() {}
        unobserve() {}
        disconnect() {}
    })
})

const wrapper = ({ children }: { children: React.ReactNode }) => (
    <ConfigProvider>{children}</ConfigProvider>
)

const defaultProps = {
    sessionId: 'test-session',
    agentState: null as AgentState | null,
    metadata: mockMetadata,
    api: mockApi,
    disabled: false,
    onPermissionDone: vi.fn(),
}

describe('ComposerInfoPanel', () => {
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

    it('溢出容器设置了 maxHeight', () => {
        const todos = Array.from({ length: 10 }, (_, i) => ({
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
        expect(scrollEl.style.maxHeight).toBe('40vh')
    })
})
