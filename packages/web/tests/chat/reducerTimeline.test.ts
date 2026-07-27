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
 * reducerTimeline 单元测试
 * 测试并行工具执行、tool-result 正确更新等场景
 */

import { describe, expect, it } from 'vitest'
import { reduceTimeline } from '@/domain/chat/reducerTimeline'
import type { TracedMessage, NormalizedMessage } from '@/domain/chat/types'
import type { PermissionEntry } from '@/domain/chat/reducerTools'

function createToolCallMessage(
    id: string,
    name: string,
    input: unknown,
    opts?: { createdAt?: number; localId?: string }
): TracedMessage {
    return {
        id,
        localId: opts?.localId ?? null,
        createdAt: opts?.createdAt ?? Date.now(),
        role: 'agent',
        isSidechain: false,
        content: [{ type: 'tool-call', id, name, input }],
    }
}

function createToolResultMessage(
    toolUseId: string,
    content: unknown,
    opts?: { createdAt?: number; isError?: boolean }
): TracedMessage {
    return {
        id: `result-${toolUseId}`,
        localId: null,
        createdAt: opts?.createdAt ?? Date.now(),
        role: 'agent',
        isSidechain: false,
        content: [{
            type: 'tool-result',
            tool_use_id: toolUseId,
            content,
            is_error: opts?.isError ?? false,
        }],
    }
}

