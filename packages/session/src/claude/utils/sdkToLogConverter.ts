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
    private buildBaseFields(uuid: string, parentUuid: string | null, isSidechain: boolean, parentToolUseId?: string) {
        return {
            parentUuid,
            isSidechain,
            parentToolUseId,
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
        // SDKMessage 联合中大部分成员有 uuid，但 SDKUserMessage.uuid 可选、少数成员无此字段
        // 用 in 守卫安全访问
        const uuid = ('uuid' in sdkMessage && typeof sdkMessage.uuid === 'string')
            ? sdkMessage.uuid
            : randomUUID()
        let parentUuid = this.lastUuid;
        let isSidechain = false;
        let parentToolUseId: string | undefined;
        const msgWithParent = sdkMessage as SDKUserMessage | SDKAssistantMessage;
        if (msgWithParent.parent_tool_use_id) {
            isSidechain = true;
            parentToolUseId = msgWithParent.parent_tool_use_id;
            parentUuid = this.sidechainLastUUID.get(parentToolUseId) ?? null;
            this.sidechainLastUUID.set(parentToolUseId, uuid);
        }
        const baseFields = this.buildBaseFields(uuid, parentUuid, isSidechain, parentToolUseId)

        let logMessage: RawJSONLines | null

        switch (sdkMessage.type) {
            case 'user': {
                const userMsg = sdkMessage as SDKUserMessage
                const userLog: RawJSONLines = {
                    ...baseFields,
                    ...userMsg,
                    type: 'user',
                }

                // Check if this is a tool result and add mode if available
                if (Array.isArray(userMsg.message.content)) {
                    for (const content of userMsg.message.content) {
                        if (content.type === 'tool_result' && content.tool_use_id && this.responses?.has(content.tool_use_id)) {
                            const response = this.responses.get(content.tool_use_id)
                            if (response?.mode) {
                                // userLog 类型为 RawJSONLines 联合(含 user/assistant/summary/system)，
                                // 仅 user variant 定义了 mode? 字段，故先按 type 守卫 narrow 再赋值
                                if (userLog.type === 'user') {
                                    userLog.mode = response.mode
                                }
                            }
                        }
                    }
                } else if (typeof userMsg.message.content === 'string') {
                    // Simple string content, no tool result
                }
                logMessage = userLog
                break
            }

            case 'assistant': {
                const assistantMsg = sdkMessage as SDKAssistantMessage
                logMessage = {
                    ...baseFields,
                    // Include all other fields
                    ...assistantMsg,
                    type: 'assistant',
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
                    // Include all other fields
                    ...systemMsg,
                    type: 'system',
                }
                break
            }

            case 'result': {
                // RawJSONLines schema 没有 'result' discriminant，但前端日志保留 result 消息的所有 SDK 字段
                // 通过 unknown 中转表达跨边界类型映射（运行时由 RawJSONLinesSchema.loose() 兜底）
                logMessage = {
                    ...baseFields,
                    ...(sdkMessage as SDKResultMessage),
                } as unknown as RawJSONLines
                break
            }

            default: {
                // 未知消息类型，透传所有字段（type 字段由 SDK 消息自带，显式覆盖确保被写入）
                const unknownMsg = sdkMessage as { type: string } & Record<string, unknown>
                logMessage = {
                    ...baseFields,
                    ...unknownMsg,
                    type: unknownMsg.type,
                } as unknown as RawJSONLines
            }
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
     * 与 convert(assistantMessage) 生成的结构一致，确保前端 snapshot 和完整消息格式相同。
     *
     * message.id 写入 Anthropic 分配的 id（由 message_start 捕获）：snapshot 与 full 共享同一 id，
     * 前端 resolveMessageCache 据此精确清理同 id 的 snapshot。替代脆弱的 parentUuid 关联——
     * snapshot 走主链 lastUuid、full 走各自 parent_tool_use_id 路径，parentUuid 必漂移。
     */
    convertSnapshot(
        contentBlocks: Array<
            | { type: 'text'; text: string }
            | { type: 'thinking'; thinking: string }
            | { type: 'tool_use'; id: string; name: string; input: unknown }
        >,
        opts?: { parentToolUseId?: string; model?: string; messageId?: string },
    ): RawJSONLines {
        const uuid = randomUUID()
        const parentToolUseId = opts?.parentToolUseId
        const parentUuid = parentToolUseId
            ? this.sidechainLastUUID.get(parentToolUseId) ?? null
            : this.lastUuid

        return {
            ...this.buildBaseFields(uuid, parentUuid, !!parentToolUseId, parentToolUseId),
            type: 'assistant',
            message: {
                role: 'assistant',
                id: opts?.messageId,
                content: contentBlocks,
                model: opts?.model,
            },
        } as RawJSONLines
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

        // message.content 为 unknown，permissions 字段是业务侧附加元数据，不影响 schema loose 校验
        const logMessage = {
            ...this.buildBaseFields(uuid, parentUuid, isSidechain, parentToolUseId ?? undefined),
            type: 'user' as const,
            message: {
                role: 'user',
                content: [
                    {
                        type: 'tool_result',
                        content: errorMessage,
                        is_error: true,
                        tool_use_id: toolUseId,
                        permissions: {
                            result: 'denied',
                            date: Date.now()
                        }
                    }
                ]
            },
            toolUseResult: `Error: ${errorMessage}`
        } as RawJSONLines
        
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
