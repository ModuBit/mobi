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
 * 工具合并器
 * 将 tool_result（来自 user 消息）合并到对应的 tool_call（来自 assistant 消息）
 * 参考 HAPI 的 reducerTimeline.ts + reducerTools.ts 的 ensureToolBlock 模式
 */

import type { ToolCallBlock } from '@/components/ToolCard/types'
import type {
  ParsedMessage,
  ParsedContentBlock,
  ParsedToolCallBlock,
  ParsedToolResultBlock,
  MergedToolCallBlock,
  ToolCallState,
} from './messageParser'

// tool result 数据缓存
type ToolResultData = {
  content: unknown
  is_error: boolean
}

/**
 * 将 tool result 合并到对应的 tool call 中
 *
 * 算法：
 * 1. 第一遍：收集所有 user 消息中的 tool_use_id → result 映射
 * 2. 第二遍：
 *    - assistant 消息：将 ParsedToolCallBlock 替换为 MergedToolCallBlock
 *    - user 消息：移除 ParsedToolResultBlock，保留文本块
 *      - 消息为空则过滤掉
 */
export function mergeToolResults(messages: ParsedMessage[]): ParsedMessage[] {
  // 第一遍：收集所有 tool result
  const resultMap = new Map<string, ToolResultData>()
  for (const msg of messages) {
    if (msg.role !== 'user') continue
    for (const block of msg.content) {
      if (block.type === 'tool-result') {
        resultMap.set(block.tool_use_id, {
          content: block.content,
          is_error: block.is_error,
        })
      }
    }
  }

  // 第二遍：合并
  const result: ParsedMessage[] = []
  // 用于防御性处理：result 先于 call 到达的占位块
  const placeholderBlocks = new Map<string, MergedToolCallBlock>()

  for (const msg of messages) {
    if (msg.role === 'assistant') {
      // assistant 消息：替换 tool-call 为 merged-tool-call
      const newContent: ParsedContentBlock[] = []
      for (const block of msg.content) {
        if (block.type === 'tool-call') {
          const merged = mergeToolCall(block, resultMap.get(block.id))
          newContent.push(merged)
          // 如果之前有占位块，用真实数据更新
          placeholderBlocks.delete(block.id)
        } else {
          newContent.push(block)
        }
      }
      result.push({ ...msg, content: newContent })
    } else if (msg.role === 'user') {
      // user 消息：移除 tool-result，保留文本
      const nonResultBlocks = msg.content.filter(
        (block) => block.type !== 'tool-result'
      )

      // 检查是否有未被 assistant 消息中 tool-call 匹配到的 result
      // （防御性处理：result 先于 call 到达）
      for (const block of msg.content) {
        if (block.type === 'tool-result') {
          // 检查是否已在某条 assistant 消息中被合并
          // 通过检查 resultMap 中是否还有该 key 来判断
          // 占位块不需要在这里创建，因为我们在最后统一处理
        }
      }

      if (nonResultBlocks.length > 0) {
        result.push({ ...msg, content: nonResultBlocks })
      }
      // 如果 nonResultBlocks 为空，整条消息被过滤掉
    } else {
      // system 等其他消息直接保留
      result.push(msg)
    }
  }

  // 防御性处理：添加未被匹配的 tool result 作为占位块
  // 这些 result 没有对应的 tool call（可能是消息列表不完整）
  const matchedIds = new Set<string>()
  for (const msg of messages) {
    if (msg.role === 'assistant') {
      for (const block of msg.content) {
        if (block.type === 'tool-call') {
          matchedIds.add(block.id)
        }
      }
    }
  }

  // 对于未匹配的 result，在结果末尾追加占位 assistant 消息
  for (const msg of messages) {
    if (msg.role !== 'user') continue
    const placeholders: MergedToolCallBlock[] = []
    for (const block of msg.content) {
      if (
        block.type === 'tool-result' &&
        !matchedIds.has(block.tool_use_id)
      ) {
        placeholders.push(
          createPlaceholderToolCall(block, msg.createdAt)
        )
        matchedIds.add(block.tool_use_id) // 避免重复
      }
    }
    if (placeholders.length > 0) {
      result.push({
        id: `placeholder-${msg.id}`,
        localId: null,
        createdAt: msg.createdAt,
        role: 'assistant',
        content: placeholders,
      })
    }
  }

  return result
}

// 合并单个 tool call 与其 result
function mergeToolCall(
  call: ParsedToolCallBlock,
  resultData: ToolResultData | undefined
): MergedToolCallBlock {
  let state: ToolCallState = 'running'
  let result: unknown = undefined
  let resultIsError = false

  if (resultData) {
    result = resultData.content
    resultIsError = resultData.is_error
    state = resultData.is_error ? 'error' : 'completed'
  }

  return {
    type: 'merged-tool-call',
    id: call.id,
    name: call.name,
    input: call.input,
    description: call.description ?? null,
    result,
    resultIsError,
    state,
    createdAt: 0, // 将在 ChatContainer 中使用消息的 createdAt
    children: [],
    permission: null,
  }
}

// 创建占位 tool call（当 result 先于 call 到达时）
function createPlaceholderToolCall(
  result: ParsedToolResultBlock,
  createdAt: number
): MergedToolCallBlock {
  return {
    type: 'merged-tool-call',
    id: result.tool_use_id,
    name: 'Tool',
    input: undefined,
    description: null,
    result: result.content,
    resultIsError: result.is_error,
    state: result.is_error ? 'error' : 'completed',
    createdAt,
    children: [],
    permission: null,
  }
}

/**
 * 将 MergedToolCallBlock 转换为 ToolCard 组件所需的 ToolCallBlock 格式
 */
export function toToolCardBlock(merged: MergedToolCallBlock): ToolCallBlock {
  return {
    id: merged.id,
    kind: 'tool-call',
    tool: {
      name: merged.name,
      input: merged.input,
      result: merged.result,
      state: merged.state,
      description: merged.description,
      startedAt: merged.createdAt || null,
      createdAt: merged.createdAt || Date.now(),
      permission: null,
    },
    children: merged.children.map(toToolCardBlock),
  }
}
