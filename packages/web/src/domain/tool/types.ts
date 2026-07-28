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

import type { PermissionUpdate, SDKUIHints } from '@mobi/shared'

/**
 * 工具权限类型
 */
export type ToolPermission = {
    id: string
    status: 'pending' | 'approved' | 'denied' | 'canceled'
    reason?: string
    decision?: 'approved' | 'approved_for_session' | 'abort' | 'acceptEdits'
    mode?: 'acceptEdits'
    allowedTools?: string[]
    suggestions?: PermissionUpdate[]
    answers?: Record<string, string | string[]> | Record<string, { answers: string[] }>
}

/**
 * 工具调用信息
 */
export type ToolInfo = {
    name: string
    input: unknown
    result: unknown
    state: 'pending' | 'running' | 'completed' | 'error'
    description: string | null
    startedAt: number | null
    createdAt: number
    permission: ToolPermission | null
    sdkHints?: SDKUIHints
}

/**
 * 工具调用块（递归结构，包含子任务）
 */
export type ToolCallBlock = {
    id: string
    kind: 'tool-call'
    tool: ToolInfo
    children: ToolCallBlock[]
}
