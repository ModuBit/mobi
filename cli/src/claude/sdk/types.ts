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
 */

/**
 * 权限结果类型（用于工具调用权限检查）
 *
 * 与官方 SDK 的 PermissionResult 兼容，但使用简化的接口
 */
export type PermissionResult = {
    behavior: 'allow'
    updatedInput?: Record<string, unknown>
} | {
    behavior: 'deny'
    message: string
}

/**
 * 工具权限检查回调函数类型
 */
export interface CanCallToolCallback {
    (toolName: string, input: unknown, options: { signal: AbortSignal }): Promise<PermissionResult>
}
