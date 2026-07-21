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
 * WITHOUT WARRANTIES OR conditions of any kind, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import type { AttachmentMetadata, MessageStatus } from '@/core/data/api/types'

/** 消息元数据 */
export type MessageMeta = {
    sentFrom?: string
    [key: string]: unknown
}

export type UsageData = {
    input_tokens: number
    output_tokens: number
    cache_creation_input_tokens?: number
    cache_read_input_tokens?: number
    service_tier?: string
}

export type AgentEvent =
    | { type: 'switch'; mode: 'local' | 'remote' }
    | { type: 'message'; message: string }
    | { type: 'summary'; message: string }
    | { type: 'title-changed'; title: string }
    | { type: 'limit-reached'; endsAt: number }
    | { type: 'ready' }
    | { type: 'api-error'; retryAttempt: number; maxRetries: number; error: unknown }
    | { type: 'api-retry'; attempt: number; maxRetries: number; retryDelayMs: number; errorStatus: number; error: string }
    | { type: 'turn-duration'; durationMs: number }
    | { type: 'microcompact'; trigger: string; preTokens: number; tokensSaved: number }
    | { type: 'compact'; trigger: string; preTokens: number; postTokens: number; durationMs: number }
    | { type: 'aborted'; numTurns: number | null; durationMs?: number; tokens?: number }
    | { type: 'turn-result'; durationMs: number; tokens: number; error?: string }
    | { type: 'agent-progress'; toolUseId: string; metrics: AgentMetrics; summary?: string }
    // 后台任务事件
    | { type: 'bg-task-started'; taskId: string; toolUseId: string | null; toolName: 'Bash' | 'Agent' | 'Monitor'; description: string; subagentType?: string }
    | { type: 'bg-task-progress'; taskId: string; metrics: AgentMetrics; summary?: string }
    | { type: 'bg-task-completed'; taskId: string; status: 'completed' | 'failed' | 'stopped'; summary?: string; metrics?: AgentMetrics }
    | { type: 'bg-task-updated'; taskId: string; patch: Record<string, unknown> }
    | ({ type: string } & Record<string, unknown>)

export type ToolResultPermission = {
    date: number
    result: 'approved' | 'denied'
    mode?: string
    allowedTools?: string[]
    decision?: 'approved' | 'approved_for_session' | 'denied' | 'abort'
}

/** Agent 工具执行的实时指标 */
export type AgentMetrics = {
    tokens: number
    toolUses: number
    durationMs: number
}

/** 后台任务状态 */
export type BackgroundTask = {
    taskId: string
    toolUseId: string | null
    toolName: 'Bash' | 'Agent' | 'Monitor'
    description: string
    subagentType?: string
    status: 'running' | 'completed' | 'failed' | 'stopped'
    metrics?: AgentMetrics
    summary?: string
    startedAt: number
    completedAt?: number
}

export type ToolUse = {
    type: 'tool-call'
    id: string
    name: string
    input: unknown
    description: string | null
    uuid: string
    parentUUID: string | null
}

export type ToolResult = {
    type: 'tool-result'
    tool_use_id: string
    content: unknown
    is_error: boolean
    uuid: string
    parentUUID: string | null
    permissions?: ToolResultPermission
    /** Agent 工具的完成指标（来自 tool_use_result） */
    agentMetrics?: AgentMetrics
}

export type NormalizedAgentContent =
    | {
        type: 'text'
        text: string
        uuid: string
        parentUUID: string | null
    }
    | {
        type: 'reasoning'
        text: string
        uuid: string
        parentUUID: string | null
    }
    | ToolUse
    | ToolResult
    | { type: 'summary'; summary: string }
    | { type: 'sidechain'; uuid: string; prompt: string }

