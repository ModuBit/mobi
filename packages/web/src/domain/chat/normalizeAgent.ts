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

import type { AgentEvent, NormalizedAgentContent, NormalizedMessage, ToolResult, ToolResultPermission, MessageMeta } from './types'
import { asNumber, asString, isObject } from '@mobi/shared'
import { isClaudeChatVisibleMessage } from '@mobi/shared/messages'

// 中断消息的正则匹配
const INTERRUPTED_PATTERN = /\[Request interrupted by user\]/

// ============================================================================
// 工具函数
// ============================================================================

function normalizeToolResultPermissions(value: unknown): ToolResultPermission | undefined {
    if (!isObject(value)) return undefined
    const date = asNumber(value.date)
    const result = value.result
    if (date === null) return undefined
    if (result !== 'approved' && result !== 'denied') return undefined

    const mode = asString(value.mode) ?? undefined
    const allowedTools = Array.isArray(value.allowedTools)
        ? value.allowedTools.filter((tool) => typeof tool === 'string')
        : undefined
    const decision = value.decision
    const normalizedDecision = decision === 'approved' || decision === 'approved_for_session' || decision === 'denied' || decision === 'abort'
        ? decision
        : undefined
    return {
        date,
        result,
        mode,
        allowedTools,
        decision: normalizedDecision
    }
}

function normalizeAgentEvent(value: unknown): AgentEvent | null {
    if (!isObject(value) || typeof value.type !== 'string') return null
    return value as AgentEvent
}

function buildToolResultBlock(
    block: Record<string, unknown>,
    uuid: string,
    parentUUID: string | null,
    contentOverride?: unknown,
    permissions?: ToolResultPermission,
): ToolResult | null {
    if (typeof block.tool_use_id !== 'string') return null
    const isError = Boolean(block.is_error)
    const rawContent = 'content' in block ? (block as Record<string, unknown>).content : undefined
    return {
        type: 'tool-result',
        tool_use_id: block.tool_use_id,
        content: contentOverride ?? rawContent,
        is_error: isError,
        uuid,
        parentUUID,
        ...(permissions && { permissions }),
    }
}

// ============================================================================
// 处理器上下文
// ============================================================================

type HandlerContext = {
    messageId: string
    localId: string | null
    createdAt: number
    meta?: MessageMeta
}

type OutputHandler = (data: Record<string, unknown>, ctx: HandlerContext) => NormalizedMessage | null

// ============================================================================
// Output 消息处理器
// ============================================================================

/** 处理 assistant 消息 */
const handleAssistantOutput: OutputHandler = (data, ctx) => {
    const uuid = asString(data.uuid) ?? ctx.messageId
    const parentUUID = asString(data.parentUuid) ?? null
    const isSidechain = Boolean(data.isSidechain)
    const message = isObject(data.message) ? data.message : null
    if (!message) return null

    const modelContent = message.content
    const blocks: NormalizedAgentContent[] = []

    if (typeof modelContent === 'string') {
        blocks.push({ type: 'text', text: modelContent, uuid, parentUUID })
    } else if (Array.isArray(modelContent)) {
        for (const block of modelContent) {
            if (!isObject(block) || typeof block.type !== 'string') continue
            if (block.type === 'text' && typeof block.text === 'string') {
                blocks.push({ type: 'text', text: block.text, uuid, parentUUID })
                continue
            }
            if (block.type === 'thinking' && typeof block.thinking === 'string') {
                blocks.push({ type: 'reasoning', text: block.thinking, uuid, parentUUID })
                continue
            }
            if ((block.type === 'tool_use' || block.type === 'server_tool_use') && typeof block.id === 'string') {
                const name = asString(block.name) ?? 'Tool'
                const input = 'input' in block ? (block as Record<string, unknown>).input : undefined
                const description = isObject(input) && typeof input.description === 'string' ? input.description : null
                blocks.push({ type: 'tool-call', id: block.id, name, input, description, uuid, parentUUID })
            }
            // 部分模型在 assistant 消息中返回 tool_result
            if (block.type === 'tool_result') {
                const result = buildToolResultBlock(block as Record<string, unknown>, uuid, parentUUID)
                if (result) blocks.push(result)
            }
        }
    }

    const usage = isObject(message.usage) ? (message.usage as Record<string, unknown>) : null
    const inputTokens = usage ? asNumber(usage.input_tokens) : null
    const outputTokens = usage ? asNumber(usage.output_tokens) : null

    return {
        id: ctx.messageId,
        localId: ctx.localId,
        createdAt: ctx.createdAt,
        role: 'agent',
        isSidechain,
        content: blocks,
        meta: ctx.meta,
        usage: inputTokens !== null && outputTokens !== null ? {
            input_tokens: inputTokens,
            output_tokens: outputTokens,
            cache_creation_input_tokens: asNumber(usage?.cache_creation_input_tokens) ?? undefined,
            cache_read_input_tokens: asNumber(usage?.cache_read_input_tokens) ?? undefined,
            service_tier: asString(usage?.service_tier) ?? undefined
        } : undefined
    }
}

