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
 * toolMerger 单元测试
 * 测试工具调用合并逻辑
 */

import { describe, expect, it } from 'vitest'
import { mergeToolResults } from '@/domain/chat/toolMerger'
import type {
    ParsedMessage,
    ParsedToolCallBlock,
    ParsedToolResultBlock,
    MergedToolCallBlock,
} from '@/domain/chat/messageParser'

describe('mergeToolResults', () => {
    /** 创建 assistant 消息的工具调用块 */
    function createToolCall(id: string, name: string = 'Read', input: unknown = {}): ParsedToolCallBlock {
        return { type: 'tool-call', id, name, input, description: null }
    }

    /** 创建 user 消息的工具结果块 */
    function createToolResult(
        toolUseId: string,
        content: unknown = 'result',
        isError: boolean = false,
    ): ParsedToolResultBlock {
        return { type: 'tool-result', tool_use_id: toolUseId, content, is_error: isError }
    }

    /** 创建 assistant 消息 */
    function createAssistantMessage(
        id: string,
        blocks: ParsedToolCallBlock[],
        createdAt: number = 1000,
    ): ParsedMessage {
        return {
            id,
            localId: null,
            createdAt,
            role: 'assistant',
            content: blocks,
        }
    }

    /** 创建 user 消息 */
    function createUserMessage(
        id: string,
        blocks: Array<ParsedToolResultBlock | { type: 'text'; text: string }>,
        createdAt: number = 2000,
    ): ParsedMessage {
        return {
            id,
            localId: null,
            createdAt,
            role: 'user',
            content: blocks,
        }
    }

    it('相邻的 tool-call 和 tool-result 应合并到同一条消息', () => {
        const messages: ParsedMessage[] = [
            createAssistantMessage('msg-1', [createToolCall('tool-1')]),
            createUserMessage('msg-2', [createToolResult('tool-1')]),
        ]

        const result = mergeToolResults(messages)

        // assistant 消息中的 tool-call 应变成 merged-tool-call
        expect(result).toHaveLength(1)
        expect(result[0].role).toBe('assistant')
        expect(result[0].content).toHaveLength(1)
        expect(result[0].content[0].type).toBe('merged-tool-call')
        const merged = result[0].content[0] as MergedToolCallBlock
        expect(merged.id).toBe('tool-1')
        expect(merged.state).toBe('completed')
        expect(merged.result).toBe('result')
        expect(merged.resultIsError).toBe(false)
    })

    it('合并后 tool-call 的 state 应为 completed', () => {
        const messages: ParsedMessage[] = [
            createAssistantMessage('msg-1', [createToolCall('tool-1')]),
            createUserMessage('msg-2', [createToolResult('tool-1', 'ok', false)]),
        ]

        const result = mergeToolResults(messages)
        const merged = result[0].content[0] as MergedToolCallBlock
        expect(merged.state).toBe('completed')
    })

    it('合并后 tool-call 的 state 在错误时应为 error', () => {
        const messages: ParsedMessage[] = [
            createAssistantMessage('msg-1', [createToolCall('tool-1')]),
            createUserMessage('msg-2', [createToolResult('tool-1', 'error!', true)]),
        ]

        const result = mergeToolResults(messages)
        const merged = result[0].content[0] as MergedToolCallBlock
        expect(merged.state).toBe('error')
        expect(merged.result).toBe('error!')
        expect(merged.resultIsError).toBe(true)
    })

    it('跨消息的 tool-call 和 tool-result 应正确配对', () => {
        const messages: ParsedMessage[] = [
            createAssistantMessage('msg-1', [
                createToolCall('tool-1', 'Read'),
                createToolCall('tool-2', 'Write'),
            ]),
            createAssistantMessage('msg-1b', [{ type: 'text', text: '中间文本' } as any]),
            createUserMessage('msg-2', [
                createToolResult('tool-1', 'file content'),
                createToolResult('tool-2', 'write done'),
            ]),
        ]

        const result = mergeToolResults(messages)

        // 应有 assistant 消息（包含 merged-tool-call）和中间文本消息
        expect(result.length).toBeGreaterThanOrEqual(2)

        // 第一个 assistant 消息
        const firstAssistant = result.find(m => m.id === 'msg-1')!
        expect(firstAssistant.content).toHaveLength(2)
        const merged1 = firstAssistant.content[0] as MergedToolCallBlock
        const merged2 = firstAssistant.content[1] as MergedToolCallBlock
        expect(merged1.state).toBe('completed')
        expect(merged1.result).toBe('file content')
        expect(merged2.state).toBe('completed')
        expect(merged2.result).toBe('write done')

        // user 消息应被过滤掉（全部是 tool-result）
        const userMessages = result.filter(m => m.role === 'user')
        expect(userMessages).toHaveLength(0)
    })

    it('未配对的 tool-call 应保留（无对应 result）', () => {
        const messages: ParsedMessage[] = [
            createAssistantMessage('msg-1', [createToolCall('tool-1')]),
        ]

        const result = mergeToolResults(messages)

        expect(result).toHaveLength(1)
        const merged = result[0].content[0] as MergedToolCallBlock
        expect(merged.type).toBe('merged-tool-call')
        expect(merged.state).toBe('running')
        expect(merged.result).toBeUndefined()
    })

    it('user 消息中同时有文本和 tool-result 时应保留文本', () => {
        const messages: ParsedMessage[] = [
            createAssistantMessage('msg-1', [createToolCall('tool-1')]),
            createUserMessage('msg-2', [
                { type: 'text', text: '用户补充说明' },
                createToolResult('tool-1', 'ok'),
            ]),
        ]

        const result = mergeToolResults(messages)

        // user 消息应保留文本块
        const userMessage = result.find(m => m.role === 'user')
        expect(userMessage).toBeDefined()
        expect(userMessage!.content).toHaveLength(1)
        expect(userMessage!.content[0].type).toBe('text')
    })

    it('未配对的 tool-result 应生成占位 assistant 消息', () => {
        const messages: ParsedMessage[] = [
            createUserMessage('msg-1', [createToolResult('tool-unknown', 'orphan result')]),
        ]

        const result = mergeToolResults(messages)

        // 应有一个占位的 assistant 消息
        expect(result.length).toBeGreaterThanOrEqual(1)
        const placeholder = result.find(m => m.id.startsWith('placeholder-'))
        expect(placeholder).toBeDefined()
        expect(placeholder!.role).toBe('assistant')
        const placeholderBlock = placeholder!.content[0] as MergedToolCallBlock
        expect(placeholderBlock.type).toBe('merged-tool-call')
        expect(placeholderBlock.id).toBe('tool-unknown')
        expect(placeholderBlock.state).toBe('completed')
        expect(placeholderBlock.result).toBe('orphan result')
    })

    it('多条 tool-call 应各自独立合并', () => {
        const messages: ParsedMessage[] = [
            createAssistantMessage('msg-1', [
                createToolCall('tool-1', 'Read', { file: '/a.ts' }),
                createToolCall('tool-2', 'Write', { file: '/b.ts' }),
                createToolCall('tool-3', 'Bash', { cmd: 'ls' }),
            ]),
            createUserMessage('msg-2', [
                createToolResult('tool-1', 'a content'),
                createToolResult('tool-2', 'b written', true),
                // tool-3 没有 result
            ]),
        ]

        const result = mergeToolResults(messages)

        const assistant = result.find(m => m.id === 'msg-1')!
        expect(assistant.content).toHaveLength(3)

        const t1 = assistant.content[0] as MergedToolCallBlock
        const t2 = assistant.content[1] as MergedToolCallBlock
        const t3 = assistant.content[2] as MergedToolCallBlock

        expect(t1.state).toBe('completed')
        expect(t1.result).toBe('a content')
        expect(t2.state).toBe('error')
        expect(t2.result).toBe('b written')
        expect(t3.state).toBe('running')
        expect(t3.result).toBeUndefined()
    })

    it('system 消息应直接保留', () => {
        const systemMessage: ParsedMessage = {
            id: 'msg-sys',
            localId: null,
            createdAt: 1500,
            role: 'system',
            content: [{ type: 'event', event: { type: 'switch', mode: 'remote' } }],
        }

        const messages: ParsedMessage[] = [
            createAssistantMessage('msg-1', [createToolCall('tool-1')]),
            systemMessage,
            createUserMessage('msg-2', [createToolResult('tool-1')]),
        ]

        const result = mergeToolResults(messages)

        const sysMsg = result.find(m => m.role === 'system')
        expect(sysMsg).toBeDefined()
        expect(sysMsg!.id).toBe('msg-sys')
    })

    it('应保留 tool-call 的 name 和 input 信息', () => {
        const messages: ParsedMessage[] = [
            createAssistantMessage('msg-1', [
                createToolCall('tool-1', 'Read', { file_path: '/src/index.ts' }),
            ]),
            createUserMessage('msg-2', [createToolResult('tool-1', 'file content')]),
        ]

        const result = mergeToolResults(messages)
        const merged = result[0].content[0] as MergedToolCallBlock

        expect(merged.name).toBe('Read')
        expect(merged.input).toEqual({ file_path: '/src/index.ts' })
    })
})
