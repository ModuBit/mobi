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
 * Tests for SDK to Log converter
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { SDKToLogConverter, convertSDKToLog } from '@/claude/utils/sdkToLogConverter'
import type { SDKMessage, SDKUserMessage, SDKAssistantMessage, SDKSystemMessage, SDKResultMessage } from '@anthropic-ai/claude-agent-sdk'
import type { ClaudePermissionMode } from '@mobi/shared/types'

// 辅助函数：创建简化版的 SDKUserMessage（用于测试）
function createUserMessage(content: string | unknown[]): SDKUserMessage {
    return {
        type: 'user',
        message: {
            role: 'user',
            content: typeof content === 'string' ? content : content as any
        },
        parent_tool_use_id: null,
        session_id: 'test-session'
    } as SDKUserMessage
}

// 辅助函数：创建简化版的 SDKAssistantMessage（用于测试）
function createAssistantMessage(content: unknown[]): SDKAssistantMessage {
    return {
        type: 'assistant',
        message: {
            role: 'assistant',
            content: content as any
        },
        parent_tool_use_id: null,
        uuid: '00000000-0000-0000-0000-000000000001',
        session_id: 'test-session'
    } as unknown as SDKAssistantMessage
}

describe('SDKToLogConverter', () => {
    let converter: SDKToLogConverter
    const context = {
        sessionId: 'test-session-123',
        cwd: '/test/project',
        version: '1.0.0',
        gitBranch: 'main'
    }

    beforeEach(() => {
        converter = new SDKToLogConverter(context)
    })

    describe('User messages', () => {
        it('should convert SDK user message to log format', () => {
            const sdkMessage = createUserMessage('Hello Claude')

            const logMessage = converter.convert(sdkMessage)

            expect(logMessage).toBeTruthy()
            expect(logMessage?.type).toBe('user')
            expect(logMessage).toMatchObject({
                type: 'user',
                sessionId: context.sessionId,
                cwd: context.cwd,
                version: context.version,
                gitBranch: context.gitBranch,
                parentUuid: null,
                isSidechain: false,
                userType: 'external',
                message: {
                    role: 'user',
                    content: 'Hello Claude'
                }
            })
            expect(logMessage?.uuid).toBeTruthy()
            expect(logMessage?.timestamp).toBeTruthy()
        })

        it('should handle user message with complex content', () => {
            const sdkMessage = createUserMessage([
                { type: 'text', text: 'Check this out' },
                { type: 'tool_result', tool_use_id: 'tool123', content: 'Result data' }
            ])

            const logMessage = converter.convert(sdkMessage)

            expect(logMessage?.type).toBe('user')
            expect((logMessage as any).message.content).toHaveLength(2)
        })
    })

    describe('Assistant messages', () => {
        it('should convert SDK assistant message to log format', () => {
            const sdkMessage = createAssistantMessage([
                { type: 'text', text: 'Hello! How can I help?' }
            ])

            const logMessage = converter.convert(sdkMessage)

            expect(logMessage).toBeTruthy()
            expect(logMessage?.type).toBe('assistant')
            expect(logMessage).toMatchObject({
                type: 'assistant',
                sessionId: context.sessionId,
                message: {
                    role: 'assistant',
                    content: [
                        { type: 'text', text: 'Hello! How can I help?' }
                    ]
                }
            })
        })

        it('should include requestId if present', () => {
            const sdkMessage: any = {
                type: 'assistant',
                message: {
                    role: 'assistant',
                    content: [{ type: 'text', text: 'Response' }]
                },
                requestId: 'req_123',
                parent_tool_use_id: null,
                uuid: '00000000-0000-0000-0000-000000000002',
                session_id: 'test-session'
            }

            const logMessage = converter.convert(sdkMessage)

            expect((logMessage as any).requestId).toBe('req_123')
        })
    })

    describe('System messages', () => {
        it('should convert SDK system message to log format', () => {
            const sdkMessage = {
                type: 'system',
                subtype: 'init',
                session_id: 'new-session-456',
                model: 'claude-opus-4',
                cwd: '/project',
                tools: ['bash', 'edit'],
                apiKeySource: 'user',
                claude_code_version: '1.0.0',
                mcp_servers: [],
                permissionMode: 'default',
                output_style: 'default',
                slash_commands: [],
                skills: [],
                plugins: [],
                hasCustomSystemPrompt: false,
                uuid: '00000000-0000-0000-0000-000000000003',
            } as unknown as SDKSystemMessage

            const logMessage = converter.convert(sdkMessage)

            expect(logMessage).toBeTruthy()
            expect(logMessage?.type).toBe('system')
            expect(logMessage).toMatchObject({
                type: 'system',
                subtype: 'init',
                model: 'claude-opus-4',
                tools: ['bash', 'edit']
            })
        })

        it('should update session ID on init system message', () => {
            const sdkMessage = {
                type: 'system',
                subtype: 'init',
                session_id: 'updated-session-789',
                apiKeySource: 'user',
                claude_code_version: '1.0.0',
                cwd: '/project',
                tools: [],
                mcp_servers: [],
                permissionMode: 'default',
                output_style: 'default',
                slash_commands: [],
                skills: [],
                plugins: [],
                hasCustomSystemPrompt: false,
                model: 'claude-opus-4',
                uuid: '00000000-0000-0000-0000-000000000004',
            } as unknown as SDKSystemMessage

            converter.convert(sdkMessage)

            // Next message should have updated session ID
            const userMessage = createUserMessage('Test')

            const logMessage = converter.convert(userMessage)
            expect(logMessage?.sessionId).toBe('updated-session-789')
        })
    })

    describe('Result messages', () => {
        it('should convert success result messages', () => {
            const sdkMessage = {
                type: 'result',
                subtype: 'success',
                result: 'Task completed',
                num_turns: 5,
                usage: {
                    input_tokens: 12300,
                    output_tokens: 4500,
                    cache_creation_input_tokens: null,
                    cache_read_input_tokens: null,
                },
                total_cost_usd: 0.05,
                duration_ms: 134000,
                duration_api_ms: 120000,
                is_error: false,
                session_id: 'result-session',
                stop_reason: null,
                modelUsage: {},
                permission_denials: [],
                uuid: '00000000-0000-0000-0000-000000000005',
            } as unknown as SDKResultMessage

            const logMessage = converter.convert(sdkMessage)

            expect(logMessage).not.toBeNull()
            expect(logMessage?.type).toBe('system')
            expect(logMessage?.subtype).toBe('turn_result')
            expect(logMessage?.duration_ms).toBe(134000)
            expect(logMessage?.usage).toEqual({
                input_tokens: 12300,
                output_tokens: 4500,
                cache_creation_input_tokens: null,
                cache_read_input_tokens: null,
            })
            expect(logMessage?.is_error).toBe(false)
        })

        it('should convert error result messages with errors array', () => {
            const sdkMessage = {
                type: 'result',
                subtype: 'error_max_turns',
                num_turns: 10,
                total_cost_usd: 0.1,
                duration_ms: 45200,
                duration_api_ms: 40000,
                is_error: true,
                session_id: 'error-session',
                stop_reason: null,
                usage: { input_tokens: 8100, output_tokens: 2200 },
                modelUsage: {},
                permission_denials: [],
                errors: ['reached maximum turns (15)'],
                uuid: '00000000-0000-0000-0000-000000000006',
            } as unknown as SDKResultMessage

            const logMessage = converter.convert(sdkMessage)

            expect(logMessage).not.toBeNull()
            expect(logMessage?.type).toBe('system')
            expect(logMessage?.subtype).toBe('turn_result')
            expect(logMessage?.is_error).toBe(true)
            expect(logMessage?.errors).toEqual(['reached maximum turns (15)'])
        })
    })

    describe('Parent-child relationships', () => {
        it('should track parent UUIDs across messages', () => {
            const msg1 = createUserMessage('First')
            const msg2 = createAssistantMessage([{ type: 'text', text: 'Second' }])
            const msg3 = createUserMessage('Third')

            const log1 = converter.convert(msg1)
            const log2 = converter.convert(msg2)
            const log3 = converter.convert(msg3)

            expect(log1?.parentUuid).toBeNull()
            expect(log2?.parentUuid).toBe(log1?.uuid)
            expect(log3?.parentUuid).toBe(log2?.uuid)
        })

        it('should reset parent chain when requested', () => {
            const msg1 = createUserMessage('First')
            const log1 = converter.convert(msg1)

            converter.resetParentChain()

            const msg2 = createUserMessage('Second')
            const log2 = converter.convert(msg2)

            expect(log2?.parentUuid).toBeNull()
        })
    })

    describe('Batch conversion', () => {
        it('should convert multiple messages maintaining relationships', () => {
            const messages: SDKMessage[] = [
                createUserMessage('Hello'),
                createAssistantMessage([{ type: 'text', text: 'Hi there!' }]),
                createUserMessage('How are you?')
            ]

            const logMessages = converter.convertMany(messages)

            expect(logMessages).toHaveLength(3)
            expect(logMessages[0].parentUuid).toBeNull()
            expect(logMessages[1].parentUuid).toBe(logMessages[0].uuid)
            expect(logMessages[2].parentUuid).toBe(logMessages[1].uuid)
        })
    })

    describe('Convenience function', () => {
        it('should convert single message without state', () => {
            const sdkMessage = createUserMessage('Test message')

            const logMessage = convertSDKToLog(sdkMessage, context)

            expect(logMessage).toBeTruthy()
            expect(logMessage?.type).toBe('user')
            expect(logMessage?.parentUuid).toBeNull()
        })
    })

    describe('Tool results with mode', () => {
        it('should add mode to tool result when available in responses', () => {
            const responses = new Map<string, { approved: boolean; mode?: ClaudePermissionMode; reason?: string }>()
            responses.set('tool_123', { approved: true, mode: 'acceptEdits' })

            const converterWithResponses = new SDKToLogConverter(context, responses)

            const sdkMessage = createUserMessage([{
                type: 'tool_result',
                tool_use_id: 'tool_123',
                content: 'Tool executed successfully'
            }])

            const logMessage = converterWithResponses.convert(sdkMessage)

            expect(logMessage).toBeTruthy()
            expect((logMessage as any).mode).toBe('acceptEdits')
            expect((logMessage as any).toolUseResult).toBeUndefined() // toolUseResult is not added when using array content
        })

        it('should not add mode when not in responses', () => {
            const responses = new Map<string, { approved: boolean; mode?: ClaudePermissionMode; reason?: string }>()

            const converterWithResponses = new SDKToLogConverter(context, responses)

            const sdkMessage = createUserMessage([{
                type: 'tool_result',
                tool_use_id: 'tool_456',
                content: 'Tool result'
            }])

            const logMessage = converterWithResponses.convert(sdkMessage)

            expect(logMessage).toBeTruthy()
            expect((logMessage as any).mode).toBeUndefined()
            expect((logMessage as any).toolUseResult).toBeUndefined() // toolUseResult is not added when using array content
        })

        it('should handle mixed content with tool results', () => {
            const responses = new Map<string, { approved: boolean; mode?: ClaudePermissionMode; reason?: string }>()
            responses.set('tool_789', { approved: true, mode: 'bypassPermissions' })

            const converterWithResponses = new SDKToLogConverter(context, responses)

            const sdkMessage = createUserMessage([
                { type: 'text', text: 'Here is the result:' },
                {
                    type: 'tool_result',
                    tool_use_id: 'tool_789',
                    content: 'Tool output'
                }
            ])

            const logMessage = converterWithResponses.convert(sdkMessage)

            expect(logMessage).toBeTruthy()
            expect((logMessage as any).mode).toBe('bypassPermissions')
            expect((logMessage as any).toolUseResult).toBeUndefined() // toolUseResult is not added when using array content
        })

        it('should work with convenience function', () => {
            const responses = new Map<string, { approved: boolean; mode?: ClaudePermissionMode; reason?: string }>()
            responses.set('tool_abc', { approved: false, mode: 'plan', reason: 'User rejected' })

            const sdkMessage = createUserMessage([{
                type: 'tool_result',
                tool_use_id: 'tool_abc',
                content: 'Permission denied'
            }])

            const logMessage = convertSDKToLog(sdkMessage, context, responses)

            expect(logMessage).toBeTruthy()
            expect((logMessage as any).mode).toBe('plan')
        })
    })
})
