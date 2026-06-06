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
 * reduceChatBlocks 集成单测
 * 测试 normalize → trace → reduce 全流程
 */

import { describe, expect, it } from 'vitest'
import { reduceChatBlocks } from '@/domain/chat/reducer'
import type { NormalizedMessage } from '@/domain/chat/types'
import type { AgentState } from '@mobi/shared'

// ============ 工厂函数 ============

function createUserMessage(
    id: string,
    text: string,
    opts?: { createdAt?: number; localId?: string }
): NormalizedMessage {
    return {
        id,
        localId: opts?.localId ?? null,
        createdAt: opts?.createdAt ?? Date.now(),
        role: 'user',
        isSidechain: false,
        content: { type: 'text', text },
    }
}

function createAgentTextMessage(
    id: string,
    text: string,
    opts?: { createdAt?: number; meta?: { sentFrom?: string } }
): NormalizedMessage {
    return {
        id,
        localId: null,
        createdAt: opts?.createdAt ?? Date.now(),
        role: 'agent',
        isSidechain: false,
        content: [{
            type: 'text',
            text,
            uuid: `uuid-${id}`,
            parentUUID: null,
        }],
        meta: opts?.meta,
    }
}

function createToolCallMessage(
    id: string,
    name: string,
    input: unknown,
    opts?: { createdAt?: number }
): NormalizedMessage {
    return {
        id,
        localId: null,
        createdAt: opts?.createdAt ?? Date.now(),
        role: 'agent',
        isSidechain: false,
        content: [{
            type: 'tool-call',
            id,
            name,
            input,
            description: null,
            uuid: `uuid-${id}`,
            parentUUID: null,
        }],
    }
}

function createToolResultMessage(
    toolUseId: string,
    content: unknown,
    opts?: { createdAt?: number; isError?: boolean }
): NormalizedMessage {
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
            uuid: `uuid-result-${toolUseId}`,
            parentUUID: null,
        }],
    }
}

function createEventMessage(
    id: string,
    event: NormalizedMessage['content'] extends infer C
        ? C extends { type: infer E } & infer Rest
            ? { type: E } & Rest
            : never
        : never,
    opts?: { createdAt?: number }
): NormalizedMessage {
    return {
        id,
        localId: null,
        createdAt: opts?.createdAt ?? Date.now(),
        role: 'event',
        isSidechain: false,
        content: event as NormalizedMessage extends { content: infer C } ? C : never,
    }
}

function createUsageMessage(
    id: string,
    text: string,
    usage: { input_tokens: number; output_tokens: number },
    opts?: { createdAt?: number }
): NormalizedMessage {
    return {
        id,
        localId: null,
        createdAt: opts?.createdAt ?? Date.now(),
        role: 'agent',
        isSidechain: false,
        content: [{
            type: 'text',
            text,
            uuid: `uuid-${id}`,
            parentUUID: null,
        }],
        usage,
    }
}

// ============ 测试 ============