/** 处理 user 消息 */
const handleUserOutput: OutputHandler = (data, ctx) => {
    const uuid = asString(data.uuid) ?? ctx.messageId
    const parentUUID = asString(data.parentUuid) ?? null
    const isSidechain = Boolean(data.isSidechain)
    const message = isObject(data.message) ? data.message : null
    if (!message) return null

    const messageContent = message.content

    // Sidechain 消息
    if (isSidechain && typeof messageContent === 'string') {
        return {
            id: ctx.messageId,
            localId: ctx.localId,
            createdAt: ctx.createdAt,
            role: 'agent',
            isSidechain: true,
            content: [{ type: 'sidechain', uuid, prompt: messageContent }]
        }
    }
    // Sidechain 数组内容（agent prompt 以数组形式发送）
    if (isSidechain && Array.isArray(messageContent)) {
        const hasToolResult = messageContent.some(b => isObject(b) && b.type === 'tool_result')
        if (!hasToolResult) {
            const prompt = messageContent
                .filter((b): b is Record<string, unknown> & { type: string } => isObject(b) && b.type === 'text' && typeof b.text === 'string')
                .map(b => b.text as string)
                .join('\n')
            if (prompt) {
                return {
                    id: ctx.messageId,
                    localId: ctx.localId,
                    createdAt: ctx.createdAt,
                    role: 'agent',
                    isSidechain: true,
                    content: [{ type: 'sidechain', uuid, prompt }]
                }
            }
        }
    }

    // 简单字符串内容
    if (typeof messageContent === 'string') {
        const isSynthetic = INTERRUPTED_PATTERN.test(messageContent)
        return {
            id: ctx.messageId,
            localId: ctx.localId,
            createdAt: ctx.createdAt,
            role: 'user',
            isSidechain: false,
            content: { type: 'text', text: messageContent },
            meta: ctx.meta,
            isSynthetic
        }
    }

    // 数组内容（tool_result 等）
    const blocks: NormalizedAgentContent[] = []
    let hasInterruptedText = false

    if (Array.isArray(messageContent)) {
        for (const block of messageContent) {
            if (!isObject(block) || typeof block.type !== 'string') continue
            if (block.type === 'text' && typeof block.text === 'string') {
                if (INTERRUPTED_PATTERN.test(block.text)) {
                    hasInterruptedText = true
                }
                blocks.push({ type: 'text', text: block.text, uuid, parentUUID })
                continue
            }
            if (block.type === 'tool_result') {
                const embeddedToolUseResult = 'toolUseResult' in data ? (data as Record<string, unknown>).toolUseResult : null
                const permissions = normalizeToolResultPermissions(block.permissions)
                const result = buildToolResultBlock(
                    block as Record<string, unknown>,
                    uuid,
                    parentUUID,
                    embeddedToolUseResult ?? undefined,
                    permissions,
                )
                if (result) blocks.push(result)
            }
        }
    }

    return {
        id: ctx.messageId,
        localId: ctx.localId,
        createdAt: ctx.createdAt,
        role: 'agent',
        isSidechain,
        content: blocks,
        meta: ctx.meta,
        isSynthetic: hasInterruptedText
    }
}

/** 处理 summary 消息 */
const handleSummaryOutput: OutputHandler = (data, ctx) => {
    if (typeof data.summary !== 'string') return null
    return {
        id: ctx.messageId,
        localId: ctx.localId,
        createdAt: ctx.createdAt,
        role: 'agent',
        isSidechain: false,
        content: [{ type: 'summary', summary: data.summary }],
        meta: ctx.meta
    }
}

/** 创建 event 消息的辅助函数 */
function createEventMessage(ctx: HandlerContext, content: AgentEvent): NormalizedMessage {
    return {
        id: ctx.messageId,
        localId: ctx.localId,
        createdAt: ctx.createdAt,
        role: 'event',
        content,
        isSidechain: false,
        meta: ctx.meta
    }
}

/** 处理 system:api_retry 消息 */
const handleApiRetryOutput: OutputHandler = (data, ctx) => {
    return createEventMessage(ctx, {
        type: 'api-retry',
        attempt: asNumber(data.attempt) ?? 0,
        maxRetries: asNumber(data.max_retries) ?? 0,
        retryDelayMs: asNumber(data.retry_delay_ms) ?? 0,
        errorStatus: asNumber(data.error_status) ?? 0,
        error: asString(data.error) ?? ''
    })
}

/** 处理 system:api_error 消息 */
const handleApiErrorOutput: OutputHandler = (data, ctx) => {
    return createEventMessage(ctx, {
        type: 'api-error',
        retryAttempt: asNumber(data.retryAttempt) ?? 0,
        maxRetries: asNumber(data.maxRetries) ?? 0,
        error: data.error
    })
}

