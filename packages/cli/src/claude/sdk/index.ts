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
 * 直接使用官方 @anthropic-ai/claude-agent-sdk
 */

// 从官方 SDK 导出
export {
    query,
    AbortError,
} from '@anthropic-ai/claude-agent-sdk'

// 导出官方 SDK 类型
export type {
    Query,
    Options,
    SDKMessage,
    SDKUserMessage,
    SDKAssistantMessage,
    SDKSystemMessage,
    SDKResultMessage,
    CanUseTool,
    PermissionResult as SDKPermissionResult,
} from '@anthropic-ai/claude-agent-sdk'

// 导出自定义类型（官方 SDK 没有的）
export type {
    PermissionResult,
    CanCallToolCallback,
} from './types'

// 导出工具函数
export { getDefaultClaudeCodePath, logDebug, streamToStdin } from './utils'

// 导出提示词常量
export * from './prompts'
