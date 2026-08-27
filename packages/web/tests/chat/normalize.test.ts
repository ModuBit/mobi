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
 * normalize 单元测试
 * 测试 normalizeDecryptedMessage 函数的各种输入场景
 */

import { describe, expect, it, vi } from 'vitest'
import { normalizeDecryptedMessage } from '@/domain/chat/normalize'
import { normalizeUserRecord } from '@/domain/chat/normalizeUser'
import type { DecryptedMessage } from '@/core/data/api/types'

// 抑制 console.warn 输出
describe('normalizeDecryptedMessage', () => {
    it('应解析 assistant 文本消息', () => {
        const message: DecryptedMessage = {
            id: 'msg-1',
            seq: 1,
            localId: null,
            createdAt: 1000,
            content: {
                role: 'agent',
                content: {
                    type: 'output',
                    data: {
                        type: 'assistant',
                        message: {
                            content: 'Hello from assistant',
                        },
                    },
                },
            },
        }

        const result = normalizeDecryptedMessage(message)
        expect(result).not.toBeNull()
        expect(result!.role).toBe('agent')
        expect(result!.id).toBe('msg-1')
        expect(result!.isSidechain).toBe(false)
        // agent 消息 content 应是数组
        const content = result!.content as Array<{ type: string; text: string }>
        expect(Array.isArray(content)).toBe(true)
        expect(content[0]?.type).toBe('text')
        expect(content[0]?.text).toBe('Hello from assistant')
    })

    it('应解析 user 文本消息', () => {
        const message: DecryptedMessage = {
            id: 'msg-2',
            seq: 2,
            localId: null,
            createdAt: 2000,
            content: {
                role: 'user',
                content: '用户输入文本',
            },
        }

        const result = normalizeDecryptedMessage(message)
        expect(result).not.toBeNull()
        expect(result!.role).toBe('user')
        expect(result!.id).toBe('msg-2')
        const content = result!.content as { type: string; blocks: Array<{ type: string; text: string }> }
        expect(content.type).toBe('text')
        expect(content.blocks).toEqual([{ type: 'text', text: '用户输入文本' }])
    })

    it('应解析包含 tool_use 的消息', () => {
        const message: DecryptedMessage = {
            id: 'msg-3',
            seq: 3,
            localId: null,
            createdAt: 3000,
            content: {
                role: 'agent',
                content: {
                    type: 'output',
                    data: {
                        type: 'assistant',
                        message: {
                            content: [
                                { type: 'text', text: '让我查看文件' },
                                {
                                    type: 'tool_use',
                                    id: 'tool-1',
                                    name: 'Read',
                                    input: { file_path: '/test.ts' },
                                },
                            ],
                        },
                    },
                },
            },
        }

        const result = normalizeDecryptedMessage(message)
        expect(result).not.toBeNull()
        expect(result!.role).toBe('agent')
        const content = result!.content as Array<{ type: string; [key: string]: unknown }>
        expect(content).toHaveLength(2)
        expect(content[0]?.type).toBe('text')
        expect(content[1]?.type).toBe('tool-call')
        if (content[1]?.type === 'tool-call') {
            expect(content[1].id).toBe('tool-1')
            expect(content[1].name).toBe('Read')
        }
    })

    it('应解析包含 tool_result 的消息', () => {
        const message: DecryptedMessage = {
            id: 'msg-4',
            seq: 4,
            localId: null,
            createdAt: 4000,
            content: {
                role: 'agent',
                content: {
                    type: 'output',
                    data: {
                        type: 'user',
                        message: {
                            content: [
                                {
                                    type: 'tool_result',
                                    tool_use_id: 'tool-1',
                                    content: '文件内容',
                                    is_error: false,
                                },
                            ],
                        },
                    },
                },
            },
        }

        const result = normalizeDecryptedMessage(message)
        expect(result).not.toBeNull()
        expect(result!.role).toBe('agent')
        const content = result!.content as Array<{ type: string; [key: string]: unknown }>
        expect(content).toHaveLength(1)
        expect(content[0]?.type).toBe('tool-result')
        if (content[0]?.type === 'tool-result') {
            expect(content[0].tool_use_id).toBe('tool-1')
        }
    })

    it('应跳过 isMeta 消息（返回 null）', () => {
        const message: DecryptedMessage = {
            id: 'msg-meta',
            seq: 5,
            localId: null,
            createdAt: 5000,
            content: {
                role: 'agent',
                content: {
                    type: 'output',
                    data: {
                        type: 'assistant',
                        isMeta: true,
                        message: { content: 'meta message' },
                    },
                },
            },
        }

        const result = normalizeDecryptedMessage(message)
        expect(result).toBeNull()
    })

    it('应跳过 isCompactSummary 消息（返回 null）', () => {
        const message: DecryptedMessage = {
            id: 'msg-compact',
            seq: 6,
            localId: null,
            createdAt: 6000,
            content: {
                role: 'agent',
                content: {
                    type: 'output',
                    data: {
                        type: 'assistant',
                        isCompactSummary: true,
                        message: { content: 'compact summary' },
                    },
                },
            },
        }

        const result = normalizeDecryptedMessage(message)
        expect(result).toBeNull()
    })

    it('主线程 tool_progress 心跳产出 tool-progress 事件（不再走 JSON dump 兜底）', () => {
        // 曾因无 handler 落入 JSON dump 被整段渲染成文本；接入 handler 后产出 tool-progress 事件，
        // 由 reducer 校准对应工具卡片 startedAt
        const message: DecryptedMessage = {
            id: 'msg-tool-progress',
            seq: 60,
            localId: null,
            createdAt: 60000,
            content: {
                role: 'agent',
                content: {
                    type: 'output',
                    data: {
                        type: 'tool_progress',
                        heartbeat: true,
                        tool_name: 'Bash',
                        parent_tool_use_id: 'call_86796e05',
                        tool_use_id: 'call_86796e05-heartbeat-0',
                        elapsed_time_seconds: 30,
                    },
                },
            },
        }

        const result = normalizeDecryptedMessage(message)
        expect(result).not.toBeNull()
        expect(result!.role).toBe('event')
        expect((result!.content as { type: string }).type).toBe('tool-progress')
    })

    it('sidechain tool_progress 跳过（主线程不挂，返回 null）', () => {
        const message: DecryptedMessage = {
            id: 'msg-tool-progress-sc',
            seq: 61,
            localId: null,
            createdAt: 61000,
            content: {
                role: 'agent',
                content: {
                    type: 'output',
                    data: {
                        type: 'tool_progress',
                        parent_tool_use_id: 'call_sc',
                        elapsed_time_seconds: 30,
                        isSidechain: true,
                    },
                },
            },
        }

        const result = normalizeDecryptedMessage(message)
        expect(result).toBeNull()
    })

    it('tool_use_summary 产出 tool-use-summary 事件', () => {
        const message: DecryptedMessage = {
            id: 'msg-tool-use-summary',
            seq: 62,
            localId: null,
            createdAt: 62000,
            content: {
                role: 'agent',
                content: {
                    type: 'output',
                    data: {
                        type: 'tool_use_summary',
                        summary: 'Ran tests and fixed 2 failures',
                        preceding_tool_use_ids: ['call_a', 'call_b'],
                    },
                },
            },
        }

        const result = normalizeDecryptedMessage(message)
        expect(result).not.toBeNull()
        expect(result!.role).toBe('event')
        expect((result!.content as { type: string }).type).toBe('tool-use-summary')
    })

    it('应处理无法解包的消息（兜底为 JSON dump）', () => {
        const message: DecryptedMessage = {
            id: 'msg-raw',
            seq: 7,
            localId: null,
            createdAt: 7000,
            content: '纯字符串内容',
        }

        const result = normalizeDecryptedMessage(message)
        expect(result).not.toBeNull()
        expect(result!.role).toBe('agent')
        expect(result!.id).toBe('msg-raw')
        // 兜底处理：content 应为 text 数组
        const content = result!.content as Array<{ type: string; text: string }>
        expect(content[0]?.type).toBe('text')
        expect(content[0]?.text).toContain('纯字符串内容')
    })

    it('应处理包含 { type: "text", text } 结构的 user 消息', () => {
        const message: DecryptedMessage = {
            id: 'msg-text',
            seq: 8,
            localId: null,
            createdAt: 8000,
            content: {
                role: 'user',
                content: {
                    type: 'text',
                    text: '结构化文本消息',
                },
            },
        }

        const result = normalizeDecryptedMessage(message)
        expect(result).not.toBeNull()
        expect(result!.role).toBe('user')
        const content = result!.content as { type: string; blocks: Array<{ type: string; text: string }> }
        expect(content.type).toBe('text')
        expect(content.blocks).toEqual([{ type: 'text', text: '结构化文本消息' }])
    })

    it('应解析 event 类型消息', () => {
        const message: DecryptedMessage = {
            id: 'msg-event',
            seq: 9,
            localId: null,
            createdAt: 9000,
            content: {
                role: 'agent',
                content: {
                    type: 'event',
                    data: {
                        type: 'switch',
                        mode: 'remote',
                    },
                },
            },
        }

        const result = normalizeDecryptedMessage(message)
        expect(result).not.toBeNull()
        expect(result!.role).toBe('event')
        const content = result!.content as { type: string; mode: string }
        expect(content.type).toBe('switch')
        expect(content.mode).toBe('remote')
    })

    it('应保留 message 的 status 和 originalText', () => {
        const message: DecryptedMessage = {
            id: 'msg-status',
            seq: 10,
            localId: 'local-1',
            createdAt: 10000,
            content: {
                role: 'user',
                content: '带状态的消息',
            },
            status: 'sending',
            originalText: '原始文本',
        }

        const result = normalizeDecryptedMessage(message)
        expect(result).not.toBeNull()
        expect(result!.status).toBe('sending')
        expect(result!.originalText).toBe('原始文本')
        expect(result!.localId).toBe('local-1')
    })

    it('应解析包含 thinking 块的 assistant 消息', () => {
        const message: DecryptedMessage = {
            id: 'msg-thinking',
            seq: 11,
            localId: null,
            createdAt: 11000,
            content: {
                role: 'agent',
                content: {
                    type: 'output',
                    data: {
                        type: 'assistant',
                        message: {
                            content: [
                                { type: 'thinking', thinking: '深度思考中...' },
                                { type: 'text', text: '回答' },
                            ],
                        },
                    },
                },
            },
        }

        const result = normalizeDecryptedMessage(message)
        expect(result).not.toBeNull()
        const content = result!.content as Array<{ type: string; text: string }>
        expect(content[0]?.type).toBe('reasoning')
        expect(content[0]?.text).toBe('深度思考中...')
        expect(content[1]?.type).toBe('text')
    })

    it('应解析 summary 类型消息', () => {
        const message: DecryptedMessage = {
            id: 'msg-summary',
            seq: 12,
            localId: null,
            createdAt: 12000,
            content: {
                role: 'agent',
                content: {
                    type: 'output',
                    data: {
                        type: 'summary',
                        summary: '这是会话摘要',
                    },
                },
            },
        }

        const result = normalizeDecryptedMessage(message)
        expect(result).not.toBeNull()
        const content = result!.content as Array<{ type: string; summary: string }>
        expect(content[0]?.type).toBe('summary')
        expect(content[0]?.summary).toBe('这是会话摘要')
    })

    it('应解析 result 类型的 aborted 消息为 event', () => {
        const message: DecryptedMessage = {
            id: 'msg-aborted',
            seq: 13,
            localId: null,
            createdAt: 13000,
            content: {
                role: 'agent',
                content: {
                    type: 'output',
                    data: {
                        type: 'result',
                        terminal_reason: 'aborted_streaming',
                        num_turns: 5,
                    },
                },
            },
        }

        const result = normalizeDecryptedMessage(message)
        expect(result).not.toBeNull()
        expect(result!.role).toBe('event')
        const content = result!.content as { type: string; numTurns: number }
        expect(content.type).toBe('aborted')
        expect(content.numTurns).toBe(5)
    })

    it('应解析 result 类型的 error 消息为 turn-result event', () => {
        const message: DecryptedMessage = {
            id: 'msg-exec-error',
            seq: 14,
            localId: null,
            createdAt: 14000,
            content: {
                role: 'agent',
                content: {
                    type: 'output',
                    data: {
                        type: 'result',
                        subtype: 'error_during_execution',
                        is_error: true,
                        errors: ['发生错误'],
                        num_turns: 3,
                    },
                },
            },
        }

        const result = normalizeDecryptedMessage(message)
        expect(result).not.toBeNull()
        expect(result!.role).toBe('event')
        const content = result!.content as { type: string; error: string }
        expect(content.type).toBe('turn-result')
        expect(content.error).toBe('发生错误')
    })

    it('应解析正常完成的 result 消息为 turn-result event', () => {
        const message: DecryptedMessage = {
            id: 'msg-result-ok',
            seq: 15,
            localId: null,
            createdAt: 15000,
            content: {
                role: 'agent',
                content: {
                    type: 'output',
                    data: {
                        type: 'result',
                        subtype: 'success',
                        duration_ms: 5000,
                        usage: {
                            input_tokens: 1000,
                            output_tokens: 500,
                        },
                    },
                },
            },
        }

        const result = normalizeDecryptedMessage(message)
        expect(result).not.toBeNull()
        expect(result!.role).toBe('event')
        const content = result!.content as { type: string; durationMs: number; tokens: number; error?: string }
        expect(content.type).toBe('turn-result')
        expect(content.durationMs).toBe(5000)
        expect(content.tokens).toBe(1500)
        expect(content.error).toBeUndefined()
    })

    it('应解析 api_error 系统事件', () => {
        const message: DecryptedMessage = {
            id: 'msg-api-error',
            seq: 16,
            localId: null,
            createdAt: 16000,
            content: {
                role: 'agent',
                content: {
                    type: 'output',
                    data: {
                        type: 'system',
                        subtype: 'api_error',
                        retryAttempt: 2,
                        maxRetries: 5,
                        error: { message: 'timeout' },
                    },
                },
            },
        }

        const result = normalizeDecryptedMessage(message)
        expect(result).not.toBeNull()
        expect(result!.role).toBe('event')
        const content = result!.content as { type: string; retryAttempt: number; maxRetries: number }
        expect(content.type).toBe('api-error')
        expect(content.retryAttempt).toBe(2)
        expect(content.maxRetries).toBe(5)
    })

    it('应解析 api_retry 系统事件', () => {
        const message: DecryptedMessage = {
            id: 'msg-api-retry',
            seq: 18,
            localId: null,
            createdAt: 18000,
            content: {
                role: 'agent',
                content: {
                    type: 'output',
                    data: {
                        type: 'system',
                        subtype: 'api_retry',
                        attempt: 3,
                        max_retries: 10,
                        retry_delay_ms: 15000,
                        error_status: 429,
                        error: 'rate_limit',
                    },
                },
            },
        }

        const result = normalizeDecryptedMessage(message)
        expect(result).not.toBeNull()
        expect(result!.role).toBe('event')
        const content = result!.content as { type: string; attempt: number; maxRetries: number; retryDelayMs: number; errorStatus: number; error: string }
        expect(content.type).toBe('api-retry')
        expect(content.attempt).toBe(3)
        expect(content.maxRetries).toBe(10)
        expect(content.retryDelayMs).toBe(15000)
        expect(content.errorStatus).toBe(429)
        expect(content.error).toBe('rate_limit')
    })

    it('应处理无法识别的 user content 类型（兜底 JSON dump）', () => {
        const message: DecryptedMessage = {
            id: 'msg-unknown-user',
            seq: 17,
            localId: null,
            createdAt: 17000,
            content: {
                role: 'user',
                content: { type: 'image', url: 'http://example.com/img.png' },
            },
        }

        // normalizeUserRecord 对 { type: 'image' } 不认识，返回 null
        // 走兜底：返回 content 为 JSON dump 的 user 消息
        const result = normalizeDecryptedMessage(message)
        expect(result).not.toBeNull()
        expect(result!.role).toBe('user')
    })
})

