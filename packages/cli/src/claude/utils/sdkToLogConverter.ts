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
 * Converter from SDK message types to log format (RawJSONLines)
 * Transforms Claude SDK messages into the format expected by session logs
 */

import { randomUUID } from 'node:crypto'
import { execSync } from 'node:child_process'
import type {
    SDKMessage,
    SDKUserMessage,
    SDKAssistantMessage,
    SDKSystemMessage,
    SDKResultMessage
} from '@anthropic-ai/claude-agent-sdk'
import type { RawJSONLines } from '@/claude/types'
import type { ClaudePermissionMode } from '@mobi/shared/types'

/**
 * Context for converting SDK messages to log format
 */
export interface ConversionContext {
    sessionId: string
    cwd: string
    version?: string
    gitBranch?: string
    parentUuid?: string | null
}

type PermissionResponse = {
    approved: boolean
    mode?: ClaudePermissionMode
    reason?: string
}

/**
 * Get current git branch for the working directory
 */
function getGitBranch(cwd: string): string | undefined {
    try {
        const branch = execSync('git rev-parse --abbrev-ref HEAD', {
            cwd,
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'ignore']
        }).trim()
        return branch || undefined
    } catch {
        return undefined
    }
}

/**
 * SDK to Log converter class
 * Maintains state for parent-child relationships between messages
 */
export class SDKToLogConverter {
    private lastUuid: string | null = null
    private context: ConversionContext
    private responses?: Map<string, PermissionResponse>
    private sidechainLastUUID = new Map<string, string>();

    constructor(
        context: Omit<ConversionContext, 'parentUuid'>,
        responses?: Map<string, PermissionResponse>
    ) {
        this.context = {
            ...context,
            gitBranch: context.gitBranch ?? getGitBranch(context.cwd),
            version: context.version ?? process.env.npm_package_version ?? '0.0.0',
            parentUuid: null
        }
        this.responses = responses
    }

    /**
     * Update session ID (for when session changes during resume)
     */
    updateSessionId(sessionId: string): void {
        this.context.sessionId = sessionId
    }

    /**
     * Reset parent chain (useful when starting new conversation)
     */
    resetParentChain(): void {
        this.lastUuid = null
        this.context.parentUuid = null
    }

    /** 构造所有 RawJSONLines 共用的基础字段 */
    private buildBaseFields(uuid: string, parentUuid: string | null, isSidechain: boolean) {
        return {
            parentUuid,
            isSidechain,
            userType: 'external' as const,
            cwd: this.context.cwd,
            sessionId: this.context.sessionId,
            version: this.context.version,
            gitBranch: this.context.gitBranch,
            uuid,
            timestamp: new Date().toISOString(),
        }
    }

    /**
     * Convert SDK message to log format
     */
    convert(sdkMessage: SDKMessage): RawJSONLines | null {
        const uuid = (sdkMessage as any).uuid || randomUUID()
        let parentUuid = this.lastUuid;
        let isSidechain = false;
        const msgWithParent = sdkMessage as SDKUserMessage | SDKAssistantMessage;
        if (msgWithParent.parent_tool_use_id) {
            isSidechain = true;
            parentUuid = this.sidechainLastUUID.get(msgWithParent.parent_tool_use_id) ?? null;
            this.sidechainLastUUID.set(msgWithParent.parent_tool_use_id, uuid);
        }
        const baseFields = this.buildBaseFields(uuid, parentUuid, isSidechain)

        let logMessage: RawJSONLines | null = null

        switch (sdkMessage.type) {
            case 'user': {
                const userMsg = sdkMessage as SDKUserMessage
                logMessage = {
                    ...baseFields,
                    type: 'user',
                    message: userMsg.message
                }

                // Check if this is a tool result and add mode if available
                if (Array.isArray(userMsg.message.content)) {
                    for (const content of userMsg.message.content) {
                        if (content.type === 'tool_result' && content.tool_use_id && this.responses?.has(content.tool_use_id)) {
                            const response = this.responses.get(content.tool_use_id)
                            if (response?.mode) {
                                (logMessage as any).mode = response.mode
                            }
                        }
                    }
                } else if (typeof userMsg.message.content === 'string') {
                    // Simple string content, no tool result
                }
                break
            }

            case 'assistant': {
                const assistantMsg = sdkMessage as SDKAssistantMessage
                logMessage = {
                    ...baseFields,
                    type: 'assistant',
                    message: assistantMsg.message as any,
                    // Assistant messages often have additional fields
                    requestId: (assistantMsg as any).requestId
                }
                break
            }

            case 'system': {
                const systemMsg = sdkMessage as SDKSystemMessage

                // System messages with subtype 'init' might update session ID
                if (systemMsg.subtype === 'init' && systemMsg.session_id) {
                    this.updateSessionId(systemMsg.session_id)
                }

                // System messages are typically not sent to logs
                // but we can convert them if needed
                logMessage = {
                    ...baseFields,
                    type: 'system',
                    subtype: systemMsg.subtype,
                    model: systemMsg.model,
                    tools: systemMsg.tools,
                    // Include all other fields
                    ...(systemMsg as any)
                }
                break
            }

            case 'result': {
                // Result messages are not converted to log messages
                // They're SDK-specific messages that indicate session completion
                // Not part of the actual conversation log
                return null
            }

            default:
                // Unknown message type - pass through with all fields
                logMessage = {
                    ...baseFields,
                    ...sdkMessage,
                    type: (sdkMessage as any).type // Override type last to ensure it's set
                } as any
        }

        // Update last UUID for parent tracking
        if (logMessage && logMessage.type !== 'summary') {
            this.lastUuid = uuid
        }

        return logMessage
    }

