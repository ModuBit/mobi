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
 * 自定义类型定义
 *
 * 仅包含官方 SDK 没有的自定义类型
 * SDK 提供的类型直接从 SDK 重新导出
 */

// 从 SDK 重新导出权限相关类型
export type {
    PermissionResult,
    PermissionUpdate,
    PermissionDecisionClassification,
    PermissionRuleValue,
    PermissionBehavior,
    PermissionUpdateDestination,
} from '@anthropic-ai/claude-agent-sdk'

/**
 * 工具权限检查回调函数类型
 *
 * 与官方 SDK 的 CanUseTool 对齐，包含 suggestions、toolUseID 等参数
 */
export interface CanCallToolCallback {
    (
        toolName: string,
        input: unknown,
        options: {
            signal: AbortSignal
            suggestions?: import('@anthropic-ai/claude-agent-sdk').PermissionUpdate[]
            toolUseID?: string
        }
    ): Promise<import('@anthropic-ai/claude-agent-sdk').PermissionResult>
}