export type NormalizedMessage = ({
    role: 'user'
    content: { type: 'text'; text: string; attachments?: AttachmentMetadata[] }
} | {
    role: 'agent'
    content: NormalizedAgentContent[]
} | {
    role: 'event'
    content: AgentEvent
}) & {
    id: string
    localId: string | null
    createdAt: number
    isSidechain: boolean
    meta?: MessageMeta
    usage?: UsageData
    status?: MessageStatus
    originalText?: string
    /** 非用户主动输入的消息（如 SDK 自动生成的中断消息），渲染时使用柔和样式 */
    isSynthetic?: boolean
    /** 流式快照消息（未落库，Hub 直接透传） */
    snapshot?: boolean
    /** Anthropic 分配的 message.id（snapshot 与 full 共享，双保险第二道按 (messageId, type) 去重的键） */
    messageId?: string
}

export type ToolPermission = {
    id: string
    status: 'pending' | 'approved' | 'denied' | 'canceled'
    reason?: string
    mode?: string
    allowedTools?: string[]
    decision?: 'approved' | 'approved_for_session' | 'denied' | 'abort'
    answers?: Record<string, string[]> | Record<string, { answers: string[] }>
    date?: number
    createdAt?: number | null
    completedAt?: number | null
}

export type ChatToolCall = {
    id: string
    name: string
    state: 'pending' | 'running' | 'completed' | 'error'
    input: unknown
    createdAt: number
    startedAt: number | null
    completedAt: number | null
    description: string | null
    result?: unknown
    permission?: ToolPermission
    agentMetrics?: AgentMetrics
    agentSummary?: string
}

export type UserTextBlock = {
    kind: 'user-text'
    id: string
    localId: string | null
    createdAt: number
    text: string
    attachments?: AttachmentMetadata[]
    status?: MessageStatus
    originalText?: string
    meta?: MessageMeta
    /** 非用户主动输入的消息（如 SDK 自动生成的中断消息），渲染时使用柔和样式 */
    isSynthetic?: boolean
}

export type AgentTextBlock = {
    kind: 'agent-text'
    id: string
    localId: string | null
    createdAt: number
    text: string
    meta?: MessageMeta
    /** 非用户主动输入的消息（如 SDK 自动生成的中断消息），渲染时使用柔和样式 */
    isSynthetic?: boolean
    /** 是否正在流式输出 */
    isStreaming?: boolean
    /** 是否为流式 snapshot（snapshot 字段由 Hub 透传，尚未落库） */
    isSnapshot?: boolean
}

export type AgentReasoningBlock = {
    kind: 'agent-reasoning'
    id: string
    localId: string | null
    createdAt: number
    text: string
    meta?: MessageMeta
    /** 是否正在流式输出 */
    isStreaming?: boolean
    /** 是否为流式 snapshot（snapshot 字段由 Hub 透传，尚未落库） */
    isSnapshot?: boolean
}

export type CliOutputBlock = {
    kind: 'cli-output'
    id: string
    localId: string | null
    createdAt: number
    text: string
    source: 'user' | 'assistant'
    meta?: MessageMeta
}

/** Compact 总结消息块 */
export type CompactSummaryBlock = {
    kind: 'compact-summary'
    id: string
    localId: string | null
    createdAt: number
    text: string
    /** 压缩前 token 数 */
    preTokens: number
    /** 压缩后 token 数 */
    postTokens: number
    /** 压缩耗时（毫秒） */
    durationMs: number
    meta?: MessageMeta
}

/** 事件渲染提示，由 reducer 层设置，渲染层只负责执行 */
export type EventDisplay = {
    /** 内容对齐方式 */
    align?: 'left' | 'center' | 'right'
    /** 颜色主题 */
    color?: 'default' | 'error' | 'warning' | 'success'
    /** 是否保留内边距，默认 true */
    padding?: boolean
}

export type AgentEventBlock = {
    kind: 'agent-event'
    id: string
    createdAt: number
    event: AgentEvent
    meta?: MessageMeta
    /** 渲染提示 */
    display?: EventDisplay
}

export type ToolCallBlock = {
    kind: 'tool-call'
    id: string
    localId: string | null
    createdAt: number
    tool: ChatToolCall
    children: ChatBlock[]
    meta?: MessageMeta
}

export type ChatBlock = UserTextBlock | AgentTextBlock | AgentReasoningBlock | CliOutputBlock | CompactSummaryBlock | ToolCallBlock | AgentEventBlock
