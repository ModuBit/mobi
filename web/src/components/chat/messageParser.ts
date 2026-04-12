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
 * 消息解析器
 * 将 Claude Code 的消息内容解析为 Ant Design X Bubble 组件可显示的格式
 */

import type { DecryptedMessage } from '@mobi/shared'

// 解析后的内容块类型
export type ParsedTextBlock = {
  type: 'text'
  text: string
}

export type ParsedReasoningBlock = {
  type: 'reasoning'
  text: string
}

export type ParsedToolCallBlock = {
  type: 'tool-call'
  id: string
  name: string
  input: unknown
  description?: string | null
}

export type ParsedToolResultBlock = {
  type: 'tool-result'
  tool_use_id: string
  content: unknown
  is_error: boolean
}

export type ParsedSummaryBlock = {
  type: 'summary'
  summary: string
}

export type ParsedEventBlock = {
  type: 'event'
  event: {
    type: string
    [key: string]: unknown
  }
}

// 合并后的工具调用块（tool call + tool result）
export type ToolCallState = 'pending' | 'running' | 'completed' | 'error'

export type MergedToolCallBlock = {
  type: 'merged-tool-call'
  id: string
  name: string
  input: unknown
  description: string | null
  result: unknown
  resultIsError: boolean
  state: ToolCallState
  createdAt: number
  children: MergedToolCallBlock[]
  permission: null
}

// 所有解析后的内容块类型
export type ParsedContentBlock =
  | ParsedTextBlock
  | ParsedReasoningBlock
  | ParsedToolCallBlock
  | ParsedToolResultBlock
  | ParsedSummaryBlock
  | ParsedEventBlock
  | MergedToolCallBlock

// 解析后的消息类型
export type ParsedMessage = {
  id: string
  localId: string | null
  createdAt: number
  role: 'user' | 'assistant' | 'system'
  content: ParsedContentBlock[]
  isMeta?: boolean
  /** 非用户主动输入的消息（如 SDK 自动生成的中断消息），渲染时使用柔和样式 */
  isSynthetic?: boolean
}

