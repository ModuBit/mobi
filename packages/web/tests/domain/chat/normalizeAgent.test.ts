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

import { describe, it, expect } from 'vitest'
import { normalizeAgentRecord, isSkippableAgentContent } from '../../../src/domain/chat/normalizeAgent'

describe('normalizeAgentRecord', () => {
    const baseParams = {
        messageId: 'test-msg-id',
        localId: null,
        createdAt: Date.now(),
    }

    it('should return null for invalid content', () => {
        expect(normalizeAgentRecord('test', null, Date.now(), null)).toBeNull()
        expect(normalizeAgentRecord('test', null, Date.now(), {})).toBeNull()
        expect(normalizeAgentRecord('test', null, Date.now(), { type: 'unknown' })).toBeNull()
    })

    it('should handle assistant output', () => {
        const result = normalizeAgentRecord(
            baseParams.messageId,
            baseParams.localId,
            baseParams.createdAt,
            {
                type: 'output',
                data: {
                    type: 'assistant',
                    message: {
                        content: 'Hello, world!',
                    },
                },
            }
        )

        expect(result).not.toBeNull()
        expect(result?.role).toBe('agent')
        expect(result?.content).toEqual([
            { type: 'text', text: 'Hello, world!', uuid: baseParams.messageId, parentUUID: null }
        ])
    })

    it('should skip empty thinking content', () => {
        const result = normalizeAgentRecord(
            baseParams.messageId,
            baseParams.localId,
            baseParams.createdAt,
            {
                type: 'output',
                data: {
                    type: 'assistant',
                    message: {
                        content: [
                            { type: 'thinking', thinking: '', signature: '' },
                        ],
                    },
                },
            }
        )

        expect(result).not.toBeNull()
        expect(result?.content).toEqual([])
    })

    it('should skip whitespace-only thinking content', () => {
        const result = normalizeAgentRecord(
            baseParams.messageId,
            baseParams.localId,
            baseParams.createdAt,
            {
                type: 'output',
                data: {
                    type: 'assistant',
                    message: {
                        content: [
                            { type: 'thinking', thinking: '   \n\t  ', signature: '' },
                        ],
                    },
                },
            }
        )

        expect(result).not.toBeNull()
        expect(result?.content).toEqual([])
    })

    it('should preserve non-empty thinking content', () => {
        const result = normalizeAgentRecord(
            baseParams.messageId,
            baseParams.localId,
            baseParams.createdAt,
            {
                type: 'output',
                data: {
                    type: 'assistant',
                    message: {
                        content: [
                            { type: 'thinking', thinking: 'Let me analyze this...', signature: '' },
                        ],
                    },
                },
            }
        )

        expect(result).not.toBeNull()
        expect(result?.content).toEqual([
            { type: 'reasoning', text: 'Let me analyze this...', uuid: baseParams.messageId, parentUUID: null }
        ])
    })

    it('should handle user output', () => {
        const result = normalizeAgentRecord(
            baseParams.messageId,
            baseParams.localId,
            baseParams.createdAt,
            {
                type: 'output',
                data: {
                    type: 'user',
                    message: {
                        content: 'User message',
                    },
                },
            }
        )

        expect(result).not.toBeNull()
        expect(result?.role).toBe('user')
    })

    it('should use block.content as tool-result content, not tool_use_result object', () => {
        // 回归：tool_use_result 是结构化元数据（stdout/stderr），不应覆盖 block.content
        const result = normalizeAgentRecord(
            baseParams.messageId,
            baseParams.localId,
            baseParams.createdAt,
            {
                type: 'output',
                data: {
                    type: 'user',
                    message: {
                        role: 'user',
                        content: [
                            {
                                tool_use_id: 'call_abc123',
                                type: 'tool_result',
                                content: '/Users/manerfan/workspace/demo',
                                is_error: false,
                            },
                        ],
                    },
                    tool_use_result: {
                        stdout: '/Users/manerfan/workspace/demo',
                        stderr: '',
                        interrupted: false,
                        isImage: false,
                        noOutputExpected: false,
                    },
                },
            }
        )

        expect(result).not.toBeNull()
        expect(result?.role).toBe('agent')
        if (result && result.role === 'agent') {
            expect(result.content).toHaveLength(1)
            const block = result.content[0]
            expect(block.type).toBe('tool-result')
            // content 应该是字符串，而不是 tool_use_result 对象
            expect(block.content).toBe('/Users/manerfan/workspace/demo')
        }
    })

    it('should handle system:compact_boundary with snake_case metadata', () => {
        const result = normalizeAgentRecord(
            baseParams.messageId,
            baseParams.localId,
            baseParams.createdAt,
            {
                type: 'output',
                data: {
                    type: 'system',
                    subtype: 'compact_boundary',
                    compact_metadata: {
                        trigger: 'manual',
                        pre_tokens: 10000,
                        post_tokens: 2000,
                        duration_ms: 1500,
                    },
                },
            }
        )

        expect(result).not.toBeNull()
        expect(result?.role).toBe('event')
        if (result && 'type' in result.content) {
            expect(result.content.type).toBe('compact')
            expect(result.content).toMatchObject({
                type: 'compact',
                trigger: 'manual',
                preTokens: 10000,
                postTokens: 2000,
                durationMs: 1500,
            })
        }
    })

    it('should handle system:compact_boundary with camelCase metadata', () => {
        const result = normalizeAgentRecord(
            baseParams.messageId,
            baseParams.localId,
            baseParams.createdAt,
            {
                type: 'output',
                data: {
                    type: 'system',
                    subtype: 'compact_boundary',
                    compactMetadata: {
                        trigger: 'auto',
                        preTokens: 5000,
                        postTokens: 1000,
                        durationMs: 800,
                    },
                },
            }
        )

        expect(result).not.toBeNull()
        expect(result?.role).toBe('event')
        if (result && 'type' in result.content) {
            expect(result.content.type).toBe('compact')
            expect(result.content).toMatchObject({
                preTokens: 5000,
                postTokens: 1000,
                durationMs: 800,
            })
        }
    })

    it('should handle system:api_retry', () => {
        const result = normalizeAgentRecord(
            baseParams.messageId,
            baseParams.localId,
            baseParams.createdAt,
            {
                type: 'output',
                data: {
                    type: 'system',
                    subtype: 'api_retry',
                    attempt: 2,
                    max_retries: 3,
                    retry_delay_ms: 1000,
                    error_status: 429,
                    error: 'Rate limited',
                },
            }
        )

        expect(result).not.toBeNull()
        expect(result?.role).toBe('event')
        if (result && 'type' in result.content) {
            expect(result.content.type).toBe('api-retry')
        }
    })

    it('should handle result with aborted_streaming', () => {
        const result = normalizeAgentRecord(
            baseParams.messageId,
            baseParams.localId,
            baseParams.createdAt,
            {
                type: 'output',
                data: {
                    type: 'result',
                    terminal_reason: 'aborted_streaming',
                    num_turns: 5,
                },
            }
        )

        expect(result).not.toBeNull()
        expect(result?.role).toBe('event')
        if (result && 'type' in result.content) {
            expect(result.content.type).toBe('aborted')
        }
    })

    it('should handle result with success and return turn-result event', () => {
        const result = normalizeAgentRecord(
            baseParams.messageId,
            baseParams.localId,
            baseParams.createdAt,
            {
                type: 'output',
                data: {
                    type: 'result',
                    subtype: 'success',
                    duration_ms: 134000,
                    num_turns: 5,
                    total_cost_usd: 0.05,
                    usage: {
                        input_tokens: 12300,
                        output_tokens: 4500,
                        cache_creation_input_tokens: null,
                        cache_read_input_tokens: null,
                    },
                    is_error: false,
                    stop_reason: null,
                },
            }
        )

        expect(result).not.toBeNull()
        expect(result?.role).toBe('event')
        if (result && 'type' in result.content) {
            expect(result.content.type).toBe('turn-result')
            expect(result.content.durationMs).toBe(134000)
            expect(result.content.tokens).toBe(16800) // 12300 + 4500
            expect(result.content.error).toBeUndefined()
        }
    })

    it('should handle result with error and return turn-result event with error', () => {
        const result = normalizeAgentRecord(
            baseParams.messageId,
            baseParams.localId,
            baseParams.createdAt,
            {
                type: 'output',
                data: {
                    type: 'result',
                    subtype: 'error_max_turns',
                    duration_ms: 45200,
                    num_turns: 10,
                    total_cost_usd: 0.1,
                    usage: {
                        input_tokens: 8100,
                        output_tokens: 2200,
                    },
                    is_error: true,
                    stop_reason: null,
                    errors: ['reached maximum turns (15)'],
                },
            }
        )

        expect(result).not.toBeNull()
        expect(result?.role).toBe('event')
        if (result && 'type' in result.content) {
            expect(result.content.type).toBe('turn-result')
            expect(result.content.durationMs).toBe(45200)
            expect(result.content.tokens).toBe(10300) // 8100 + 2200
            expect(result.content.error).toBe('reached maximum turns (15)')
        }
    })

    it('should handle event type content', () => {
        const result = normalizeAgentRecord(
            baseParams.messageId,
            baseParams.localId,
            baseParams.createdAt,
            {
                type: 'event',
                data: {
                    type: 'ready',
                },
            }
        )

        expect(result).not.toBeNull()
        expect(result?.role).toBe('event')
    })

    it('should handle result with error but empty errors array', () => {
        const result = normalizeAgentRecord(
            baseParams.messageId,
            baseParams.localId,
            baseParams.createdAt,
            {
                type: 'output',
                data: {
                    type: 'result',
                    subtype: 'error_during_execution',
                    duration_ms: 5000,
                    usage: { input_tokens: 500, output_tokens: 200 },
                    is_error: true,
                    errors: [],
                },
            }
        )

        expect(result).not.toBeNull()
        expect(result?.role).toBe('event')
        if (result && 'type' in result.content) {
            expect(result.content.type).toBe('turn-result')
            expect(result.content.durationMs).toBe(5000)
            expect(result.content.tokens).toBe(700)
            expect(result.content.error).toBe('error_during_execution') // fallback to subtype
        }
    })

    it('should handle result with error but no errors field', () => {
        const result = normalizeAgentRecord(
            baseParams.messageId,
            baseParams.localId,
            baseParams.createdAt,
            {
                type: 'output',
                data: {
                    type: 'result',
                    is_error: true,
                },
            }
        )

        expect(result).not.toBeNull()
        expect(result?.role).toBe('event')
        if (result && 'type' in result.content) {
            expect(result.content.type).toBe('turn-result')
            expect(result.content.durationMs).toBe(0) // default when missing
            expect(result.content.tokens).toBe(0) // default when missing
            expect(result.content.error).toBe('unknown error') // final fallback
        }
    })

    it('should handle system:task_started', () => {
        const result = normalizeAgentRecord(
            baseParams.messageId, baseParams.localId, baseParams.createdAt,
            { type: 'output', data: { type: 'system', subtype: 'task_started', task_id: 'bg-1', description: 'npm test', uuid: 'u1', session_id: 's1' } }
        )
        expect(result?.role).toBe('event')
        if (result && 'type' in result.content) {
            expect(result.content.type).toBe('bg-task-started')
            if ('taskId' in result.content) expect(result.content.taskId).toBe('bg-1')
        }
    })

    it('should handle system:task_updated', () => {
        const result = normalizeAgentRecord(
            baseParams.messageId, baseParams.localId, baseParams.createdAt,
            { type: 'output', data: { type: 'system', subtype: 'task_updated', task_id: 'bg-1', patch: { status: 'running' }, uuid: 'u1', session_id: 's1' } }
        )
        expect(result?.role).toBe('event')
        if (result && 'type' in result.content) {
            expect(result.content.type).toBe('bg-task-updated')
            if ('taskId' in result.content) expect(result.content.taskId).toBe('bg-1')
        }
    })

    it('should extract summary from task_progress', () => {
        const result = normalizeAgentRecord(
            baseParams.messageId, baseParams.localId, baseParams.createdAt,
            {
                type: 'output',
                data: {
                    type: 'system',
                    subtype: 'task_progress',
                    tool_use_id: 'tool-123',
                    usage: { total_tokens: 100, tool_uses: 5, duration_ms: 2000 },
                    summary: 'Analyzing codebase structure',
                },
            }
        )

        expect(result?.role).toBe('event')
        if (result && 'type' in result.content) {
            expect(result.content.type).toBe('agent-progress')
            expect((result.content as any).summary).toBe('Analyzing codebase structure')
        }
    })

    it('should handle task_progress without summary', () => {
        const result = normalizeAgentRecord(
            baseParams.messageId, baseParams.localId, baseParams.createdAt,
            {
                type: 'output',
                data: {
                    type: 'system',
                    subtype: 'task_progress',
                    tool_use_id: 'tool-456',
                    usage: { total_tokens: 50, tool_uses: 2, duration_ms: 1000 },
                },
            }
        )

        expect(result?.role).toBe('event')
        if (result && 'type' in result.content) {
            expect(result.content.type).toBe('agent-progress')
            expect((result.content as any).summary).toBeUndefined()
        }
    })

    it('tool_progress 产出 tool-progress 事件（toolUseId 取自 parent_tool_use_id）', () => {
        const result = normalizeAgentRecord(
            baseParams.messageId, baseParams.localId, baseParams.createdAt,
            {
                type: 'output',
                data: {
                    type: 'tool_progress',
                    parent_tool_use_id: 'call_abc',
                    tool_use_id: 'call_abc-heartbeat-0',
                    tool_name: 'Bash',
                    elapsed_time_seconds: 30,
                    heartbeat: true,
                },
            }
        )
        expect(result?.role).toBe('event')
        if (result && 'type' in result.content) {
            expect(result.content.type).toBe('tool-progress')
            expect((result.content as any).toolUseId).toBe('call_abc')
            expect((result.content as any).elapsedSeconds).toBe(30)
            expect((result.content as any).toolName).toBe('Bash')
        }
    })

    it('tool_progress sidechain 跳过（主线程不挂，留待 Phase 2 子视图）', () => {
        const result = normalizeAgentRecord(
            baseParams.messageId, baseParams.localId, baseParams.createdAt,
            {
                type: 'output',
                data: {
                    type: 'tool_progress',
                    parent_tool_use_id: 'call_abc',
                    elapsed_time_seconds: 30,
                    isSidechain: true,
                },
            }
        )
        expect(result).toBeNull()
    })

    it('tool_progress 缺 parent_tool_use_id 跳过', () => {
        const result = normalizeAgentRecord(
            baseParams.messageId, baseParams.localId, baseParams.createdAt,
            { type: 'output', data: { type: 'tool_progress', elapsed_time_seconds: 30 } }
        )
        expect(result).toBeNull()
    })

    it('tool_use_summary 产出 tool-use-summary 事件', () => {
        const result = normalizeAgentRecord(
            baseParams.messageId, baseParams.localId, baseParams.createdAt,
            {
                type: 'output',
                data: {
                    type: 'tool_use_summary',
                    summary: 'Ran tests and fixed 2 failures',
                    preceding_tool_use_ids: ['call_a', 'call_b'],
                },
            }
        )
        expect(result?.role).toBe('event')
        if (result && 'type' in result.content) {
            expect(result.content.type).toBe('tool-use-summary')
            expect((result.content as any).summary).toBe('Ran tests and fixed 2 failures')
            expect((result.content as any).toolUseIds).toEqual(['call_a', 'call_b'])
        }
    })

    it('tool_use_summary 空 preceding_tool_use_ids 跳过', () => {
        const result = normalizeAgentRecord(
            baseParams.messageId, baseParams.localId, baseParams.createdAt,
            { type: 'output', data: { type: 'tool_use_summary', summary: 'x', preceding_tool_use_ids: [] } }
        )
        expect(result).toBeNull()
    })

    it('tool_progress 兼容 camelCase 字段（parentToolUseId / elapsedTimeSeconds / toolName）', () => {
        // SDK 字段下划线/驼峰两种格式都可能下发，handler 走 getField 兼容（web/CLAUDE.md 规范）
        const result = normalizeAgentRecord(
            baseParams.messageId, baseParams.localId, baseParams.createdAt,
            {
                type: 'output',
                data: {
                    type: 'tool_progress',
                    parentToolUseId: 'call_abc',
                    elapsedTimeSeconds: 25,
                    toolName: 'Bash',
                },
            }
        )
        expect(result?.role).toBe('event')
        if (result && 'type' in result.content) {
            expect(result.content.type).toBe('tool-progress')
            expect((result.content as any).toolUseId).toBe('call_abc')
            expect((result.content as any).elapsedSeconds).toBe(25)
            expect((result.content as any).toolName).toBe('Bash')
        }
    })

    it('tool_use_summary 兼容 camelCase 字段（precedingToolUseIds）', () => {
        const result = normalizeAgentRecord(
            baseParams.messageId, baseParams.localId, baseParams.createdAt,
            {
                type: 'output',
                data: {
                    type: 'tool_use_summary',
                    summary: 'Ran tests',
                    precedingToolUseIds: ['call_a', 'call_b'],
                },
            }
        )
        expect(result?.role).toBe('event')
        if (result && 'type' in result.content) {
            expect(result.content.type).toBe('tool-use-summary')
            expect((result.content as any).toolUseIds).toEqual(['call_a', 'call_b'])
        }
    })
})

