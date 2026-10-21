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
import type { ToolInfo } from './types'

/** agentState.requests 里一条待审批请求的形状（CLI 上报可能缺字段，一律按可选处理） */
export type PendingRequest = {
    tool?: string
    arguments?: unknown
    createdAt?: number | null
    sdkHints?: SDKUIHints
    suggestions?: PermissionUpdate[]
}

/**
 * 待审批 request → ToolInfo。
 *
 * 通知卡片与会话页审批面板共用这一份映射：同一条请求在两个消费方各造一遍视图模型
 * 曾出现漂移（state pending / running、createdAt 0 / Date.now()），AgentState 字段一变
 * 还得改多处。
 */
export function buildPendingToolInfo(requestId: string, request: PendingRequest): ToolInfo {
    return {
        name: request.tool || 'Unknown',
        input: request.arguments,
        result: null,
        state: 'pending',
        description: null,
        startedAt: null,
        createdAt: request.createdAt ?? 0,
        permission: {
            id: requestId,
            status: 'pending',
            suggestions: request.suggestions,
        },
        sdkHints: request.sdkHints,
    }
}