// 辅助函数：类型检查
function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function asString(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

function asNumber(value: unknown): number | null {
  return typeof value === 'number' ? value : null
}

/**
 * 检查消息是否应该跳过（isMeta 或 isCompactSummary）
 */
export function isSkippableMessage(content: unknown): boolean {
  if (!isObject(content)) return false
  // 解包外层 { role, content, meta }
  let innerContent = content
  if (isObject(content.content) && typeof content.role === 'string') {
    innerContent = content.content as Record<string, unknown>
  }
  if (innerContent.type !== 'output') return false
  const data = isObject(innerContent.data) ? innerContent.data : null
  if (!data) return false
  return Boolean(data.isMeta) || Boolean(data.isCompactSummary)
}

/**
 * 解析 assistant 消息的输出
 */
function parseAssistantOutput(
  messageId: string,
  localId: string | null,
  createdAt: number,
  data: Record<string, unknown>
): ParsedMessage | null {
  const message = isObject(data.message) ? data.message : null
  if (!message) return null

  const modelContent = message.content
  const blocks: ParsedContentBlock[] = []

  // 处理字符串内容
  if (typeof modelContent === 'string') {
    blocks.push({ type: 'text', text: modelContent })
  }
  // 处理数组内容
  else if (Array.isArray(modelContent)) {
    for (const block of modelContent) {
      if (!isObject(block) || typeof block.type !== 'string') continue

      // 文本块
      if (block.type === 'text' && typeof block.text === 'string') {
        blocks.push({ type: 'text', text: block.text })
        continue
      }

      // 思考/推理块
      if (block.type === 'thinking' && typeof block.thinking === 'string') {
        blocks.push({ type: 'reasoning', text: block.thinking })
        continue
      }

      // 工具调用
      if (block.type === 'tool_use' && typeof block.id === 'string') {
        const name = asString(block.name) ?? 'Tool'
        const input = 'input' in block ? (block as Record<string, unknown>).input : undefined
        const description = isObject(input) && typeof input.description === 'string' ? input.description : null
        blocks.push({ type: 'tool-call', id: block.id, name, input, description })
      }
    }
  }

  return {
    id: messageId,
    localId,
    createdAt,
    role: 'assistant',
    content: blocks
  }
}

// 中断消息的正则匹配
const INTERRUPTED_PATTERN = /\[Request interrupted by user\]/

/**
 * 解析 user 消息的输出
 */
function parseUserOutput(
  messageId: string,
  localId: string | null,
  createdAt: number,
  data: Record<string, unknown>
): ParsedMessage | null {
  const message = isObject(data.message) ? data.message : null
  if (!message) return null

  const messageContent = message.content
  const isSidechain = Boolean(data.isSidechain)

  // 处理 sidechain 消息
  if (isSidechain && typeof messageContent === 'string') {
    return {
      id: messageId,
      localId,
      createdAt,
      role: 'user',
      content: [{ type: 'text', text: messageContent }]
    }
  }

  // 处理简单字符串内容
  if (typeof messageContent === 'string') {
    return {
      id: messageId,
      localId,
      createdAt,
      role: 'user',
      content: [{ type: 'text', text: messageContent }],
      isSynthetic: INTERRUPTED_PATTERN.test(messageContent),
    }
  }

  const blocks: ParsedContentBlock[] = []

  // 处理数组内容
  if (Array.isArray(messageContent)) {
    for (const block of messageContent) {
      if (!isObject(block) || typeof block.type !== 'string') continue

      // 文本块
      if (block.type === 'text' && typeof block.text === 'string') {
        blocks.push({ type: 'text', text: block.text })
        continue
      }

      // 工具结果
      if (block.type === 'tool_result' && typeof block.tool_use_id === 'string') {
        const isError = Boolean(block.is_error)
        const rawContent = 'content' in block ? (block as Record<string, unknown>).content : undefined
        const embeddedToolUseResult = 'toolUseResult' in data ? (data as Record<string, unknown>).toolUseResult : null

        blocks.push({
          type: 'tool-result',
          tool_use_id: block.tool_use_id,
          content: embeddedToolUseResult ?? rawContent,
          is_error: isError
        })
      }
    }
  }

  return {
    id: messageId,
    localId,
    createdAt,
    role: 'user',
    content: blocks,
    isSynthetic: blocks.some(b => b.type === 'text' && INTERRUPTED_PATTERN.test(b.text)),
  }
}

/**
 * 解析 result 消息（执行结果，含 abort/error 等）
 */
function parseResultOutput(
  messageId: string,
  localId: string | null,
  createdAt: number,
  data: Record<string, unknown>
): ParsedMessage | null {
  const subtype = asString(data.subtype)
  const terminalReason = asString(data.terminal_reason) ?? asString(data.terminalReason)
  const isError = Boolean(data.is_error)
  const numTurns = asNumber(data.num_turns) ?? asNumber(data.numTurns)

  // 中断
  if (terminalReason === 'aborted_streaming' || terminalReason === 'aborted_tools') {
    return {
      id: messageId,
      localId,
      createdAt,
      role: 'system',
      content: [{ type: 'event', event: { type: 'aborted', numTurns } }]
    }
  }

  // 其他错误结果
  if (isError || subtype === 'error_during_execution') {
    const errors = Array.isArray(data.errors)
      ? (data.errors as unknown[]).filter((e): e is string => typeof e === 'string')
      : []
    return {
      id: messageId,
      localId,
      createdAt,
      role: 'system',
      content: [{ type: 'event', event: { type: 'execution-error', subtype: subtype ?? 'unknown', errors, numTurns } }]
    }
  }

  // 正常完成，静默忽略
  return null
}

/**
 * 解析 system 事件
 */
function parseSystemEvent(
  messageId: string,
  localId: string | null,
  createdAt: number,
  data: Record<string, unknown>
): ParsedMessage | null {
  const subtype = asString(data.subtype)

  if (subtype === 'api_error') {
    return {
      id: messageId,
      localId,
      createdAt,
      role: 'system',
      content: [{
        type: 'event',
        event: {
          type: 'api-error',
          retryAttempt: asNumber(data.retryAttempt) ?? 0,
          maxRetries: asNumber(data.maxRetries) ?? 0,
          error: data.error
        }
      }]
    }
  }

  if (subtype === 'turn_duration') {
    return {
      id: messageId,
      localId,
      createdAt,
      role: 'system',
      content: [{
        type: 'event',
        event: {
          type: 'turn-duration',
          durationMs: asNumber(data.durationMs) ?? 0
        }
      }]
    }
  }

  return null
}

/**
 * 解析单条消息
 */
export function parseMessage(message: DecryptedMessage): ParsedMessage | null {
  const { id, localId, createdAt, content } = message

  if (!isObject(content)) return null

  // 消息可能有外层包装：{ role, content: { type, data/text }, meta }
  // 需要解包到实际的消息内容
  let innerContent = content
  let outerRole: string | null = null
  if (isObject(content.content) && typeof content.role === 'string') {
    outerRole = content.role
    innerContent = content.content as Record<string, unknown>
  }

  if (typeof innerContent.type !== 'string') return null

  // 处理 output 类型（主要的消息类型）
  if (innerContent.type === 'output') {
    const data = isObject(innerContent.data) ? innerContent.data : null
    if (!data || typeof data.type !== 'string') return null

    // 跳过 meta 和 compact-summary 消息
    if (data.isMeta || data.isCompactSummary) return null

    // 解析 assistant 消息
    if (data.type === 'assistant') {
      return parseAssistantOutput(id, localId, createdAt, data)
    }

    // 解析 user 消息
    if (data.type === 'user') {
      return parseUserOutput(id, localId, createdAt, data)
    }

    // 跳过 summary 消息（会话摘要，不需要展示）
    if (data.type === 'summary') return null

    // 解析 system 事件
    if (data.type === 'system') {
      return parseSystemEvent(id, localId, createdAt, data)
    }

    // 解析 result 消息（执行结果，含 abort/error 等）
    if (data.type === 'result') {
      return parseResultOutput(id, localId, createdAt, data)
    }

    // 未识别的 output data.type，打印 warn
    console.warn('[messageParser] 未识别的 output 消息类型:', data.type, { id, seq: message.seq, data })
  }

  // 处理 text 类型（来自 webapp 发送的文本消息）
  if (innerContent.type === 'text' && typeof innerContent.text === 'string') {
    return {
      id,
      localId,
      createdAt,
      role: outerRole === 'user' ? 'user' : 'assistant',
      content: [{ type: 'text', text: innerContent.text }]
    }
  }

  // 处理 event 类型
  if (innerContent.type === 'event') {
    const eventData = isObject(innerContent.data) ? innerContent.data : null
    if (!eventData || typeof eventData.type !== 'string') return null

    // 跳过 ready 事件（SDK 就绪通知，无需展示）
    if (eventData.type === 'ready') return null

    return {
      id,
      localId,
      createdAt,
      role: 'system',
      content: [{
        type: 'event',
        event: eventData as Record<string, unknown> & { type: string }
      }]
    }
  }

  // 未识别的 innerContent.type，打印 warn
  console.warn('[messageParser] 未识别的消息结构:', innerContent.type, { id, content })

  return null
}

/**
 * 解析消息数组，过滤掉无效消息
 */
export function parseMessages(messages: DecryptedMessage[]): ParsedMessage[] {
  const result: ParsedMessage[] = []

  for (const message of messages) {
    const parsed = parseMessage(message)
    if (parsed) {
      result.push(parsed)
    }
  }

  return result
}
