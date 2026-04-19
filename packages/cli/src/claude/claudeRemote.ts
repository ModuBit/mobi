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

import { randomUUID } from 'node:crypto'
import { EnhancedMode } from "./loop";
import {
    query,
    type Options,
    type Query,
    type SDKMessage,
    type SDKSystemMessage,
    type SDKUserMessage,
    type SDKResultMessage,
} from '@anthropic-ai/claude-agent-sdk'
import { claudeCheckSession } from "./utils/claudeCheckSession";
import { join } from 'node:path';
import { parseSpecialCommand } from "@/parsers/specialCommands";
import { logger } from "@/lib";
import { PushableAsyncIterable } from "@/utils/PushableAsyncIterable";
import { getProjectPath } from "./utils/path";
import { awaitFileExist } from "@/modules/watcher/awaitFileExist";
import { systemPrompt } from "./utils/systemPrompt";
import type { PermissionResult } from "./sdk/types";
import type { PermissionUpdate } from "@anthropic-ai/claude-agent-sdk";
import { getMobiBlobsDir } from "@/constants/uploadPaths";
import { getDefaultClaudeCodePath } from "./sdk/utils";

export async function claudeRemote(opts: {

    // Fixed parameters
    sessionId: string | null,
    path: string,
    mcpServers?: Record<string, any>,
    claudeEnvVars?: Record<string, string>,
    claudeArgs?: string[],
    allowedTools: string[],
    hookSettingsPath: string,
    canCallTool: (toolName: string, input: unknown, mode: EnhancedMode, options: { signal: AbortSignal; suggestions?: PermissionUpdate[]; toolUseID?: string }) => Promise<PermissionResult>,

    // Dynamic parameters
    nextMessage: () => Promise<{ message: string, mode: EnhancedMode } | null>,
    onReady: () => void,

    // Callbacks
    onSessionFound: (id: string) => void,
    onThinkingChange?: (thinking: boolean) => void,
    onMessage: (message: SDKMessage) => void,
    onCompletionEvent?: (message: string) => void,
    onSessionReset?: () => void,
    // Query 就绪回调，用于外部获取 Query 引用（interrupt/close）
    onQueryReady?: (query: Query) => void,
}) {

    // Check if session is valid
    let startFrom = opts.sessionId;
    if (opts.sessionId && !claudeCheckSession(opts.sessionId, opts.path)) {
        startFrom = null;
    }

    // Extract --resume from claudeArgs if present (for first spawn)
    if (!startFrom && opts.claudeArgs) {
        for (let i = 0; i < opts.claudeArgs.length; i++) {
            if (opts.claudeArgs[i] === '--resume' || opts.claudeArgs[i] === '-r') {
                // Check if next arg exists and looks like a session ID
                if (i + 1 < opts.claudeArgs.length) {
                    const nextArg = opts.claudeArgs[i + 1];
                    // If next arg doesn't start with dash and contains dashes, it's likely a UUID
                    if (!nextArg.startsWith('-') && nextArg.includes('-')) {
                        startFrom = nextArg;
                        logger.debug(`[claudeRemote] Found --resume with session ID: ${startFrom}`);
                        // 验证 session 文件是否存在，不存在则忽略
                        if (!claudeCheckSession(startFrom, opts.path)) {
                            logger.debug(`[claudeRemote] Session file not found for ${startFrom}, ignoring --resume`);
                            startFrom = null;
                        }
                        break;
                    } else {
                        // Just --resume without UUID - SDK doesn't support this
                        logger.debug('[claudeRemote] Found --resume without session ID - not supported in remote mode');
                        break;
                    }
                } else {
                    // --resume at end of args - SDK doesn't support this
                    logger.debug('[claudeRemote] Found --resume without session ID - not supported in remote mode');
                    break;
                }
            }
        }
    }

    // Set environment variables for Claude Code SDK
    if (opts.claudeEnvVars) {
        Object.entries(opts.claudeEnvVars).forEach(([key, value]) => {
            process.env[key] = value;
        });
    }
    process.env.DISABLE_AUTOUPDATER = '1';

    // 预生成 claudeSessionId，让上游（metadata）立即可用
    // SDK 支持 Options.sessionId 指定自定义 session ID
    const pregeneratedSessionId = !startFrom ? randomUUID() : undefined
    if (pregeneratedSessionId) {
        logger.debug(`[claudeRemote] Pregenerated session ID: ${pregeneratedSessionId}`)
        opts.onSessionFound(pregeneratedSessionId)
    }

    // Get initial message
    const initial = await opts.nextMessage();
    if (!initial) { // No initial message - exit
        return;
    }

    // Handle special commands
    const specialCommand = parseSpecialCommand(initial.message);

    // Handle /clear command
    if (specialCommand.type === 'clear') {
        if (opts.onCompletionEvent) {
            opts.onCompletionEvent('Context was reset');
        }
        if (opts.onSessionReset) {
            opts.onSessionReset();
        }
        return;
    }

    // Handle /compact command
    let isCompactCommand = false;
    if (specialCommand.type === 'compact') {
        logger.debug('[claudeRemote] /compact command detected - will process as normal but with compaction behavior');
        isCompactCommand = true;
        if (opts.onCompletionEvent) {
            opts.onCompletionEvent('Compaction started');
        }
    }

    // Prepare SDK options
    let mode = initial.mode;
    const sdkOptions: Options = {
        cwd: opts.path,
        resume: startFrom ?? undefined,
        sessionId: pregeneratedSessionId,
        mcpServers: opts.mcpServers,
        permissionMode: initial.mode.permissionMode,
        model: initial.mode.model,
        fallbackModel: initial.mode.fallbackModel,
        // 使用 systemPrompt 配置（官方 SDK 格式）
        systemPrompt: initial.mode.customSystemPrompt
            ? initial.mode.customSystemPrompt + '\n\n' + systemPrompt
            : {
                type: 'preset' as const,
                preset: 'claude_code' as const,
                append: initial.mode.appendSystemPrompt
                    ? initial.mode.appendSystemPrompt + '\n\n' + systemPrompt
                    : systemPrompt,
            },
        allowedTools: initial.mode.allowedTools ? initial.mode.allowedTools.concat(opts.allowedTools) : opts.allowedTools,
        disallowedTools: initial.mode.disallowedTools,
        // canUseTool 回调
        canUseTool: async (toolName, input, options) => {
            const result = await opts.canCallTool(toolName, input, mode, {
                signal: options.signal,
                suggestions: options.suggestions,
                toolUseID: options.toolUseID,
            });
            // 直接返回完整的 PermissionResult，透传 updatedPermissions 等字段
            return result;
        },
        pathToClaudeCodeExecutable: getDefaultClaudeCodePath(),
        settings: opts.hookSettingsPath,
        additionalDirectories: [getMobiBlobsDir()],
    }

    // Track thinking state
    let thinking = false;
    const updateThinking = (newThinking: boolean) => {
        if (thinking !== newThinking) {
            thinking = newThinking;
            logger.debug(`[claudeRemote] Thinking state changed to: ${thinking}`);
            if (opts.onThinkingChange) {
                opts.onThinkingChange(thinking);
            }
        }
    };

    // Push initial message
    let messages = new PushableAsyncIterable<SDKUserMessage>();
    messages.push({
        type: 'user',
        message: {
            role: 'user',
            content: initial.message,
        },
        parent_tool_use_id: null,
        session_id: '', // SDK 会在运行时填充
    });

    // Start the loop
    const response = query({
        prompt: messages,
        options: sdkOptions,
    });

    // 把 Query 引用传给外部，用于 interrupt/close 控制
    opts.onQueryReady?.(response);

    updateThinking(true);
    try {
        logger.debug(`[claudeRemote] Starting to iterate over response`);

        for await (const message of response) {
            logger.debugLargeJson(`[claudeRemote] Message ${message.type}`, message);

            // Handle messages
            opts.onMessage(message);

            // Handle special system messages
            if (message.type === 'system' && message.subtype === 'init') {
                // Start thinking when session initializes
                updateThinking(true);

                const systemInit = message as SDKSystemMessage;

                // Session id is still in memory, wait until session file is written to disk
                // Start a watcher for to detect the session id
                if (systemInit.session_id) {
                    logger.debug(`[claudeRemote] Waiting for session file to be written to disk: ${systemInit.session_id}`);
                    const projectDir = getProjectPath(opts.path);
                    const found = await awaitFileExist(join(projectDir, `${systemInit.session_id}.jsonl`));
                    logger.debug(`[claudeRemote] Session file found: ${systemInit.session_id} ${found}`);
                    opts.onSessionFound(systemInit.session_id);
                }
            }

            // Handle result messages
            if (message.type === 'result') {
                updateThinking(false);
                const resultMsg = message as SDKResultMessage;
                const terminalReason = resultMsg.terminal_reason;
                const isInterrupt = terminalReason === 'aborted_streaming' || terminalReason === 'aborted_tools';

                if (isInterrupt) {
                    logger.debug('[claudeRemote] Interrupted, waiting for next message');
                } else {
                    logger.debug('[claudeRemote] Result received, waiting for next message');
                }

                // Send completion messages
                if (isCompactCommand) {
                    logger.debug('[claudeRemote] Compaction completed');
                    if (opts.onCompletionEvent) {
                        opts.onCompletionEvent('Compaction completed');
                    }
                    isCompactCommand = false;
                }

                // Send ready event
                opts.onReady();

                // Push next message
                const next = await opts.nextMessage();
                if (!next) {
                    messages.end();
                    return;
                }
                mode = next.mode;
                messages.push({
                    type: 'user',
                    message: { role: 'user', content: next.message },
                    parent_tool_use_id: null,
                    session_id: '', // SDK 会在运行时填充
                });
            }

        }
    } finally {
        updateThinking(false);
    }
}
