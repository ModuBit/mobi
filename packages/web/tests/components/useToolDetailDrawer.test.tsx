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
 * useToolDetailDrawer 订阅收窄测试
 * 锁定约定：流式期 chatBlocksById 索引整表重建不得触发宿主重渲染；点击时命令式
 * 查询（先查后设 C1）语义保持（docs/research-claude-ai-perf.md §2.3）。
 */

import { describe, it, expect, afterEach } from 'vitest'
import { act, cleanup, renderHook } from '@testing-library/react'
import { useToolDetailDrawer } from '@/features/chat/tool-card/useToolDetailDrawer'
import type { ToolCallBlock } from '@/domain/chat/types'

// vitest 未开 globals，渲染型测试需显式 cleanup
afterEach(cleanup)

async function loadStore() {
    const { useChatBlocksByIdStore } = await import('@/core/data/stores/chatBlocksByIdStore')
    return useChatBlocksByIdStore
}

function makeAgentBlock(id: string): ToolCallBlock {
    return {
        kind: 'tool-call',
        id,
        localId: null,
        createdAt: Date.now(),
        tool: {
            id,
            name: 'Task',
            state: 'running',
            input: { subagent_type: 'Explore', description: '前台研究' },
            createdAt: Date.now(),
            startedAt: Date.now(),
            completedAt: null,
            description: null,
        },
        children: [],
    }
}

describe('useToolDetailDrawer', () => {
    afterEach(async () => {
        const store = await loadStore()
        store.getState().clearSession('perf-session')
    })

    it('byId 索引整表重建不触发消费者重渲染（抽屉关闭时）', async () => {
        const store = await loadStore()
        let renders = 0
        renderHook(() => {
            renders += 1
            return useToolDetailDrawer('perf-session')
        })
        const afterMount = renders

        await act(async () => {
            for (let i = 0; i < 3; i++) {
                store.getState().set('perf-session', new Map([['agent-1', makeAgentBlock('agent-1')]]))
            }
        })
        expect(renders).toBe(afterMount)
    })

    it('按 toolUseId 打开：byId 命中时打开对应 block，未命中时静默降级', async () => {
        const store = await loadStore()
        // byId 索引以 block.id 为键；任务行的 toolUseId 即对应 tool-call 的 id
        const block = makeAgentBlock('toolu-1')
        store.getState().set('perf-session', new Map([['toolu-1', block]]))

        const { result } = renderHook(() => useToolDetailDrawer('perf-session'))

        act(() => result.current.openToolUseId('missing'))
        expect(result.current.drawerBlock).toBeNull()

        act(() => result.current.openToolUseId(null))
        expect(result.current.drawerBlock).toBeNull()

        act(() => result.current.openToolUseId('toolu-1'))
        expect(result.current.drawerBlock).toBe(block)
    })

    it('close 关闭', async () => {
        const store = await loadStore()
        const block = makeAgentBlock('agent-1')
        store.getState().set('perf-session', new Map([['agent-1', block]]))

        const { result } = renderHook(() => useToolDetailDrawer('perf-session'))

        act(() => result.current.openToolUseId('agent-1'))
        expect(result.current.drawerBlock).toBe(block)

        act(() => result.current.close())
        expect(result.current.drawerBlock).toBeNull()
    })
})
