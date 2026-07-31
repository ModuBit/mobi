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

import type { AgentEvent, AgentMetrics, NormalizedAgentContent, NormalizedMessage, ToolResult, ToolResultPermission, MessageMeta } from './types'
import { asNumber, asString, getField, isObject } from '@mobi/shared'
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
    agentMetrics?: AgentMetrics,
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
        ...(agentMetrics && { agentMetrics }),
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
    const parentUUID = asString(getField(data, 'parentUuid')) ?? null
    const isSidechain = Boolean(getField(data, 'isSidechain'))
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
                // 空思考内容不渲染
                if (block.thinking.trim() === '') continue
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
    const inputTokens = usage ? asNumber(getField(usage, 'input_tokens')) : null
    const outputTokens = usage ? asNumber(getField(usage, 'output_tokens')) : null

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
            cache_creation_input_tokens: asNumber(getField(usage ?? {}, 'cache_creation_input_tokens')) ?? undefined,
            cache_read_input_tokens: asNumber(getField(usage ?? {}, 'cache_read_input_tokens')) ?? undefined,
            service_tier: asString(getField(usage ?? {}, 'service_tier')) ?? undefined
        } : undefined
    }
}

/** 处理 user 消息 */
const handleUserOutput: OutputHandler = (data, ctx) => {
    const uuid = asString(data.uuid) ?? ctx.messageId
    const parentUUID = asString(getField(data, 'parentUuid')) ?? null
    const isSidechain = Boolean(getField(data, 'isSidechain'))
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
                const rawData = data as Record<string, unknown>
                const rawToolUseResult = getField<Record<string, unknown>>(rawData, 'tool_use_result')
                const toolUseResult = isObject(rawToolUseResult) ? rawToolUseResult : null
                const permissions = normalizeToolResultPermissions(block.permissions)

                // 从 tool_use_result 提取 Agent 完成指标
                let agentMetrics: AgentMetrics | undefined
                if (toolUseResult) {
                    const tokens = asNumber(getField(toolUseResult, 'totalTokens'))
                    const toolUses = asNumber(getField(toolUseResult, 'totalToolUseCount'))
                    const durationMs = asNumber(getField(toolUseResult, 'totalDurationMs'))
                    if (tokens || toolUses || durationMs) {
                        agentMetrics = { tokens: tokens ?? 0, toolUses: toolUses ?? 0, durationMs: durationMs ?? 0 }
                    }
                }

                const result = buildToolResultBlock(
                    block as Record<string, unknown>,
                    uuid,
                    parentUUID,
                    undefined,
                    permissions,
                    agentMetrics,
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
        isSynthetic: Boolean(data.isSynthetic) || hasInterruptedText
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
        attempt: asNumber(getField(data, 'attempt')) ?? 0,
        maxRetries: asNumber(getField(data, 'maxRetries')) ?? 0,
        retryDelayMs: asNumber(getField(data, 'retryDelayMs')) ?? 0,
        errorStatus: asNumber(getField(data, 'errorStatus')) ?? 0,
        error: asString(getField(data, 'error')) ?? ''
    })
}