describe('isSkippableAgentContent', () => {
    it('should return false for non-object content', () => {
        expect(isSkippableAgentContent(null)).toBe(false)
        expect(isSkippableAgentContent('string')).toBe(false)
        expect(isSkippableAgentContent(123)).toBe(false)
    })

    it('should return false for non-output type', () => {
        expect(isSkippableAgentContent({ type: 'event' })).toBe(false)
    })

    it('should return true for isMeta content', () => {
        expect(isSkippableAgentContent({
            type: 'output',
            data: { type: 'assistant', isMeta: true },
        })).toBe(true)
    })

    it('should return true for isCompactSummary content', () => {
        expect(isSkippableAgentContent({
            type: 'output',
            data: { type: 'user', isCompactSummary: true },
        })).toBe(true)
    })

    it('tool_progress 已接入 handler，isSkippable 返回 false', () => {
        expect(isSkippableAgentContent({
            type: 'output',
            data: { type: 'tool_progress', heartbeat: true, tool_name: 'Bash' },
        })).toBe(false)
        expect(isSkippableAgentContent({
            type: 'output',
            data: { type: 'tool_progress' },
        })).toBe(false)
    })

    it('tool_use_summary 已接入 handler，isSkippable 返回 false', () => {
        expect(isSkippableAgentContent({
            type: 'output',
            data: { type: 'tool_use_summary' },
        })).toBe(false)
    })
})
