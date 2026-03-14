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
 * Type definitions for Claude Code SDK integration
 * Provides type-safe interfaces for all SDK communication
 */

import type { Readable } from 'node:stream'
import type { ClaudePermissionMode } from '@mobi/shared/types'

/**
 * SDK message types
 */
export interface SDKMessage {
    type: string
    [key: string]: unknown
}

export interface SDKUserMessage extends SDKMessage {
    type: 'user'
    parent_tool_use_id?: string
    message: {
        role: 'user'
        content: string | Array<{
            type: string
            text?: string
            tool_use_id?: string
            content?: unknown
            [key: string]: unknown
        }>
    }
}

export interface SDKAssistantMessage extends SDKMessage {
    type: 'assistant'
    parent_tool_use_id?: string
    message: {
        role: 'assistant'
        content: Array<{
            type: string
            text?: string
            id?: string
            name?: string
            input?: unknown
            [key: string]: unknown
        }>
    }
}

export interface SDKSystemMessage extends SDKMessage {
    type: 'system'
    subtype: string
    session_id?: string
    model?: string
    cwd?: string
    tools?: string[]
    slash_commands?: string[]
}

export interface SDKResultMessage extends SDKMessage {
    type: 'result'
    subtype: 'success' | 'error_max_turns' | 'error_during_execution'
    result?: string
    num_turns: number
    usage?: {
        input_tokens: number
        output_tokens: number
        cache_read_input_tokens?: number
        cache_creation_input_tokens?: number
    }
    total_cost_usd: number
    duration_ms: number
    duration_api_ms: number
    is_error: boolean
    session_id: string
}

export interface SDKControlResponse extends SDKMessage {
    type: 'control_response'
    response: {
        request_id: string
        subtype: 'success' | 'error'
        error?: string
    }
}

export interface SDKLog extends SDKMessage {
    type: 'log'
    log: {
        level: 'debug' | 'info' | 'warn' | 'error'
        message: string
    }
}

/**
 * Control request types
 */
export interface ControlRequest {
    subtype: string
}

export interface InterruptRequest extends ControlRequest {
    subtype: 'interrupt'
}

export interface CanUseToolRequest extends ControlRequest {
    subtype: 'can_use_tool'
    tool_name: string
    input: unknown
}

export interface CanUseToolControlRequest {
    type: 'control_request'
    request_id: string
    request: CanUseToolRequest
}

export interface CanUseToolControlResponse {
    type: 'control_response'
    response: {
        subtype: 'success' | 'error'
        request_id: string
        response?: PermissionResult
        error?: string
    }
}

export interface ControlCancelRequest {
    type: 'control_cancel_request'
    request_id: string
}

export interface SDKControlRequest {
    request_id: string
    type: 'control_request'
    request: ControlRequest
}

/**
 * Permission result type for tool calls
 */
export type PermissionResult = {
    behavior: 'allow'
    updatedInput: Record<string, unknown>
} | {
    behavior: 'deny'
    message: string
}

/**
 * Callback function for tool permission checks
 */
export interface CanCallToolCallback {
    (toolName: string, input: unknown, options: { signal: AbortSignal }): Promise<PermissionResult>
}

/**
 * Query options
 */
export interface QueryOptions {
    abort?: AbortSignal
    additionalDirectories?: string[]
    allowedTools?: string[]
    appendSystemPrompt?: string
    customSystemPrompt?: string
    cwd?: string
    disallowedTools?: string[]
    maxTurns?: number
    mcpServers?: Record<string, unknown>
    pathToClaudeCodeExecutable?: string
    permissionMode?: ClaudePermissionMode
    continue?: boolean
    resume?: string
    model?: string
    fallbackModel?: string
    settingsPath?: string
    strictMcpConfig?: boolean
    canCallTool?: CanCallToolCallback
}

/**
 * Query prompt types
 */
export type QueryPrompt = string | AsyncIterable<SDKMessage>

/**
 * Control response handlers
 */
export type ControlResponseHandler = (response: SDKControlResponse['response']) => void

/**
 * Error types
 */
export class AbortError extends Error {
    constructor(message: string) {
        super(message)
        this.name = 'AbortError'
    }
}