describe('reduceChatBlocks', () => {
    describe('基础消息', () => {
        it('用户消息生成 user-text 块', () => {
            const messages: NormalizedMessage[] = [
                createUserMessage('msg-1', '你好'),
            ]

            const { blocks, byId } = reduceChatBlocks(messages, null)

            expect(blocks).toHaveLength(1)
            expect(blocks[0].kind).toBe('user-text')
            const block = blocks[0] as Extract<typeof blocks[0], { kind: 'user-text' }>
            expect(block.text).toBe('你好')
            expect(block.id).toBe('msg-1')

            // byId 也应包含该块
            expect(byId.has('msg-1')).toBe(true)
        })

        it('Agent 消息生成 agent-text 块', () => {
            const messages: NormalizedMessage[] = [
                createAgentTextMessage('msg-1', 'Hello! How can I help?'),
            ]

            const { blocks, byId } = reduceChatBlocks(messages, null)

            expect(blocks).toHaveLength(1)
            expect(blocks[0].kind).toBe('agent-text')
            const block = blocks[0] as Extract<typeof blocks[0], { kind: 'agent-text' }>
            expect(block.text).toBe('Hello! How can I help?')
            // agent 内容块 ID 格式为 msgId:contentIndex
            expect(block.id).toBe('msg-1:0')

            expect(byId.has('msg-1:0')).toBe(true)
        })

        it('多条消息按正确顺序排列', () => {
            const messages: NormalizedMessage[] = [
                createUserMessage('msg-1', '用户消息', { createdAt: 1000 }),
                createAgentTextMessage('msg-2', 'Agent 回复', { createdAt: 2000 }),
                createUserMessage('msg-3', '追问', { createdAt: 3000 }),
            ]

            const { blocks } = reduceChatBlocks(messages, null)

            expect(blocks).toHaveLength(3)
            expect(blocks[0].kind).toBe('user-text')
            expect(blocks[1].kind).toBe('agent-text')
            expect(blocks[2].kind).toBe('user-text')

            const userBlock1 = blocks[0] as Extract<typeof blocks[0], { kind: 'user-text' }>
            const agentBlock = blocks[1] as Extract<typeof blocks[1], { kind: 'agent-text' }>
            const userBlock2 = blocks[2] as Extract<typeof blocks[2], { kind: 'user-text' }>

            expect(userBlock1.text).toBe('用户消息')
            expect(agentBlock.text).toBe('Agent 回复')
            expect(userBlock2.text).toBe('追问')
        })
    })

    describe('tool-call 配对', () => {
        it('tool-call + tool-result 生成 completed 状态的工具块', () => {
            const messages: NormalizedMessage[] = [
                createToolCallMessage('tool-1', 'Read', { file_path: '/a.ts' }, { createdAt: 1000 }),
                createToolResultMessage('tool-1', 'file content', { createdAt: 2000 }),
            ]

            const { blocks, byId } = reduceChatBlocks(messages, null)

            expect(blocks).toHaveLength(1)
            expect(blocks[0].kind).toBe('tool-call')
            const toolBlock = blocks[0] as Extract<typeof blocks[0], { kind: 'tool-call' }>
            expect(toolBlock.tool.state).toBe('completed')
            expect(toolBlock.tool.result).toBe('file content')
            expect(toolBlock.tool.name).toBe('Read')
            expect(toolBlock.id).toBe('tool-1')

            expect(byId.has('tool-1')).toBe(true)
        })

        it('仅有 tool-call 生成 running 状态的工具块', () => {
            const messages: NormalizedMessage[] = [
                createToolCallMessage('tool-1', 'Bash', { command: 'ls' }),
            ]

            const { blocks } = reduceChatBlocks(messages, null)

            expect(blocks).toHaveLength(1)
            expect(blocks[0].kind).toBe('tool-call')
            const toolBlock = blocks[0] as Extract<typeof blocks[0], { kind: 'tool-call' }>
            expect(toolBlock.tool.state).toBe('running')
            expect(toolBlock.tool.result).toBeUndefined()
        })

        it('error tool-result 生成 error 状态', () => {
            const messages: NormalizedMessage[] = [
                createToolCallMessage('tool-err', 'Bash', { command: 'exit 1' }),
                createToolResultMessage('tool-err', 'Command failed', { isError: true }),
            ]

            const { blocks } = reduceChatBlocks(messages, null)

            const toolBlock = blocks[0] as Extract<typeof blocks[0], { kind: 'tool-call' }>
            expect(toolBlock.tool.state).toBe('error')
            expect(toolBlock.tool.result).toBe('Command failed')
        })

        it('多个并行工具调用各自配对', () => {
            const messages: NormalizedMessage[] = [
                createToolCallMessage('tool-a', 'Read', { file_path: '/a.ts' }, { createdAt: 1000 }),
                createToolCallMessage('tool-b', 'Read', { file_path: '/b.ts' }, { createdAt: 1001 }),
                createToolResultMessage('tool-a', 'content a', { createdAt: 2000 }),
                createToolResultMessage('tool-b', 'content b', { createdAt: 2001 }),
            ]

            const { blocks } = reduceChatBlocks(messages, null)

            expect(blocks).toHaveLength(2)
            const blockA = blocks.find(b => b.id === 'tool-a') as Extract<typeof blocks[0], { kind: 'tool-call' }>
            const blockB = blocks.find(b => b.id === 'tool-b') as Extract<typeof blocks[0], { kind: 'tool-call' }>

            expect(blockA.tool.state).toBe('completed')
            expect(blockA.tool.result).toBe('content a')
            expect(blockB.tool.state).toBe('completed')
            expect(blockB.tool.result).toBe('content b')
        })
    })

    describe('agentState 权限', () => {
        it('agentState 中的 pending 请求生成 pending 状态的工具块', () => {
            const baseTime = Date.now()
            const messages: NormalizedMessage[] = [
                createAgentTextMessage('msg-1', '我来帮你执行命令', { createdAt: baseTime - 1000 }),
            ]

            const agentState: AgentState = {
                requests: {
                    'perm-1': {
                        tool: 'Bash',
                        arguments: { command: 'npm test' },
                        createdAt: baseTime,
                    },
                },
            }

            const { blocks } = reduceChatBlocks(messages, agentState)

            // 应有 agent-text + pending tool-call
            const toolBlocks = blocks.filter(b => b.kind === 'tool-call')
            expect(toolBlocks.length).toBeGreaterThanOrEqual(1)

            const permBlock = toolBlocks.find(b => b.id === 'perm-1') as Extract<typeof blocks[0], { kind: 'tool-call' }> | undefined
            expect(permBlock).toBeDefined()
            expect(permBlock!.tool.state).toBe('pending')
            expect(permBlock!.tool.name).toBe('Bash')
            expect(permBlock!.tool.input).toEqual({ command: 'npm test' })
        })

        it('agentState 中的请求不重复生成已存在的工具块', () => {
            const baseTime = Date.now()
            const messages: NormalizedMessage[] = [
                createToolCallMessage('tool-1', 'Read', { file_path: '/a.ts' }, { createdAt: baseTime }),
                createToolResultMessage('tool-1', 'content', { createdAt: baseTime + 1000 }),
            ]

            const agentState: AgentState = {
                requests: {
                    'tool-1': {
                        tool: 'Read',
                        arguments: { file_path: '/a.ts' },
                    },
                },
            }

            const { blocks } = reduceChatBlocks(messages, agentState)

            // 不应生成额外的 pending 块
            const toolBlocks = blocks.filter(b => b.kind === 'tool-call')
            expect(toolBlocks).toHaveLength(1)
            expect(toolBlocks[0].id).toBe('tool-1')
        })

        it('无 agentState 时不生成额外权限块', () => {
            const messages: NormalizedMessage[] = [
                createAgentTextMessage('msg-1', 'Hello'),
            ]

            const { blocks } = reduceChatBlocks(messages, null)

            const toolBlocks = blocks.filter(b => b.kind === 'tool-call')
            expect(toolBlocks).toHaveLength(0)
        })
    })

    describe('事件消息', () => {
        it('非 ready 事件生成 agent-event 块', () => {
            const messages: NormalizedMessage[] = [
                {
                    id: 'evt-1',
                    localId: null,
                    createdAt: 1000,
                    role: 'event',
                    isSidechain: false,
                    content: { type: 'message', message: 'Agent is thinking...' },
                },
            ]

            const { blocks, byId } = reduceChatBlocks(messages, null)

            expect(blocks).toHaveLength(1)
            expect(blocks[0].kind).toBe('agent-event')
            const eventBlock = blocks[0] as Extract<typeof blocks[0], { kind: 'agent-event' }>
            expect(eventBlock.event.type).toBe('message')

            expect(byId.has('evt-1')).toBe(true)
        })

        it('ready 事件设置 hasReadyEvent 但不生成块', () => {
            const messages: NormalizedMessage[] = [
                {
                    id: 'evt-ready',
                    localId: null,
                    createdAt: 1000,
                    role: 'event',
                    isSidechain: false,
                    content: { type: 'ready' },
                },
            ]

            const { blocks, hasReadyEvent } = reduceChatBlocks(messages, null)

            // ready 事件不生成可见块（由 reducerTimeline 处理为 hasReadyEvent 标记）
            expect(hasReadyEvent).toBe(true)
        })

        it('turn-result 事件生成 agent-event 块', () => {
            const messages: NormalizedMessage[] = [
                {
                    id: 'evt-turn',
                    localId: null,
                    createdAt: 1000,
                    role: 'event',
                    isSidechain: false,
                    content: { type: 'turn-result', durationMs: 5000, tokens: 100 },
                },
            ]

            const { blocks } = reduceChatBlocks(messages, null)

            expect(blocks).toHaveLength(1)
            expect(blocks[0].kind).toBe('agent-event')
            const eventBlock = blocks[0] as Extract<typeof blocks[0], { kind: 'agent-event' }>
            expect(eventBlock.event.type).toBe('turn-result')
        })
    })

    describe('返回值完整性', () => {
        it('返回 blocks 数组、byId Map、hasReadyEvent、latestUsage', () => {
            const messages: NormalizedMessage[] = [
                createUserMessage('msg-1', 'Hello', { createdAt: 1000 }),
                createUsageMessage('msg-2', 'Hi', { input_tokens: 100, output_tokens: 50 }, { createdAt: 2000 }),
            ]

            const result = reduceChatBlocks(messages, null)

            // blocks 数组
            expect(Array.isArray(result.blocks)).toBe(true)
            expect(result.blocks.length).toBeGreaterThan(0)

            // byId 是 Map
            expect(result.byId).toBeInstanceOf(Map)
            expect(result.byId.size).toBe(result.blocks.length)

            // blocks 中每个元素都能在 byId 中找到
            for (const block of result.blocks) {
                expect(result.byId.has(block.id)).toBe(true)
                expect(result.byId.get(block.id)).toBe(block)
            }

            // hasReadyEvent 是布尔值
            expect(typeof result.hasReadyEvent).toBe('boolean')
            expect(result.hasReadyEvent).toBe(false)

            // latestUsage 有值（来自 msg-2）
            expect(result.latestUsage).not.toBeNull()
            expect(result.latestUsage!.inputTokens).toBe(100)
            expect(result.latestUsage!.outputTokens).toBe(50)
            expect(result.latestUsage!.contextSize).toBe(100)
            expect(result.latestUsage!.timestamp).toBe(2000)
        })

        it('无 usage 数据时 latestUsage 为 null', () => {
            const messages: NormalizedMessage[] = [
                createUserMessage('msg-1', 'Hello'),
            ]

            const { latestUsage } = reduceChatBlocks(messages, null)

            expect(latestUsage).toBeNull()
        })

        it('latestUsage 取最后一条有 usage 的消息', () => {
            const messages: NormalizedMessage[] = [
                createUsageMessage('msg-1', 'First', { input_tokens: 10, output_tokens: 5 }, { createdAt: 1000 }),
                createUsageMessage('msg-2', 'Second', { input_tokens: 200, output_tokens: 100 }, { createdAt: 2000 }),
                createUsageMessage('msg-3', 'Third', { input_tokens: 3000, output_tokens: 1500 }, { createdAt: 3000 }),
            ]

            const { latestUsage } = reduceChatBlocks(messages, null)

            expect(latestUsage).not.toBeNull()
            expect(latestUsage!.inputTokens).toBe(3000)
            expect(latestUsage!.outputTokens).toBe(1500)
            expect(latestUsage!.contextSize).toBe(3000)
            expect(latestUsage!.timestamp).toBe(3000)
        })

        it('latestUsage 正确计算 contextSize（含缓存 token）', () => {
            const messages: NormalizedMessage[] = [
                {
                    id: 'msg-1',
                    localId: null,
                    createdAt: 1000,
                    role: 'agent',
                    isSidechain: false,
                    content: [{
                        type: 'text',
                        text: 'response',
                        uuid: 'uuid-1',
                        parentUUID: null,
                    }],
                    usage: {
                        input_tokens: 100,
                        output_tokens: 50,
                        cache_creation_input_tokens: 200,
                        cache_read_input_tokens: 300,
                    },
                },
            ]

            const { latestUsage } = reduceChatBlocks(messages, null)

            expect(latestUsage).not.toBeNull()
            expect(latestUsage!.inputTokens).toBe(100)
            expect(latestUsage!.outputTokens).toBe(50)
            expect(latestUsage!.cacheCreation).toBe(200)
            expect(latestUsage!.cacheRead).toBe(300)
            // contextSize = cache_creation + cache_read + input = 200 + 300 + 100
            expect(latestUsage!.contextSize).toBe(600)
        })
    })
})