describe('normalizeUserRecord（blocks 化归一）', () => {
    it('数组 blocks 原样透出', () => {
        const blocks = [
            { type: 'text', text: 'a' },
            { type: 'quote', messageId: 'm', role: 'agent', excerpt: 'e' },
        ] satisfies import('@mobi/shared').UserContentBlock[]
        const m = normalizeUserRecord('id', 'lid', 1, blocks)
        expect(m?.role).toBe('user')
        expect((m?.content as { blocks: unknown }).blocks).toEqual(blocks)
    })

    it('旧平铺对象（含 attachments）→ blocks 含 document', () => {
        const m = normalizeUserRecord('id', 'lid', 1, {
            type: 'text', text: 'a',
            attachments: [{ id: '1', filename: 'f.pdf', mimeType: 'application/pdf', size: 1, path: '/p/f.pdf' }],
        })
        const blocks = (m?.content as { blocks: Array<Record<string, unknown>> }).blocks
        expect(blocks[0]).toEqual({ type: 'text', text: 'a' })
        expect(blocks[1].type).toBe('document')
        expect((blocks[1].source as { value: string }).value).toBe('/p/f.pdf')
    })

    it('畸形输入 → null', () => {
        expect(normalizeUserRecord('id', 'lid', 1, 12345)).toBeNull()
        expect(normalizeUserRecord('id', 'lid', 1, { nonsense: true })).toBeNull()
    })
})
