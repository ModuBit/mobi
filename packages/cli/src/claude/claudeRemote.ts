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
    type SDKAssistantMessage,
    type SDKResultMessage,
} from '@anthropic-ai/claude-agent-sdk'
import { claudeCheckSession } from "./utils/claudeCheckSession";
import { join } from 'node:path';
import { parseSpecialCommand, checkDangerousCommand } from "@/parsers/specialCommands";
import { logger } from "@/lib";
import { PushableAsyncIterable } from "@/utils/PushableAsyncIterable";
import { getProjectPath } from "./utils/path";
import { awaitFileExist } from "@/modules/watcher/awaitFileExist";
import { systemPrompt } from "./utils/systemPrompt";
import type { PermissionResult } from "./sdk/types";
import type { PermissionUpdate } from "@anthropic-ai/claude-agent-sdk";
import type { SDKUIHints } from "@mobi/shared";
import { getMobiBlobsDir } from "@/constants/uploadPaths";
import { getDefaultClaudeCodePath } from "./sdk/utils";
import { wrapCommand, cleanupSandbox, spawnWithTimeout } from "@/modules/sandbox/sandboxManager";
import { StreamSnapshotSender } from './utils/streamSnapshotSender'

/**
 * 特殊命令处理结果
 */
export type SpecialCommandResult = {
    /** 是否已处理（不需要继续发送给 SDK） */
    handled: boolean
    /** 是否需要退出（如 /clear） */
    shouldExit: boolean
    /** 是否是 /compact 命令 */
    isCompact: boolean
}

/**
 * 特殊命令处理上下文
 */
export type SpecialCommandContext = {
    onClear: () => void
    onCompactStart: () => void
    executeBash: (cmd: string) => Promise<void>
    onReady: () => void
}

/**
 * 创建特殊命令处理上下文
 */
export function createSpecialCommandContext(
    opts: {
        onCompletionEvent?: (message: string) => void
        onContextCleared?: () => void
        onSessionReset?: () => void
        onReady: () => void
    },
    executeBash: (cmd: string) => Promise<void>
): SpecialCommandContext {
    return {
        onClear: () => {
            if (opts.onContextCleared) {
                opts.onContextCleared()
            } else {
                opts.onCompletionEvent?.('Context was reset')
            }
            opts.onSessionReset?.()
        },
        onCompactStart: () => {
            opts.onCompletionEvent?.('Compaction started')
        },
        executeBash,
        onReady: opts.onReady,
    }
}

/**
 * 统一处理特殊命令（/clear、/compact、!bash）
 * @param message 用户消息
 * @param context 处理上下文
 * @returns 处理结果
 */
export async function handleSpecialCommand(
    message: string,
    context: SpecialCommandContext
): Promise<SpecialCommandResult> {
    const special = parseSpecialCommand(message)

    // /clear: 重置 session，退出当前循环
    if (special.type === 'clear') {
        context.onClear()
        return { handled: true, shouldExit: true, isCompact: false }
    }

    // /compact: 标记为 compact 命令，继续发送给 SDK
    if (special.type === 'compact') {
        logger.debug('[claudeRemote] /compact command detected')
        context.onCompactStart()
        return { handled: true, shouldExit: false, isCompact: true }
    }

    // !bash: 本地执行，继续等待下一条消息
    if (special.type === 'bash' && special.command) {
        await context.executeBash(special.command)
        context.onReady()
        return { handled: true, shouldExit: false, isCompact: false }
    }

    // 普通消息，发送给 SDK
    return { handled: false, shouldExit: false, isCompact: false }
}

/** !bash 合成 tool call ID 的前缀 */
const BASH_TOOL_CALL_PREFIX = '!bash_'

// 仅填充 sdkToLogConverter/normalizeAgent 所需的 message.content，其余字段省略
function createBashToolUseMessage(toolCallId: string, command: string): SDKAssistantMessage {
    return {
        type: 'assistant',
        message: {
            role: 'assistant',
            content: [{ type: 'tool_use', id: toolCallId, name: 'Bash', input: { command } }],
        },
        parent_tool_use_id: null,
        session_id: '',
    } as unknown as SDKAssistantMessage
}

