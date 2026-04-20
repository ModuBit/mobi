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
 * messageParser 测试
 */

import { describe, expect, it } from 'vitest'
import type { DecryptedMessage } from '@mobi/shared'
import { isSkippableMessage, parseMessage, parseMessages } from '@/domain/chat/messageParser'

describe('messageParser', () => {
  describe('isSkippableMessage', () => {
    it('应该识别 isMeta 消息', () => {
      const content = {
        type: 'output',
        data: { isMeta: true, type: 'assistant' }
      }
      expect(isSkippableMessage(content)).toBe(true)
    })

    it('应该识别 isCompactSummary 消息', () => {
      const content = {
        type: 'output',
        data: { isCompactSummary: true, type: 'assistant' }
      }
      expect(isSkippableMessage(content)).toBe(true)
    })

    it('不应该跳过普通消息', () => {
      const content = {
        type: 'output',
        data: { type: 'assistant', message: { content: 'hello' } }
      }
      expect(isSkippableMessage(content)).toBe(false)
    })

    it('应该处理非 output 类型', () => {
      const content = { type: 'event', data: { type: 'ready' } }
      expect(isSkippableMessage(content)).toBe(false)
    })

    it('应该处理无效内容', () => {
      expect(isSkippableMessage(null)).toBe(false)
      expect(isSkippableMessage(undefined)).toBe(false)
      expect(isSkippableMessage('string')).toBe(false)
    })
  })

  describe('parseMessage', () => {
    it('应该解析简单文本消息', () => {
      const message: DecryptedMessage = {
        id: 'msg-1',
        seq: 1,
        localId: null,
        createdAt: Date.now(),
        content: {
          type: 'output',
          data: {
            type: 'assistant',
            message: {
              content: 'Hello, this is a simple text message.'
            }
          }
        }
      }

      const result = parseMessage(message)
      expect(result).not.toBeNull()
      expect(result?.id).toBe('msg-1')
      expect(result?.role).toBe('assistant')
      expect(result?.content).toHaveLength(1)
      expect(result?.content[0]).toEqual({
        type: 'text',
        text: 'Hello, this is a simple text message.'
      })
    })

    it('应该解析包含 tool_use 的消息', () => {
      const message: DecryptedMessage = {
        id: 'msg-2',
        seq: 2,
        localId: null,
        createdAt: Date.now(),
        content: {
          type: 'output',
          data: {
            type: 'assistant',
            message: {
              content: [
                { type: 'text', text: 'Let me check the file.' },
                {
                  type: 'tool_use',
                  id: 'tool-1',
                  name: 'Read',
                  input: { file_path: '/path/to/file.ts' }
                }
              ]
            }
          }
        }
      }

      const result = parseMessage(message)
      expect(result).not.toBeNull()
      expect(result?.content).toHaveLength(2)
      expect(result?.content[0]).toEqual({
        type: 'text',
        text: 'Let me check the file.'
      })
      expect(result?.content[1]).toEqual({
        type: 'tool-call',
        id: 'tool-1',
        name: 'Read',
        input: { file_path: '/path/to/file.ts' },
        description: null
      })
    })

    it('应该解析包含 tool_result 的消息', () => {
      const message: DecryptedMessage = {
        id: 'msg-3',
        seq: 3,
        localId: null,
        createdAt: Date.now(),
        content: {
          type: 'output',
          data: {
            type: 'user',
            message: {
              content: [
                {
                  type: 'tool_result',
                  tool_use_id: 'tool-1',
                  content: 'File content here...',
                  is_error: false
                }
              ]
            }
          }
        }
      }

      const result = parseMessage(message)
      expect(result).not.toBeNull()
      expect(result?.role).toBe('user')
      expect(result?.content).toHaveLength(1)
      expect(result?.content[0]).toEqual({
        type: 'tool-result',
        tool_use_id: 'tool-1',
        content: 'File content here...',
        is_error: false
      })
    })

    it('应该跳过 isMeta 消息', () => {
      const message: DecryptedMessage = {
        id: 'msg-meta',
        seq: 4,
        localId: null,
        createdAt: Date.now(),
        content: {
          type: 'output',
          data: {
            type: 'assistant',
            isMeta: true,
            message: {
              content: 'This is a meta message.'
            }
          }
        }
      }

      const result = parseMessage(message)
      expect(result).toBeNull()
    })

    it('应该处理空消息', () => {
      const message: DecryptedMessage = {
        id: 'msg-empty',
        seq: 5,
        localId: null,
        createdAt: Date.now(),
        content: null as unknown
      }

      const result = parseMessage(message)
      expect(result).toBeNull()
    })

    it('应该处理复杂嵌套结构', () => {
      const message: DecryptedMessage = {
        id: 'msg-complex',
        seq: 6,
        localId: 'local-123',
        createdAt: Date.now(),
        content: {
          type: 'output',
          data: {
            type: 'assistant',
            message: {
              content: [
                { type: 'text', text: 'First text block' },
                { type: 'thinking', thinking: 'Thinking about something...' },
                { type: 'text', text: 'Second text block' },
                {
                  type: 'tool_use',
                  id: 'tool-1',
                  name: 'Bash',
                  input: { command: 'ls -la', description: 'List files' }
                },
                { type: 'text', text: 'Final text block' }
              ]
            }
          }
        }
      }

      const result = parseMessage(message)
      expect(result).not.toBeNull()
      expect(result?.localId).toBe('local-123')
      expect(result?.content).toHaveLength(5)

      // 验证各类型块
      expect(result?.content[0]?.type).toBe('text')
      expect(result?.content[1]?.type).toBe('reasoning')
      expect(result?.content[2]?.type).toBe('text')
      expect(result?.content[3]?.type).toBe('tool-call')
      expect(result?.content[4]?.type).toBe('text')

      // 验证 thinking 块
      const reasoningBlock = result?.content[1]
      if (reasoningBlock?.type === 'reasoning') {
        expect(reasoningBlock.text).toBe('Thinking about something...')
      }

      // 验证 tool-call 块
      const toolCallBlock = result?.content[3]
      if (toolCallBlock?.type === 'tool-call') {
        expect(toolCallBlock.name).toBe('Bash')
        expect(toolCallBlock.description).toBe('List files')
      }
    })

    it('应该解析 user 简单文本消息', () => {
      const message: DecryptedMessage = {
        id: 'msg-user',
        seq: 7,
        localId: null,
        createdAt: Date.now(),
        content: {
          type: 'output',
          data: {
            type: 'user',
            message: {
              content: 'User says hello'
            }
          }
        }
      }

      const result = parseMessage(message)
      expect(result).not.toBeNull()
      expect(result?.role).toBe('user')
      expect(result?.content).toHaveLength(1)
      expect(result?.content[0]).toEqual({
        type: 'text',
        text: 'User says hello'
      })
    })

    it('应该解析 summary 消息', () => {
      const message: DecryptedMessage = {
        id: 'msg-summary',
        seq: 8,
        localId: null,
        createdAt: Date.now(),
        content: {
          type: 'output',
          data: {
            type: 'summary',
            summary: 'This is a summary of the conversation.'
          }
        }
      }

      const result = parseMessage(message)
      expect(result).not.toBeNull()
      expect(result?.role).toBe('assistant')
      expect(result?.content).toHaveLength(1)
      expect(result?.content[0]).toEqual({
        type: 'summary',
        summary: 'This is a summary of the conversation.'
      })
    })

    it('应该解析 event 消息', () => {
      const message: DecryptedMessage = {
        id: 'msg-event',
        seq: 9,
        localId: null,
        createdAt: Date.now(),
        content: {
          type: 'event',
          data: {
            type: 'switch',
            mode: 'remote'
          }
        }
      }

      const result = parseMessage(message)
      expect(result).not.toBeNull()
      expect(result?.role).toBe('system')
      expect(result?.content).toHaveLength(1)
      expect(result?.content[0]).toEqual({
        type: 'event',
        event: { type: 'switch', mode: 'remote' }
      })
    })

    it('应该解析 api_error 系统消息', () => {
      const message: DecryptedMessage = {
        id: 'msg-error',
        seq: 10,
        localId: null,
        createdAt: Date.now(),
        content: {
          type: 'output',
          data: {
            type: 'system',
            subtype: 'api_error',
            retryAttempt: 1,
            maxRetries: 3,
            error: { message: 'Rate limit exceeded' }
          }
        }
      }

      const result = parseMessage(message)
      expect(result).not.toBeNull()
      expect(result?.role).toBe('system')
      expect(result?.content).toHaveLength(1)

      const eventBlock = result?.content[0]
      expect(eventBlock?.type).toBe('event')
      if (eventBlock?.type === 'event') {
        expect(eventBlock.event.type).toBe('api-error')
        expect(eventBlock.event.retryAttempt).toBe(1)
        expect(eventBlock.event.maxRetries).toBe(3)
      }
    })

    it('应该解析 api_retry 系统消息', () => {
      const message: DecryptedMessage = {
        id: 'msg-retry',
        seq: 12,
        localId: null,
        createdAt: Date.now(),
        content: {
          type: 'output',
          data: {
            type: 'system',
            subtype: 'api_retry',
            attempt: 5,
            max_retries: 10,
            retry_delay_ms: 30000,
            error_status: 429,
            error: 'rate_limit'
          }
        }
      }

      const result = parseMessage(message)
      expect(result).not.toBeNull()
      expect(result?.role).toBe('system')
      expect(result?.content).toHaveLength(1)

      const eventBlock = result?.content[0]
      expect(eventBlock?.type).toBe('event')
      if (eventBlock?.type === 'event') {
        expect(eventBlock.event.type).toBe('api-retry')
        expect(eventBlock.event.attempt).toBe(5)
        expect(eventBlock.event.maxRetries).toBe(10)
        expect(eventBlock.event.retryDelayMs).toBe(30000)
        expect(eventBlock.event.errorStatus).toBe(429)
        expect(eventBlock.event.error).toBe('rate_limit')
      }
    })

    it('应该解析 turn_duration 系统消息', () => {
      const message: DecryptedMessage = {
        id: 'msg-duration',
        seq: 11,
        localId: null,
        createdAt: Date.now(),
        content: {
          type: 'output',
          data: {
            type: 'system',
            subtype: 'turn_duration',
            durationMs: 5000
          }
        }
      }

      const result = parseMessage(message)
      expect(result).not.toBeNull()
      expect(result?.role).toBe('system')

      const eventBlock = result?.content[0]
      expect(eventBlock?.type).toBe('event')
      if (eventBlock?.type === 'event') {
        expect(eventBlock.event.type).toBe('turn-duration')
        expect(eventBlock.event.durationMs).toBe(5000)
      }
    })

    it('应该处理带错误的 tool_result', () => {
      const message: DecryptedMessage = {
        id: 'msg-error-result',
        seq: 12,
        localId: null,
        createdAt: Date.now(),
        content: {
          type: 'output',
          data: {
            type: 'user',
            message: {
              content: [
                {
                  type: 'tool_result',
                  tool_use_id: 'tool-failed',
                  content: 'Error: Command not found',
                  is_error: true
                }
              ]
            }
          }
        }
      }

      const result = parseMessage(message)
      expect(result).not.toBeNull()

      const toolResult = result?.content[0]
      expect(toolResult?.type).toBe('tool-result')
      if (toolResult?.type === 'tool-result') {
        expect(toolResult.is_error).toBe(true)
        expect(toolResult.content).toBe('Error: Command not found')
      }
    })
  })

  describe('parseMessages', () => {
    it('应该解析消息数组并过滤无效消息', () => {
      const messages: DecryptedMessage[] = [
        {
          id: 'msg-1',
          seq: 1,
          localId: null,
          createdAt: Date.now(),
          content: {
            type: 'output',
            data: {
              type: 'assistant',
              message: { content: 'First message' }
            }
          }
        },
        {
          id: 'msg-meta',
          seq: 2,
          localId: null,
          createdAt: Date.now(),
          content: {
            type: 'output',
            data: {
              type: 'assistant',
              isMeta: true,
              message: { content: 'Meta message' }
            }
          }
        },
        {
          id: 'msg-2',
          seq: 3,
          localId: null,
          createdAt: Date.now(),
          content: {
            type: 'output',
            data: {
              type: 'user',
              message: { content: 'User message' }
            }
          }
        }
      ]

      const results = parseMessages(messages)
      expect(results).toHaveLength(2)
      expect(results[0]?.id).toBe('msg-1')
      expect(results[1]?.id).toBe('msg-2')
    })

    it('应该返回空数组当没有有效消息时', () => {
      const messages: DecryptedMessage[] = [
        {
          id: 'msg-1',
          seq: 1,
          localId: null,
          createdAt: Date.now(),
          content: null as unknown
        },
        {
          id: 'msg-2',
          seq: 2,
          localId: null,
          createdAt: Date.now(),
          content: {
            type: 'output',
            data: {
              type: 'assistant',
              isMeta: true,
              message: { content: 'Meta' }
            }
          }
        }
      ]

      const results = parseMessages(messages)
      expect(results).toHaveLength(0)
    })

    it('应该处理空数组', () => {
      const results = parseMessages([])
      expect(results).toHaveLength(0)
    })
  })
})