describe('reduceTimeline', () => {
    describe('并行工具执行', () => {
        it('应正确处理并行执行的多个工具', () => {
            // 模拟并行执行：多个 tool-call 后跟多个 tool-result
            const messages: TracedMessage[] = [
                createToolCallMessage('tool-1', 'Read', { file_path: '/a.ts' }, { createdAt: 1000 }),
                createToolCallMessage('tool-2', 'Read', { file_path: '/b.ts' }, { createdAt: 1001 }),
                createToolCallMessage('tool-3', 'Read', { file_path: '/c.ts' }, { createdAt: 1002 }),
                // tool-1 的结果
                createToolResultMessage('tool-1', 'content of a.ts', { createdAt: 2000 }),
                // tool-2 的结果
                createToolResultMessage('tool-2', 'content of b.ts', { createdAt: 2001 }),
                // tool-3 的结果
                createToolResultMessage('tool-3', 'content of c.ts', { createdAt: 2002 }),
            ]

            const context = {
                permissionsById: new Map<string, PermissionEntry>(),
                groups: new Map<string, TracedMessage[]>(),
                consumedGroupIds: new Set<string>(),
                titleChangesByToolUseId: new Map<string, string>(),
                emittedTitleChangeToolUseIds: new Set<string>(),
                hiddenToolUseIds: new Set<string>(),
            }

            const { blocks, toolBlocksById } = reduceTimeline(messages, context)

            // 验证：应该有 3 个工具块
            expect(blocks).toHaveLength(3)

            // 验证：每个块都应该是 completed 状态
            for (const block of blocks) {
                expect(block.kind).toBe('tool-call')
                if (block.kind === 'tool-call') {
                    expect(block.tool.state).toBe('completed')
                    expect(block.tool.result).toBeDefined()
                }
            }

            // 验证：toolBlocksById 中的所有工具都应该是 completed
            expect(toolBlocksById.size).toBe(3)
            for (const [id, block] of toolBlocksById) {
                expect(block.tool.state).toBe('completed')
            }

            // 验证：blocks 数组中的 ID 应该是唯一的
            const blockIds = blocks.map(b => b.id)
            const uniqueIds = new Set(blockIds)
            expect(uniqueIds.size).toBe(3)
        })

        it('应正确处理乱序到达的 tool-result', () => {
            // 模拟 tool-result 乱序到达
            const messages: TracedMessage[] = [
                createToolCallMessage('tool-a', 'Read', { file_path: '/a.ts' }, { createdAt: 1000 }),
                createToolCallMessage('tool-b', 'Read', { file_path: '/b.ts' }, { createdAt: 1001 }),
                createToolCallMessage('tool-c', 'Read', { file_path: '/c.ts' }, { createdAt: 1002 }),
                // tool-c 的结果先到
                createToolResultMessage('tool-c', 'content of c.ts', { createdAt: 2000 }),
                // tool-a 的结果
                createToolResultMessage('tool-a', 'content of a.ts', { createdAt: 2001 }),
                // tool-b 的结果
                createToolResultMessage('tool-b', 'content of b.ts', { createdAt: 2002 }),
            ]

            const context = {
                permissionsById: new Map<string, PermissionEntry>(),
                groups: new Map<string, TracedMessage[]>(),
                consumedGroupIds: new Set<string>(),
                titleChangesByToolUseId: new Map<string, string>(),
                emittedTitleChangeToolUseIds: new Set<string>(),
                hiddenToolUseIds: new Set<string>(),
            }

            const { blocks, toolBlocksById } = reduceTimeline(messages, context)

            // 验证：所有工具都应该正确完成
            expect(blocks).toHaveLength(3)
            for (const block of blocks) {
                expect(block.kind).toBe('tool-call')
                if (block.kind === 'tool-call') {
                    expect(block.tool.state).toBe('completed')
                }
            }
        })
    })

    describe('tool-result 更新正确的块', () => {
        it('应更新对应 tool_use_id 的块，而不是最后一个块', () => {
            const messages: TracedMessage[] = [
                createToolCallMessage('tool-first', 'Read', { file_path: '/first.ts' }),
                createToolCallMessage('tool-second', 'Read', { file_path: '/second.ts' }),
                // 第一个工具的结果
                createToolResultMessage('tool-first', 'first content'),
            ]

            const context = {
                permissionsById: new Map<string, PermissionEntry>(),
                groups: new Map<string, TracedMessage[]>(),
                consumedGroupIds: new Set<string>(),
                titleChangesByToolUseId: new Map<string, string>(),
                emittedTitleChangeToolUseIds: new Set<string>(),
                hiddenToolUseIds: new Set<string>(),
            }

            const { blocks, toolBlocksById } = reduceTimeline(messages, context)

            // 验证：第一个工具应该是 completed
            const firstBlock = toolBlocksById.get('tool-first')
            expect(firstBlock).toBeDefined()
            expect(firstBlock?.tool.state).toBe('completed')
            expect(firstBlock?.tool.result).toBe('first content')

            // 验证：第二个工具应该是 running（没有结果）
            const secondBlock = toolBlocksById.get('tool-second')
            expect(secondBlock).toBeDefined()
            expect(secondBlock?.tool.state).toBe('running')
            expect(secondBlock?.tool.result).toBeUndefined()

            // 验证：blocks 数组中的顺序正确
            expect(blocks).toHaveLength(2)
            expect(blocks[0].id).toBe('tool-first')
            expect(blocks[1].id).toBe('tool-second')
        })
    })

    describe('agent-progress agentSummary', () => {
        it('agent-progress 事件更新 ToolCallBlock 的 agentSummary', () => {
            const toolCall = createToolCallMessage('tool-1', 'Agent', {
                subagent_type: 'Explore',
                description: '探索项目',
                prompt: 'Explore the codebase',
            })
            const progressEvent: TracedMessage = {
                id: 'evt-1',
                localId: null,
                createdAt: Date.now(),
                role: 'event',
                isSidechain: false,
                content: {
                    type: 'agent-progress',
                    toolUseId: 'tool-1',
                    metrics: { tokens: 100, toolUses: 5, durationMs: 3000 },
                    summary: 'Analyzing codebase structure',
                },
            }
            const result = reduceTimeline([toolCall, progressEvent], {
                permissionsById: new Map(),
                groups: new Map(),
                consumedGroupIds: new Set(),
                titleChangesByToolUseId: new Map(),
                emittedTitleChangeToolUseIds: new Set(),
                hiddenToolUseIds: new Map(),
            })
            const toolBlock = result.blocks.find(b => b.kind === 'tool-call') as Extract<import('@/domain/chat/types').ChatBlock, { kind: 'tool-call' }> | undefined
            expect(toolBlock).toBeDefined()
            expect(toolBlock!.tool.agentSummary).toBe('Analyzing codebase structure')
        })

        it('agent-progress 无 summary 时保留上次 agentSummary', () => {
            const toolCall = createToolCallMessage('tool-1', 'Agent', {
                subagent_type: 'Explore',
                prompt: 'Explore',
            })
            const progress1: TracedMessage = {
                id: 'evt-1',
                localId: null,
                createdAt: Date.now(),
                role: 'event',
                isSidechain: false,
                content: {
                    type: 'agent-progress',
                    toolUseId: 'tool-1',
                    metrics: { tokens: 100, toolUses: 5, durationMs: 3000 },
                    summary: 'First summary',
                },
            }
            const progress2: TracedMessage = {
                id: 'evt-2',
                localId: null,
                createdAt: Date.now(),
                role: 'event',
                isSidechain: false,
                content: {
                    type: 'agent-progress',
                    toolUseId: 'tool-1',
                    metrics: { tokens: 200, toolUses: 10, durationMs: 6000 },
                },
            }
            const result = reduceTimeline([toolCall, progress1, progress2], {
                permissionsById: new Map(),
                groups: new Map(),
                consumedGroupIds: new Set(),
                titleChangesByToolUseId: new Map(),
                emittedTitleChangeToolUseIds: new Set(),
                hiddenToolUseIds: new Map(),
            })
            const toolBlock = result.blocks.find(b => b.kind === 'tool-call') as Extract<import('@/domain/chat/types').ChatBlock, { kind: 'tool-call' }> | undefined
            expect(toolBlock!.tool.agentSummary).toBe('First summary')
        })
    })

    describe('tool-progress 心跳校准 startedAt', () => {
        it('心跳到达时校准对应 running 工具的 startedAt = createdAt - elapsed*1000', () => {
            // tool_use 在 createdAt=1000 落地（running 态，startedAt=1000）
            const toolCall = createToolCallMessage('tool-run', 'Bash', { command: 'bun test' }, { createdAt: 1000 })
            // 心跳在 createdAt=31000，elapsed=30 → startedAt 校准为 31000-30000=1000
            const progress: TracedMessage = {
                id: 'evt-progress',
                localId: null,
                createdAt: 31000,
                role: 'event',
                isSidechain: false,
                content: {
                    type: 'tool-progress',
                    toolUseId: 'tool-run',
                    elapsedSeconds: 30,
                    toolName: 'Bash',
                },
            }
            const result = reduceTimeline([toolCall, progress], {
                permissionsById: new Map(),
                groups: new Map(),
                consumedGroupIds: new Set(),
                titleChangesByToolUseId: new Map(),
                emittedTitleChangeToolUseIds: new Set(),
                hiddenToolUseIds: new Map(),
            })
            const block = result.toolBlocksById.get('tool-run')
            expect(block?.tool.state).toBe('running')
            expect(block?.tool.startedAt).toBe(1000)
        })

        it('心跳未命中 block（tool_use 尚未到达）无副作用', () => {
            const progress: TracedMessage = {
                id: 'evt-progress',
                localId: null,
                createdAt: 5000,
                role: 'event',
                isSidechain: false,
                content: {
                    type: 'tool-progress',
                    toolUseId: 'not-exist',
                    elapsedSeconds: 5,
                    toolName: 'Bash',
                },
            }
            const result = reduceTimeline([progress], {
                permissionsById: new Map(),
                groups: new Map(),
                consumedGroupIds: new Set(),
                titleChangesByToolUseId: new Map(),
                emittedTitleChangeToolUseIds: new Set(),
                hiddenToolUseIds: new Map(),
            })
            expect(result.blocks.find(b => b.kind === 'tool-call')).toBeUndefined()
        })
    })

    describe('tool-use-summary 挂载', () => {
        it('挂到 preceding_tool_use_ids 最后一个 block 的 summary', () => {
            const toolCallA = createToolCallMessage('tool-a', 'Read', { file_path: 'a.ts' }, { createdAt: 1000 })
            const toolCallB = createToolCallMessage('tool-b', 'Bash', { command: 'bun test' }, { createdAt: 2000 })
            const summary: TracedMessage = {
                id: 'evt-summary',
                localId: null,
                createdAt: 3000,
                role: 'event',
                isSidechain: false,
                content: {
                    type: 'tool-use-summary',
                    summary: 'Ran tests and fixed 2 failures',
                    toolUseIds: ['tool-a', 'tool-b'],
                },
            }
            const result = reduceTimeline([toolCallA, toolCallB, summary], {
                permissionsById: new Map(),
                groups: new Map(),
                consumedGroupIds: new Set(),
                titleChangesByToolUseId: new Map(),
                emittedTitleChangeToolUseIds: new Set(),
                hiddenToolUseIds: new Map(),
            })
            expect(result.toolBlocksById.get('tool-b')?.tool.summary).toBe('Ran tests and fixed 2 failures')
            expect(result.toolBlocksById.get('tool-a')?.tool.summary).toBeUndefined()
        })

        it('多次到达 summary 后覆盖前', () => {
            const toolCall = createToolCallMessage('tool-x', 'Bash', { command: 'bun test' }, { createdAt: 1000 })
            const ctx = {
                permissionsById: new Map(), groups: new Map(), consumedGroupIds: new Set(),
                titleChangesByToolUseId: new Map(), emittedTitleChangeToolUseIds: new Set(), hiddenToolUseIds: new Map(),
            }
            const summary1: TracedMessage = {
                id: 'evt-s1', localId: null, createdAt: 2000, role: 'event', isSidechain: false,
                content: { type: 'tool-use-summary', summary: 'first', toolUseIds: ['tool-x'] },
            }
            const summary2: TracedMessage = {
                id: 'evt-s2', localId: null, createdAt: 3000, role: 'event', isSidechain: false,
                content: { type: 'tool-use-summary', summary: 'second', toolUseIds: ['tool-x'] },
            }
            const result = reduceTimeline([toolCall, summary1, summary2], ctx)
            expect(result.toolBlocksById.get('tool-x')?.tool.summary).toBe('second')
        })

        it('lastId 不在 toolBlocksById（隐藏工具）时回退挂到前一个存在的 block', () => {
            // hiddenToolUseIds 里的工具（如 change_title）不进 toolBlocksById；
            // preceding 末尾命中此类工具时，应逐个回退而非整条丢弃
            const toolCallA = createToolCallMessage('tool-a', 'Read', { file_path: 'a.ts' }, { createdAt: 1000 })
            const summary: TracedMessage = {
                id: 'evt-summary', localId: null, createdAt: 3000, role: 'event', isSidechain: false,
                content: {
                    type: 'tool-use-summary',
                    summary: 'Ran tests and fixed 2 failures',
                    toolUseIds: ['tool-a', 'tool-hidden'],
                },
            }
            const result = reduceTimeline([toolCallA, summary], {
                permissionsById: new Map(),
                groups: new Map(),
                consumedGroupIds: new Set(),
                titleChangesByToolUseId: new Map(),
                emittedTitleChangeToolUseIds: new Set(),
                hiddenToolUseIds: new Map(),
            })
            expect(result.toolBlocksById.get('tool-a')?.tool.summary).toBe('Ran tests and fixed 2 failures')
        })
    })

    describe('错误处理', () => {
        it('应正确标记错误的 tool-result', () => {
            const messages: TracedMessage[] = [
                createToolCallMessage('tool-error', 'Bash', { command: 'exit 1' }),
                createToolResultMessage('tool-error', 'Command failed', { isError: true }),
            ]

            const context = {
                permissionsById: new Map<string, PermissionEntry>(),
                groups: new Map<string, TracedMessage[]>(),
                consumedGroupIds: new Set<string>(),
                titleChangesByToolUseId: new Map<string, string>(),
                emittedTitleChangeToolUseIds: new Set<string>(),
                hiddenToolUseIds: new Set<string>(),
            }

            const { blocks, toolBlocksById } = reduceTimeline(messages, context)

            const block = toolBlocksById.get('tool-error')
            expect(block).toBeDefined()
            expect(block?.tool.state).toBe('error')
            expect(block?.tool.result).toBe('Command failed')
        })
    })
})