// 仅填充 sdkToLogConverter/normalizeAgent 所需的 message.content，其余字段省略
function createBashToolResultMessage(
    toolCallId: string,
    content: string,
    isError: boolean,
): SDKUserMessage {
    return {
        type: 'user',
        message: {
            role: 'user',
            content: [{ type: 'tool_result', tool_use_id: toolCallId, content, is_error: isError }],
        },
        parent_tool_use_id: null,
        session_id: '',
    } as unknown as SDKUserMessage
}

/**
 * 对用户消息进行预处理：
 * 将 $...$ 替换为 \(...\)，避免触发 Claude API 的 prompt injection 过滤器。
 * \( ... \) 与 $ ... $ 是等价的 LaTeX 行内公式语法。
 */
export function sanitizeUserMessage(message: string): string {
    // 匹配成对的 $（排除已转义的 \$ 和块级 $$...$$），中间不含换行或另一对 $
    return message.replace(/(?<!\\)\$(?!\$)([^$\n]+?)(?<!\$)\$(?!\$)/g, '\\($1\\)')
}

export async function claudeRemote(opts: {

    // Fixed parameters
    sessionId: string | null,
    path: string,
    mcpServers?: Record<string, any>,
    claudeEnvVars?: Record<string, string>,
    claudeArgs?: string[],
    allowedTools: string[],
    hookSettingsPath: string,
    canCallTool: (toolName: string, input: unknown, mode: EnhancedMode, options: { signal: AbortSignal; suggestions?: PermissionUpdate[]; toolUseID?: string } & SDKUIHints) => Promise<PermissionResult>,

    // Dynamic parameters
    nextMessage: () => Promise<{ message: string, mode: EnhancedMode } | null>,
    onReady: () => void,

    // Callbacks
    onSessionFound: (id: string) => void,
    onRunningChange?: (running: boolean) => void,
    onMessage: (message: SDKMessage) => void,
    onSnapshot: (msg: import('@mobi/shared').DecryptedMessage) => void,
    /** Snapshot converter，用于生成与最终消息一致的 DecryptedMessage */
    getConverter: () => import('./utils/sdkToLogConverter').SDKToLogConverter,
    onCompletionEvent?: (message: string) => void,
    onContextCleared?: () => void,
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

    // 清理 IDE 调试器环境变量，避免子进程继承后冲突
    // BUN_INSPECT 会导致 claude 进程尝试绑定已占用的 socket 而 EADDRINUSE 崩溃
    delete process.env.BUN_INSPECT;
    delete process.env.BUN_INSPECT_NOTIFY;
    delete process.env.BUN_DEBUG_QUIET_LOGS;
    delete process.env.BUN_QUIET_DEBUG_LOGS;

    // 预生成 claudeSessionId，让上游（metadata）立即可用
    // SDK 支持 Options.sessionId 指定自定义 session ID
    const pregeneratedSessionId = !startFrom ? randomUUID() : undefined
    if (pregeneratedSessionId) {
        logger.debug(`[claudeRemote] Pregenerated session ID: ${pregeneratedSessionId}`)
        opts.onSessionFound(pregeneratedSessionId)
    }

    // !bash: 本地执行 shell 命令，不走 SDK，生成 tool_use/tool_result 消息对
    const executeBashCommand = async (command: string): Promise<void> => {
        logger.debug(`[claudeRemote] Bash command detected: ${command}`)

        const toolCallId = `${BASH_TOOL_CALL_PREFIX}${randomUUID()}`

        // 高危命令拦截
        const dangerCheck = checkDangerousCommand(command)
        if (dangerCheck.isDangerous) {
            logger.warn(`[claudeRemote] Dangerous command blocked: ${command} (${dangerCheck.reason})`)
            opts.onMessage(createBashToolUseMessage(toolCallId, command))
            opts.onMessage(createBashToolResultMessage(
                toolCallId,
                `⚠ 命令已拦截：${dangerCheck.reason}`,
                true,
            ))
            return
        }

        opts.onRunningChange?.(true)
        opts.onMessage(createBashToolUseMessage(toolCallId, command))

        // 在用户工作目录下执行命令（沙箱隔离 + 超时控制）
        let stdout = ''
        let stderr = ''
        let hasError = false
        try {
            const sandboxedCommand = await wrapCommand(command)
            const result = await spawnWithTimeout(sandboxedCommand, {
                cwd: opts.path,
                timeout: 30000,
            })
            stdout = result.stdout
            stderr = result.stderr
            if (result.timedOut) {
                hasError = true
                stderr += (stderr ? '\n' : '') + '命令执行超时（30s）'
            }
        } catch (error) {
            hasError = true
            stderr = error instanceof Error ? error.message : String(error)
        } finally {
            cleanupSandbox()
        }

        const output = stdout && stderr
            ? `${stdout}\n${stderr}`
            : stdout || stderr

        opts.onMessage(createBashToolResultMessage(toolCallId, output, hasError))

        opts.onRunningChange?.(false)
    }

    // Get initial message
    const initial = await opts.nextMessage();
    if (!initial) { // No initial message - exit
        return;
    }

    // Handle special commands for initial message
    const specialCommandCtx = createSpecialCommandContext(opts, executeBashCommand)
    const initialResult = await handleSpecialCommand(initial.message, specialCommandCtx)

    if (initialResult.shouldExit) {
        return
    }

    // 如果是 !bash，已经执行完毕，等待下一条消息
    if (initialResult.handled && !initialResult.isCompact) {
        return
    }

    // Prepare SDK options
    let mode = initial.mode;
    let isCompactCommand = initialResult.isCompact;
    const sdkOptions: Options = {
        cwd: opts.path,
        includePartialMessages: true,
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
            const result = await opts.canCallTool(toolName, input, mode, options);
            // 直接返回完整的 PermissionResult，透传 updatedPermissions 等字段
            return result;
        },
        pathToClaudeCodeExecutable: getDefaultClaudeCodePath(),
        settings: opts.hookSettingsPath,
        additionalDirectories: [getMobiBlobsDir()],
    }

    // Track running state
    let running = false;
    const updateRunning = (newRunning: boolean) => {
        if (running !== newRunning) {
            running = newRunning;
            logger.debug(`[claudeRemote] Running state changed to: ${running}`);
            if (opts.onRunningChange) {
                opts.onRunningChange(running);
            }
        }
    };

    // Push initial message
    let messages = new PushableAsyncIterable<SDKUserMessage>();
    messages.push({
        type: 'user',
        message: {
            role: 'user',
            content: sanitizeUserMessage(initial.message),
        },
        parent_tool_use_id: null,
        session_id: '', // SDK 会在运行时填充
    });

    // Start the loop
    let queryStarted = false;
    const response = query({
        prompt: messages,
        options: sdkOptions,
    });

    // 把 Query 引用传给外部，用于 interrupt/close 控制
    opts.onQueryReady?.(response);

    updateRunning(true);

    // 流式输出：Snapshot 发送器
    const converter = opts.getConverter()
    const snapshotSender = new StreamSnapshotSender(
        opts.onSnapshot,
        converter,
    );
    snapshotSender.start();

    try {
        logger.debug(`[claudeRemote] Starting to iterate over response`);

        for await (const message of response) {
            if (!queryStarted) {
                queryStarted = true;
                logger.debug(`[claudeRemote] First message received from SDK: ${message.type}/${('subtype' in message ? (message as { subtype: string }).subtype : '-')}`);
            }
            logger.debugLargeJson(`[claudeRemote] Message ${message.type}`, message);

            // 处理流式事件：累积 delta 到 snapshot sender
            if (message.type === 'stream_event') {
                const event = message.event;
                const parentToolUseId = (message as any).parent_tool_use_id;
                // SDK stream_event 的 uuid 仅用于标识本次流式消息，与最终 assistant 消息的 uuid 不同
                const sdkUuid = (message as any).uuid;
                // 使用 SDK 事件自带的 index，避免手动追踪
                const eventIndex = (event as any).index;

                if (event.type === 'message_start') {
                    // 新消息开始，清除旧 buffer
                    snapshotSender.clearBuffers();
                    const msgStart = (event as any).message;
                    snapshotSender.setSnapshotOpts({
                        parentToolUseId: parentToolUseId || undefined,
                        model: msgStart?.model || initial.mode.model,
                        sdkUuid,
                    });
                } else if (event.type === 'message_stop') {
                    // 消息结束，刷新剩余快照
                    snapshotSender.flush();
                } else if (event.type === 'content_block_start') {
                    const block = (event as any).content_block;
                    if (block?.type === 'text') {
                        snapshotSender.startBlock(eventIndex, 'text');
                    } else if (block?.type === 'thinking') {
                        snapshotSender.startBlock(eventIndex, 'thinking');
                    }
                } else if (event.type === 'content_block_delta') {
                    const delta = (event as any).delta;
                    if (delta?.type === 'text_delta') {
                        snapshotSender.append(eventIndex, delta.text);
                    } else if (delta?.type === 'thinking_delta') {
                        snapshotSender.append(eventIndex, delta.thinking);
                    }
                } else if (event.type === 'content_block_stop') {
                    // 内容块结束，刷新并发送最终内容，移除缓冲区
                    // 避免后续 flush 带上已完成的内容块（如 thinking 完成后不再包含在 text 阶段的 snapshot 中）
                    snapshotSender.endBlock(eventIndex);
                }
                continue;
            }

            // 收到完整 assistant 消息时刷新快照（不重置 index，由 message_start 处理）
            if (message.type === 'assistant') {
                snapshotSender.flush();
            }

            // Handle messages
            opts.onMessage(message);

            // Handle special system messages
            if (message.type === 'system' && message.subtype === 'init') {
                // Start running when session initializes
                updateRunning(true);

                const systemInit = message as SDKSystemMessage;

                // Session id is still in memory, wait until session file is written to disk
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
                updateRunning(false);
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

                // Push next message - 处理特殊命令
                let next = await opts.nextMessage();
                while (next) {
                    const result = await handleSpecialCommand(next.message, specialCommandCtx)

                    if (result.shouldExit) {
                        messages.end()
                        return
                    }

                    if (result.isCompact) {
                        isCompactCommand = true
                    }

                    // 如果已处理但不是 compact（即 bash），继续等待下一条
                    if (result.handled && !result.isCompact) {
                        next = await opts.nextMessage()
                        continue
                    }

                    // 普通消息或 compact，跳出循环发送给 SDK
                    break
                }

                if (!next) {
                    messages.end();
                    return;
                }

                mode = next.mode;
                messages.push({
                    type: 'user',
                    message: { role: 'user', content: sanitizeUserMessage(next.message) },
                    parent_tool_use_id: null,
                    session_id: '', // SDK 会在运行时填充
                });
            }

        }

        // for await 正常结束（迭代器耗尽，无异常）
        logger.debug(`[claudeRemote] Response iteration ended normally. queryStarted=${queryStarted}`);
    } catch (e) {
        // 增强错误日志：捕获 SDK 抛出的非标准错误对象
        const errorInfo = e instanceof Error
            ? { name: e.name, message: e.message, stack: e.stack?.substring(0, 500) }
            : { type: typeof e, value: String(e), keys: typeof e === 'object' && e !== null ? Object.keys(e) : [] };
        logger.debug(`[claudeRemote] Error iterating response:`, errorInfo);
        throw e;
    } finally {
        snapshotSender.destroy();
        updateRunning(false);
    }
}
