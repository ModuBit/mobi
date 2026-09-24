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
 * ComposerInfoPanel 订阅收窄测试
 * 锁定约定：流式期 chatBlocksById 索引整表重建不得触发面板重渲染
 * （docs/research-claude-ai-perf.md §2.3 / docs/conventions/performance.md）
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

import { Profiler } from 'react'
import { render, cleanup, act, fireEvent } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { ConfigProvider } from 'antd'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ComposerInfoPanel } from '@/components/composer/ComposerInfoPanel'
import type { MobiApi } from '@/core/data/api/client'
import type { ForegroundTaskItem } from '@mobi/shared/types'

// mock i18next
vi.mock('react-i18next', () => ({
    initReactI18next: { type: '3rdParty', init: vi.fn() },
    useTranslation: () => ({
        t: (key: string) => key,
    }),
}))

// mock PixelAvatar，jsdom 不支持 canvas
vi.mock('@/components/pixel-avatar/PixelAvatar', () => ({
    PixelAvatar: () => null,
}))

// useMobiApi 返回 null 阻断 useMessages 的 fetchLatest 副作用（面板 props 自带 api）
vi.mock('@/core/data/hooks/queries/useMobiApi', () => ({
    useMobiApi: () => null,
}))

const mockApi = {} as unknown as MobiApi

const queryClient = new QueryClient()

const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>
        <ConfigProvider>{children}</ConfigProvider>
    </QueryClientProvider>
)

// jsdom 没有 Element.scrollTo（ResizeObserver 由 tests/setup.ts 全局桩提供）
beforeAll(() => {
    if (!Element.prototype.scrollTo) {
        Element.prototype.scrollTo = () => {}
    }
})

// vitest 未开 globals，渲染型测试需显式 cleanup
afterEach(() => {
    cleanup()
})

async function loadStores() {
    const { useForegroundTasksStore } = await import('@/core/data/stores/foregroundTasksStore')
    const { useChatBlocksByIdStore } = await import('@/core/data/stores/chatBlocksByIdStore')
    const { _resetForTest } = await import('@/core/data/stores/messageWindowStore')
    return { useForegroundTasksStore, useChatBlocksByIdStore, _resetForTest }
}

function makeFgTask(toolUseId: string): ForegroundTaskItem {
    return { toolUseId, description: '前台研究', subagentType: 'Explore', startedAt: Date.now() }
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

const PROPS = {
    sessionId: 'perf-session',
    agentState: null,
    metadata: null,
    api: mockApi,
    disabled: false,
    onRequestDone: () => {},
} satisfies Parameters<typeof ComposerInfoPanel>[0]

describe('ComposerInfoPanel 订阅收窄', () => {
    afterEach(async () => {
        // zustand store 与 messageWindow 均为模块级单例，跨用例清场防串染
        const { useForegroundTasksStore, useChatBlocksByIdStore, _resetForTest } = await loadStores()
        useForegroundTasksStore.getState().clearSession('perf-session')
        useChatBlocksByIdStore.getState().clearSession('perf-session')
        _resetForTest()
    })

    it('byId 索引整表重建不触发面板重渲染（抽屉关闭时）', async () => {
        const { useForegroundTasksStore, useChatBlocksByIdStore } = await loadStores()
        useForegroundTasksStore.getState().set('perf-session', [makeFgTask('agent-1')])

        let commits = 0
        render(
            <Profiler id="panel" onRender={() => { commits += 1 }}>
                <ComposerInfoPanel {...PROPS} />
            </Profiler>,
            { wrapper },
        )
        const afterMount = commits
        expect(afterMount).toBeGreaterThan(0)

        // 模拟流式期 reconcile：索引整表重建（每次都是新 Map 引用）
        await act(async () => {
            for (let i = 0; i < 3; i++) {
                useChatBlocksByIdStore.getState().set('perf-session', new Map([['agent-1', makeAgentBlock('agent-1')]]))
            }
        })
        expect(commits).toBe(afterMount)

        // 前台任务真变化时仍要重渲染（确认 Profiler 计数有效、面板响应性未破坏；
        // 不锁具体 commit 数——订阅方多个、批处理次数是实现细节）
        await act(async () => {
            useForegroundTasksStore.getState().set('perf-session', [makeFgTask('agent-1'), makeFgTask('agent-2')])
        })
        expect(commits).toBeGreaterThan(afterMount)
    })

    it('点击任务仍能经 byId 命令式查询打开抽屉（先查后设 C1 语义保持）', async () => {
        const { useForegroundTasksStore, useChatBlocksByIdStore } = await loadStores()
        const block = makeAgentBlock('agent-1')
        useForegroundTasksStore.getState().set('perf-session', [makeFgTask('agent-1')])
        useChatBlocksByIdStore.getState().set('perf-session', new Map([['agent-1', block]]))

        render(<ComposerInfoPanel {...PROPS} />, { wrapper })
        expect(document.querySelector('.ant-drawer-open')).toBeNull()

        const card = document.querySelector('[data-testid="agent-card-agent-1"]') as HTMLElement
        expect(card).toBeTruthy()
        await act(async () => {
            fireEvent.click(card)
        })
        // 抽屉打开 = 窄订阅 selector 在 drawerBlockId 就位后成功解析出 tool-call block
        expect(document.querySelector('.ant-drawer-open')).not.toBeNull()
    })
})
