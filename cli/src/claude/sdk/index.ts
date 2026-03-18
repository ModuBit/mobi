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
 * Claude Code SDK integration for MOBI CLI
 *
 * 使用官方 @anthropic-ai/claude-agent-sdk 作为底层实现，
 * 通过适配层保持向后兼容的 API。
 */

// 从适配层导出
export { query, AbortError, QueryWrapper } from './adapter'

// 导出类型定义
export type {
    QueryOptions,
    QueryPrompt,
    SDKMessage,
    SDKUserMessage,
    SDKAssistantMessage,
    SDKSystemMessage,
    SDKResultMessage,
    SDKControlResponse,
    ControlRequest,
    InterruptRequest,
    SDKControlRequest,
    CanCallToolCallback,
    PermissionResult
} from './types'

// 导出工具函数（保留向后兼容）
export { getDefaultClaudeCodePath, logDebug, streamToStdin } from './utils'

// 导出提示词常量
export * from './prompts'
