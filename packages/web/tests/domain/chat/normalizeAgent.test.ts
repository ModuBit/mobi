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
})