    /**
     * Convert multiple SDK messages to log format
     */
    convertMany(sdkMessages: SDKMessage[]): RawJSONLines[] {
        return sdkMessages
            .map(msg => this.convert(msg))
            .filter((msg): msg is RawJSONLines => msg !== null)
    }

    /**
     * 将累积的 content blocks 转换为 snapshot 格式的 RawJSONLines
     * 与 convert(assistantMessage) 生成的结构一致，确保前端 snapshot 和完整消息格式相同
     */
    convertSnapshot(
        contentBlocks: Array<{ type: 'text'; text: string } | { type: 'thinking'; thinking: string }>,
        opts?: { parentToolUseId?: string; model?: string },
    ): RawJSONLines {
        const uuid = randomUUID()
        const parentToolUseId = opts?.parentToolUseId
        const parentUuid = parentToolUseId
            ? this.sidechainLastUUID.get(parentToolUseId) ?? null
            : this.lastUuid

        return {
            ...this.buildBaseFields(uuid, parentUuid, !!parentToolUseId),
            type: 'assistant',
            message: {
                role: 'assistant',
                content: contentBlocks,
                model: opts?.model,
            },
        } as RawJSONLines
    }

    /**
     * Convert a simple string content to a sidechain user message
     * Used for Task tool sub-agent prompts
     */
    convertSidechainUserMessage(toolUseId: string, content: string): RawJSONLines {
        const uuid = randomUUID()
        this.sidechainLastUUID.set(toolUseId, uuid);
        return {
            ...this.buildBaseFields(uuid, null, true),
            type: 'user',
            message: {
                role: 'user',
                content: content
            },
        }
    }

    /**
     * Generate an interrupted tool result message
     * Used when a tool call is interrupted by the user
     * @param toolUseId - The ID of the tool that was interrupted
     * @param parentToolUseId - Optional parent tool ID if this is a sidechain tool
     */
    generateInterruptedToolResult(toolUseId: string, parentToolUseId?: string | null): RawJSONLines {
        const uuid = randomUUID()
        const errorMessage = "[Request interrupted by user for tool use]"

        let isSidechain = false
        let parentUuid: string | null = this.lastUuid

        if (parentToolUseId) {
            isSidechain = true
            parentUuid = this.sidechainLastUUID.get(parentToolUseId) ?? null
            this.sidechainLastUUID.set(parentToolUseId, uuid)
        }

        const logMessage: RawJSONLines = {
            ...this.buildBaseFields(uuid, parentUuid, isSidechain),
            type: 'user',
            message: {
                role: 'user',
                content: [
                    {
                        type: 'tool_result',
                        content: errorMessage,
                        is_error: true,
                        tool_use_id: toolUseId
                    }
                ]
            },
            toolUseResult: `Error: ${errorMessage}`
        } as any
        
        // Update last UUID for tracking
        this.lastUuid = uuid
        
        return logMessage
    }
}

/**
 * Convenience function for one-off conversions
 */
export function convertSDKToLog(
    sdkMessage: SDKMessage,
    context: Omit<ConversionContext, 'parentUuid'>,
    responses?: Map<string, PermissionResponse>
): RawJSONLines | null {
    const converter = new SDKToLogConverter(context, responses)
    return converter.convert(sdkMessage)
}
