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
 * useAgentSidechain 单元测试
 * 验证两条数据路径（SSE 实时 / API 历史）的选择和 loading 状态判断
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import type { ChatBlock, ToolCallBlock } from '@/domain/chat/types'

// Mock useSidechainMessages，隔离 TanStack Query 依赖
vi.mock('@/core/data/hooks/queries/useSidechainMessages', () => ({
    useSidechainMessages: vi.fn(),
}))

import { useAgentSidechain } from '@/components/tool-card/useAgentSidechain'
import { useSidechainMessages } from '@/core/data/hooks/queries/useSidechainMessages'

const mockUseSidechainMessages = useSidechainMessages as unknown as ReturnType<typeof vi.fn>

/** 创建 tool-call block 测试数据 */
function createBlock(overrides?: Partial<ToolCallBlock['tool']> & { children?: ChatBlock[] }): Extract<ChatBlock, { kind: 'tool-call' }> {
    return {
        kind: 'tool-call',
        id: 'block-1',
        localId: null,
        createdAt: 1000,
        tool: {
            id: 'tool-use-1',
            name: 'Task',
            input: { prompt: 'test' },
            state: 'completed',
            createdAt: 1000,
            startedAt: null,
            completedAt: null,
            description: null,
            permission: null,
            ...overrides,
        },
        children: overrides?.children ?? [],
    }
}

/** 一个简单的 child block */
const childBlock: ChatBlock = {
    kind: 'user-text',
    id: 'child-1',
    localId: null,
    createdAt: 2000,
    blocks: [{ type: 'text', text: 'hello' }],
}

describe('useAgentSidechain', () => {
    beforeEach(() => {
        vi.clearAllMocks()
    })

    describe('SSE 实时路径 (hasChildren=true)', () => {
        it('直接返回 children，isLoading=false', () => {
            const block = createBlock({ children: [childBlock] })

            // 模拟 TanStack Query v5 disabled 行为：isPending=true 但数据已在 children 中
            mockUseSidechainMessages.mockReturnValue({
                data: [],
                isPending: true,
            } as ReturnType<typeof useSidechainMessages>)

            const { result } = renderHook(() => useAgentSidechain(block, 'session-1'))

            expect(result.current.blocks).toEqual([childBlock])
            expect(result.current.isLoading).toBe(false)
            // query 应被禁用（传入 null）
            expect(mockUseSidechainMessages).toHaveBeenCalledWith(null, null)
        })

        it('children 为空数组时也视为无数据，走 API 路径', () => {
            const block = createBlock({ children: [] })

            mockUseSidechainMessages.mockReturnValue({
                data: [],
                isPending: true,
            } as ReturnType<typeof useSidechainMessages>)

            const { result } = renderHook(() => useAgentSidechain(block, 'session-1'))

            expect(result.current.isLoading).toBe(true)
        })
    })

    describe('API 历史路径 (hasChildren=false)', () => {
        it('sessionId 和 tool.id 都有值时启用 query', () => {
            const block = createBlock()

            mockUseSidechainMessages.mockReturnValue({
                data: [],
                isPending: true,
            } as ReturnType<typeof useSidechainMessages>)

            renderHook(() => useAgentSidechain(block, 'session-1'))

            expect(mockUseSidechainMessages).toHaveBeenCalledWith('session-1', 'tool-use-1')
        })

        it('API 加载中时 isLoading=true', () => {
            const block = createBlock()

            mockUseSidechainMessages.mockReturnValue({
                data: [],
                isPending: true,
            } as ReturnType<typeof useSidechainMessages>)

            const { result } = renderHook(() => useAgentSidechain(block, 'session-1'))

            expect(result.current.blocks).toEqual([])
            expect(result.current.isLoading).toBe(true)
        })

        it('API 返回数据后 isLoading=false', () => {
            const block = createBlock()

            mockUseSidechainMessages.mockReturnValue({
                data: [],
                isPending: false,
            } as ReturnType<typeof useSidechainMessages>)

            const { result } = renderHook(() => useAgentSidechain(block, 'session-1'))

            expect(result.current.isLoading).toBe(false)
        })

        it('无 sessionId 时 query 禁用，isLoading 仍为 true（无数据且 query 永远不会完成）', () => {
            const block = createBlock()

            mockUseSidechainMessages.mockReturnValue({
                data: [],
                isPending: true,
            } as ReturnType<typeof useSidechainMessages>)

            const { result } = renderHook(() => useAgentSidechain(block))

            expect(result.current.blocks).toEqual([])
            // sessionId 为空 → query disabled → isLoading 由 hasChildren && isPending 决定
            // hasChildren=false, 所以即使 isPending=true, isLoading 也取决于 isPending
            // 但没有 sessionId 时 query 参数为 null, enabled=false, 永远不会加载完
            // 此时 isLoading = !hasChildren && isPending = true
            expect(result.current.isLoading).toBe(true)
        })
    })
})