/** 处理 system:turn_duration 消息 */
const handleTurnDurationOutput: OutputHandler = (data, ctx) => {
    return createEventMessage(ctx, {
        type: 'turn-duration',
        durationMs: asNumber(data.durationMs) ?? 0
    })
}

/** 处理 system:microcompact_boundary 消息 */
const handleMicrocompactBoundaryOutput: OutputHandler = (data, ctx) => {
    const metadata = isObject(data.microcompactMetadata) ? data.microcompactMetadata : null
    return createEventMessage(ctx, {
        type: 'microcompact',
        trigger: asString(metadata?.trigger) ?? 'auto',
        preTokens: asNumber(metadata?.preTokens) ?? 0,
        tokensSaved: asNumber(metadata?.tokensSaved) ?? 0
    })
}

/** 处理 system:compact_boundary 消息 */
const handleCompactBoundaryOutput: OutputHandler = (data, ctx) => {
    const metadata = isObject(data.compact_metadata) ? data.compact_metadata
        : isObject(data.compactMetadata) ? data.compactMetadata
        : null
    return createEventMessage(ctx, {
        type: 'compact',
        trigger: asString(metadata?.trigger) ?? 'auto',
        preTokens: asNumber(metadata?.pre_tokens) ?? asNumber(metadata?.preTokens) ?? 0,
        postTokens: asNumber(metadata?.post_tokens) ?? asNumber(metadata?.postTokens) ?? 0,
        durationMs: asNumber(metadata?.duration_ms) ?? asNumber(metadata?.durationMs) ?? 0
    })
}

/** 处理 result 消息 */
const handleResultOutput: OutputHandler = (data, ctx) => {
    const subtype = asString(data.subtype)
    const terminalReason = asString(data.terminal_reason) ?? asString(data.terminalReason)
    const isError = Boolean(data.is_error)
    const numTurns = asNumber(data.num_turns) ?? asNumber(data.numTurns)

    // 中断
    if (terminalReason === 'aborted_streaming' || terminalReason === 'aborted_tools') {
        return createEventMessage(ctx, { type: 'aborted', numTurns })
    }

    // 错误结果
    if (isError || subtype === 'error_during_execution') {
        const errors = Array.isArray(data.errors)
            ? (data.errors as unknown[]).filter((e): e is string => typeof e === 'string')
            : []
        return createEventMessage(ctx, { type: 'execution-error', subtype: subtype ?? 'unknown', errors, numTurns })
    }

    // 正常完成，静默忽略
    return null
}

// ============================================================================
// 处理器注册表
// ============================================================================

/** Output 消息处理器注册表，key 格式为 "type" 或 "type:subtype" */
const outputHandlers = new Map<string, OutputHandler>([
    ['assistant', handleAssistantOutput],
    ['user', handleUserOutput],
    ['summary', handleSummaryOutput],
    ['system:api_retry', handleApiRetryOutput],
    ['system:api_error', handleApiErrorOutput],
    ['system:turn_duration', handleTurnDurationOutput],
    ['system:microcompact_boundary', handleMicrocompactBoundaryOutput],
    ['system:compact_boundary', handleCompactBoundaryOutput],
    ['result', handleResultOutput],
])

// ============================================================================
// 导出函数
// ============================================================================

export function isSkippableAgentContent(content: unknown): boolean {
    if (!isObject(content) || content.type !== 'output') return false
    const data = isObject(content.data) ? content.data : null
    if (!data) return false
    if (Boolean(data.isMeta) || Boolean(data.isCompactSummary)) return true
    return !isClaudeChatVisibleMessage({ type: data.type, subtype: data.subtype })
}

export function normalizeAgentRecord(
    messageId: string,
    localId: string | null,
    createdAt: number,
    content: unknown,
    meta?: MessageMeta
): NormalizedMessage | null {
    if (!isObject(content) || typeof content.type !== 'string') return null

    const ctx: HandlerContext = { messageId, localId, createdAt, meta }

    // 处理 output 类型消息
    if (content.type === 'output') {
        const data = isObject(content.data) ? content.data : null
        if (!data || typeof data.type !== 'string') return null

        // 跳过 meta/compact-summary 消息
        if (data.isMeta || data.isCompactSummary) return null
        if (!isClaudeChatVisibleMessage({ type: data.type, subtype: data.subtype })) return null

        // 构建注册表 key，优先精确匹配 type:subtype，回退到 type
        const key = data.subtype ? `${data.type}:${data.subtype}` : data.type
        let handler = outputHandlers.get(key)

        // 如果精确匹配失败，尝试只用 type
        if (!handler && data.subtype) {
            handler = outputHandlers.get(data.type)
        }

        if (handler) {
            return handler(data as Record<string, unknown>, ctx)
        }

        // 未识别的消息类型
        console.warn('[normalizeAgent] 未识别的 output 消息类型:', key, { messageId, data })
        return null
    }

    // 处理 event 类型消息
    if (content.type === 'event') {
        const event = normalizeAgentEvent(content.data)
        if (!event) return null
        return createEventMessage(ctx, event)
    }

    return null
}