/** 处理 system:api_error 消息 */
const handleApiErrorOutput: OutputHandler = (data, ctx) => {
    return createEventMessage(ctx, {
        type: 'api-error',
        retryAttempt: asNumber(getField(data, 'retryAttempt')) ?? 0,
        maxRetries: asNumber(getField(data, 'maxRetries')) ?? 0,
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

/** 处理 system:goal_progress 消息（CLI 扫描 SDK ToolResult 原始 JSON 行后透传） */
const handleGoalProgressOutput: OutputHandler = (data, ctx) => {
    return createEventMessage(ctx, {
        type: 'goal-progress',
        met: data.met === true,
        condition: asString(data.condition) ?? '',
        ...(data.reason !== undefined && data.reason !== null && { reason: asString(data.reason) }),
        ...(typeof data.iterations === 'number' && { iterations: data.iterations }),
        ...(typeof data.durationMs === 'number' && { durationMs: data.durationMs }),
        ...(typeof data.tokens === 'number' && { tokens: data.tokens }),
    })
}

/** 处理 system:task_progress 消息 */
const handleTaskProgressOutput: OutputHandler = (data, ctx) => {
    const toolUseId = asString(data.tool_use_id)
    if (!toolUseId) return null

    const usage = isObject(data.usage) ? data.usage : null
    // summary 仅在 agentProgressSummaries 开启时有值，否则用 description 兜底
    const summary = asString(data.summary) || asString(data.description) || undefined
    return createEventMessage(ctx, {
        type: 'agent-progress',
        toolUseId,
        metrics: {
            tokens: asNumber(getField(usage ?? {}, 'totalTokens')) ?? 0,
            toolUses: asNumber(getField(usage ?? {}, 'totalToolUseCount')) ?? 0,
            durationMs: asNumber(getField(usage ?? {}, 'totalDurationMs')) ?? 0,
        },
        ...(summary && { summary }),
    })
}

/** 处理 system:task_notification 消息 */
const handleTaskNotificationOutput: OutputHandler = (data, ctx) => {
    const toolUseId = asString(data.tool_use_id)
    if (!toolUseId) return null

    const usage = isObject(data.usage) ? data.usage : null
    const summary = asString(data.summary) || undefined
    return createEventMessage(ctx, {
        type: 'agent-progress',
        toolUseId,
        metrics: {
            tokens: asNumber(getField(usage ?? {}, 'totalTokens')) ?? 0,
            toolUses: asNumber(getField(usage ?? {}, 'totalToolUseCount')) ?? 0,
            durationMs: asNumber(getField(usage ?? {}, 'totalDurationMs')) ?? 0,
        },
        ...(summary && { summary }),
    })
}

/** 处理 system:task_started 消息（后台任务启动） */
const handleBgTaskStartedOutput: OutputHandler = (data, ctx) => {
    const taskId = asString(data.task_id)
    if (!taskId) return null
    return createEventMessage(ctx, {
        type: 'bg-task-started',
        taskId,
        toolUseId: asString(data.tool_use_id) ?? null,
        toolName: asString(data.subagent_type) ? 'Agent' : 'Bash',
        description: asString(data.description) ?? 'Background task',
        subagentType: asString(data.subagent_type) ?? undefined,
    })
}

/** 处理 system:task_updated 消息（后台任务状态更新） */
const handleBgTaskUpdatedOutput: OutputHandler = (data, ctx) => {
    const taskId = asString(data.task_id)
    if (!taskId) return null
    return createEventMessage(ctx, {
        type: 'bg-task-updated',
        taskId,
        patch: isObject(data.patch) ? data.patch as Record<string, unknown> : {},
    })
}

/** 处理 result 消息 */
const handleResultOutput: OutputHandler = (data, ctx) => {
    const subtype = asString(data.subtype)
    const terminalReason = asString(data.terminal_reason) ?? asString(data.terminalReason)
    const isError = Boolean(data.is_error)
    const numTurns = asNumber(data.num_turns) ?? asNumber(data.numTurns) ?? null

    // 中断
    const isAborted = terminalReason === 'aborted_streaming' || terminalReason === 'aborted_tools'

    // 提取耗时和 token 细分（result 消息携带完整 usage，CLI 已透传，无需额外采集）
    const durationMs = asNumber(data.duration_ms) ?? asNumber(data.durationMs) ?? 0
    const usage = isObject(data.usage) ? data.usage : null
    const inputTokens = usage ? (asNumber(getField(usage, 'input_tokens')) ?? 0) : 0
    const outputTokens = usage ? (asNumber(getField(usage, 'output_tokens')) ?? 0) : 0
    const cacheReadTokens = usage ? (asNumber(getField(usage, 'cache_read_input_tokens')) ?? undefined) : undefined
    const cacheCreationTokens = usage ? (asNumber(getField(usage, 'cache_creation_input_tokens')) ?? undefined) : undefined
    const tokens = inputTokens + outputTokens

    // 成本 / 首 token / 模型（result 独有，assistant 无）
    const costUsd = asNumber(getField(data, 'total_cost_usd')) ?? undefined
    const ttftMs = asNumber(getField(data, 'ttft_ms')) ?? undefined
    const modelUsage = isObject(data.modelUsage) ? data.modelUsage : null
    const model = modelUsage ? (Object.keys(modelUsage)[0] ?? undefined) : undefined

    if (isAborted) {
        return createEventMessage(ctx, { type: 'aborted', numTurns, durationMs, tokens })
    }

    // 提取错误信息
    let error: string | undefined
    if (isError || subtype === 'error_during_execution') {
        const errors = Array.isArray(data.errors)
            ? (data.errors as unknown[]).filter((e): e is string => typeof e === 'string')
            : []
        error = errors.length > 0 ? errors.join(', ') : subtype ?? 'unknown error'
    }

    return createEventMessage(ctx, {
        type: 'turn-result',
        durationMs,
        tokens,
        numTurns,
        ...(ttftMs !== undefined && { ttftMs }),
        ...(costUsd !== undefined && { costUsd }),
        ...(inputTokens > 0 && { inputTokens, outputTokens }),
        ...(cacheReadTokens !== undefined && { cacheReadTokens }),
        ...(cacheCreationTokens !== undefined && { cacheCreationTokens }),
        ...(model !== undefined && { model }),
        ...(error && { error }),
    })
}

// ============================================================================
// 工具进度 / 摘要消息处理器
// ============================================================================

/**
 * 处理 tool_progress 消息（长任务心跳）。
 * SDK 在工具执行期间每 ~30s 推送一条，携带已运行时长。用 parent_tool_use_id 关联到对应工具卡片
 * （其自带 tool_use_id 是 call_xxx-heartbeat-N 变体，不可直接用）。reducer 据此校准 startedAt。
 *
 * sidechain 的 tool_progress 在此 return null 丢弃：normalize 阶段过滤后该消息不会进入 sidechain
 * group（group 由 normalize 后的 TracedMessage 构成），故 Phase 2 若要支持子视图心跳，需先打通
 * normalize 对 sidechain tool_progress 的透传，再在子视图 reduce 内复用 reducer 的 patch 逻辑。
 */
const handleToolProgressOutput: OutputHandler = (data, ctx) => {
    const isSidechain = Boolean(getField(data, 'isSidechain'))
    if (isSidechain) return null
    const toolUseId = asString(getField(data, 'parent_tool_use_id'))
    if (!toolUseId) return null
    const elapsedSeconds = asNumber(getField(data, 'elapsed_time_seconds')) ?? 0
    const toolName = asString(getField(data, 'tool_name')) ?? 'Tool'
    return createEventMessage(ctx, { type: 'tool-progress', toolUseId, elapsedSeconds, toolName })
}

/**
 * 处理 tool_use_summary 消息。
 * SDK 对一组工具的执行结果生成人话摘要，preceding_tool_use_ids 指向被总结的工具。
 * reducer 将 summary 挂到 preceding 列表最后一个工具卡片（视线落点）。
 * 字段一律走 getField，兼容 SDK snake_case / camelCase 两种下发格式（见 web/CLAUDE.md）。
 */
const handleToolUseSummaryOutput: OutputHandler = (data, ctx) => {
    const isSidechain = Boolean(getField(data, 'isSidechain'))
    if (isSidechain) return null
    const summary = asString(getField(data, 'summary'))
    if (!summary) return null
    const rawIds = getField(data, 'preceding_tool_use_ids')
    const toolUseIds = Array.isArray(rawIds)
        ? rawIds.filter((id): id is string => typeof id === 'string')
        : []
    if (toolUseIds.length === 0) return null
    return createEventMessage(ctx, { type: 'tool-use-summary', summary, toolUseIds })
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
    ['system:goal_progress', handleGoalProgressOutput],
    ['system:task_progress', handleTaskProgressOutput],
    ['system:task_notification', handleTaskNotificationOutput],
    ['system:task_started', handleBgTaskStartedOutput],
    ['system:task_updated', handleBgTaskUpdatedOutput],
    ['tool_progress', handleToolProgressOutput],
    ['tool_use_summary', handleToolUseSummaryOutput],
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
