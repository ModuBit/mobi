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

import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest'

// Bun jsdom 环境下 navigator.language 未定义，uiStore 初始化需要
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

import { render } from '@testing-library/react'
import { cleanup } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { ConfigProvider } from 'antd'
import { TasksPanel } from '@/components/composer/TasksPanel'
import type { MobiApi } from '@/core/data/api/client'

// mock i18next
vi.mock('react-i18next', () => ({
    initReactI18next: { type: '3rdParty', init: vi.fn() },
    useTranslation: () => ({
        t: (key: string) => {
            const map: Record<string, string> = {
                'chat.runningTasks.panelTitle': 'Running Tasks',
            }
            return map[key] ?? key
        },
    }),
}))

// mock PixelAvatar，jsdom 不支持 canvas
vi.mock('@/components/pixel-avatar/PixelAvatar', () => ({
    PixelAvatar: () => null,
}))

const mockApi = {
    sessions: {
        stopTask: vi.fn(),
    },
} as unknown as MobiApi

const wrapper = ({ children }: { children: React.ReactNode }) => (
    <ConfigProvider>{children}</ConfigProvider>
)

// jsdom 没有 ResizeObserver
beforeAll(() => {
    vi.stubGlobal('ResizeObserver', class {
        observe() {}
        unobserve() {}
        disconnect() {}
    })
})

// vitest 未开 globals，渲染型测试需显式 cleanup
afterEach(() => {
    cleanup()
})

async function loadStores() {
    const { useRunningAgentsStore } = await import('@/core/data/stores/runningAgentsStore')
    const { useBackgroundTasksStore } = await import('@/core/data/stores/backgroundTasksStore')
    return { useRunningAgentsStore, useBackgroundTasksStore }
}

function makeAgentBlock(id: string) {
    return {
        kind: 'tool-call' as const,
        id,
        localId: null,
        createdAt: Date.now(),
        tool: {
            id,
            name: 'Task',
            state: 'running' as const,
            input: { subagent_type: 'Explore', description: '前台研究' },
            createdAt: Date.now(),
            startedAt: Date.now(),
            completedAt: null,
            description: null,
        },
        children: [],
    }
}

function makeBgTask(taskId: string, overrides: Partial<import('@/domain/chat/types').BackgroundTask> = {}) {
    return {
        taskId,
        toolUseId: 'toolu-1',
        toolName: 'Agent',
        description: '后台研究',
        status: 'running' as const,
        isBackground: true,
        startedAt: Date.now(),
        ...overrides,
    }
}

describe('TasksPanel', () => {
    it('无前台 agent 和后台任务时返回 null', async () => {
        const { container } = render(
            <TasksPanel sessionId="test-session" api={mockApi} onAgentClick={() => {}} onClear={async () => {}} />,
            { wrapper }
        )
        expect(container.innerHTML).toBe('')
    })

    it('有前台 agent 时渲染卡片', async () => {
        const { useRunningAgentsStore } = await loadStores()
        useRunningAgentsStore.getState().setAgents('test-session', [{
            block: makeAgentBlock('agent-1'),
            subagentType: 'Explore',
            description: '前台研究',
        }])

        const { container } = render(
            <TasksPanel sessionId="test-session" api={mockApi} onAgentClick={() => {}} onClear={async () => {}} />,
            { wrapper }
        )
        expect(container.innerHTML).not.toBe('')
        expect(container.textContent).toContain('Running Tasks')
        expect(container.textContent).toContain('前台研究')
    })

    it('有后台任务时渲染卡片并显示闪电图标', async () => {
        const { useBackgroundTasksStore } = await loadStores()
        useBackgroundTasksStore.getState().setTasks('test-session', [makeBgTask('bt-1')])

        const { container } = render(
            <TasksPanel sessionId="test-session" api={mockApi} onAgentClick={() => {}} onClear={async () => {}} />,
            { wrapper }
        )
        expect(container.innerHTML).not.toBe('')
        expect(container.textContent).toContain('后台研究')
    })

    it('前台 agent 与后台任务合并渲染在同一面板', async () => {
        const { useRunningAgentsStore, useBackgroundTasksStore } = await loadStores()
        useRunningAgentsStore.getState().setAgents('test-session', [{
            block: makeAgentBlock('agent-1'),
            subagentType: 'Explore',
            description: '前台研究',
        }])
        useBackgroundTasksStore.getState().setTasks('test-session', [makeBgTask('bt-1', { description: '后台研究' })])

        const { container } = render(
            <TasksPanel sessionId="test-session" api={mockApi} onAgentClick={() => {}} onClear={async () => {}} />,
            { wrapper }
        )
        expect(container.textContent).toContain('前台研究')
        expect(container.textContent).toContain('后台研究')
        // 计数徽标显示 2
        expect(container.textContent).toContain('2')
    })

    it('点击前台 agent 触发 onAgentClick', async () => {
        const { useRunningAgentsStore } = await loadStores()
        useRunningAgentsStore.getState().setAgents('test-session', [{
            block: makeAgentBlock('agent-1'),
            subagentType: 'Explore',
            description: '前台研究',
        }])

        const onAgentClick = vi.fn()
        render(
            <TasksPanel sessionId="test-session" api={mockApi} onAgentClick={onAgentClick} onClear={async () => {}} />,
            { wrapper }
        )
        const card = document.querySelector('[data-testid="agent-card-agent-1"]') as HTMLElement
        expect(card).toBeTruthy()
        card.click()
        expect(onAgentClick).toHaveBeenCalled()
    })
})
