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
    startup,
    query,
    type Options,
    type Query,
    type WarmQuery,
    type SDKMessage,
    type SDKSystemMessage,
    type SDKUserMessage,
    type SDKAssistantMessage,
    type SDKResultMessage,
    type SDKPartialAssistantMessage,
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
import { stripBunDebuggerEnv } from '@/utils/spawnMobiCli'

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

function resolveResumeSessionId(claudeArgs: string[] | undefined, cwd: string): string | null {
    if (!claudeArgs) return null;

    for (let i = 0; i < claudeArgs.length; i++) {
        if (claudeArgs[i] !== '--resume' && claudeArgs[i] !== '-r') continue;

        const nextArg = claudeArgs[i + 1];
        if (nextArg && !nextArg.startsWith('-') && nextArg.includes('-')) {
            if (claudeCheckSession(nextArg, cwd)) {
                logger.debug(`[claudeRemote] Found --resume with session ID: ${nextArg}`);
                return nextArg;
            }
            logger.debug(`[claudeRemote] Session file not found for ${nextArg}, ignoring --resume`);
            return null;
        }

        logger.debug('[claudeRemote] Found --resume without session ID - not supported in remote mode');
        return null;
    }

    return null;
}

function handleStreamEvent(
    message: SDKPartialAssistantMessage,
    snapshotSender: StreamSnapshotSender,
    fallbackModel?: string,
): void {
    const event = message.event;
    const parentToolUseId = message.parent_tool_use_id;
    const sdkUuid = message.uuid;
    const eventIndex = (event as any).index;

    if (event.type === 'message_start') {
        snapshotSender.clearBuffers();
        const msgStart = (event as any).message;
        snapshotSender.setSnapshotOpts({
            parentToolUseId: parentToolUseId || undefined,
            model: msgStart?.model || fallbackModel,
            sdkUuid,
        });
    } else if (event.type === 'message_stop') {
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
        snapshotSender.endBlock(eventIndex);
    }
}

/**
 * 将 Promise 与 AbortSignal 竞争，signal abort 时返回 fallback
 */
function abortable<T>(promise: Promise<T>, signal: AbortSignal, fallback: T): Promise<T> {
    if (signal.aborted) return Promise.resolve(fallback)
    return Promise.race([
        promise,
        new Promise<T>((resolve) => {
            signal.addEventListener('abort', () => resolve(fallback), { once: true })
        }),
    ])
}

/**
 * 双循环共享上下文，用于 sdkOutputLoop 和 userInputLoop 之间通信
 */
export interface LoopContext {
    /** 是否为 /compact 命令（sdkOutputLoop 读取后重置） */
    isCompactCommand: boolean
}

/**
 * SDK 输出循环：持续拉取 SDK 消息并分发
 * 不再阻塞等待用户输入，后台任务产生的消息可被即时处理
 */
export async function sdkOutputLoop(
    response: Query,
    ctx: LoopContext,
    opts: {
        initialModel?: string
        path: string
        onMessage: (message: SDKMessage) => void
        snapshotSender: StreamSnapshotSender
        onSessionFound: (id: string) => void
        onReady: () => void
        onRunningChange: (running: boolean) => void
        onCompletionEvent?: (message: string) => void
        /** 中止信号，外部调用 abort() 时停止迭代 */
        signal?: AbortSignal
    },
): Promise<void> {
    let queryStarted = false;

    for await (const message of response) {
        // 外部中止时立即退出迭代
        if (opts.signal?.aborted) break

        if (!queryStarted) {
            queryStarted = true;
            logger.debug(`[sdkOutputLoop] First message received from SDK: ${message.type}/${('subtype' in message ? (message as { subtype: string }).subtype : '-')}`);
        }
        logger.debugLargeJson(`[sdkOutputLoop] Message ${message.type}`, message);

        // 处理流式事件：累积 delta 到 snapshot sender
        if (message.type === 'stream_event') {
            handleStreamEvent(message, opts.snapshotSender, opts.initialModel);
            continue;
        }

        // 收到完整 assistant 消息时刷新快照（不重置 index，由 message_start 处理）
        if (message.type === 'assistant') {
            opts.snapshotSender.flush();
        }

        // 分发消息
        opts.onMessage(message);

        // 处理 system/init 消息
        if (message.type === 'system' && message.subtype === 'init') {
            opts.onRunningChange(true);

            const systemInit = message as SDKSystemMessage;

            // 等待 session 文件写入磁盘
            if (systemInit.session_id) {
                logger.debug(`[sdkOutputLoop] Waiting for session file: ${systemInit.session_id}`);
                const projectDir = getProjectPath(opts.path);
                const found = await awaitFileExist(join(projectDir, `${systemInit.session_id}.jsonl`));
                logger.debug(`[sdkOutputLoop] Session file found: ${systemInit.session_id} ${found}`);
                opts.onSessionFound(systemInit.session_id);
            }
        }

        // 处理 result 消息：不阻塞，直接继续拉取后台消息
        if (message.type === 'result') {
            opts.onRunningChange(false);
            const { terminal_reason } = message as SDKResultMessage;
            const isInterrupt = terminal_reason === 'aborted_streaming' || terminal_reason === 'aborted_tools';

            if (isInterrupt) {
                logger.debug('[sdkOutputLoop] Interrupted');
            } else {
                logger.debug('[sdkOutputLoop] Result received');
            }

            // 读取并重置 isCompactCommand
            if (ctx.isCompactCommand) {
                logger.debug('[sdkOutputLoop] Compaction completed');
                opts.onCompletionEvent?.('Compaction completed');
                ctx.isCompactCommand = false;
            }

            // 通知就绪
            opts.onReady();
        }
    }

    logger.debug(`[sdkOutputLoop] Response iteration ended normally. queryStarted=${queryStarted}`);
}

/**
 * 用户输入循环：独立等待用户消息并推送到 PushableAsyncIterable
 * 与 sdkOutputLoop 并行运行，互不阻塞
 */
export async function userInputLoop(
    messages: PushableAsyncIterable<SDKUserMessage>,
    ctx: LoopContext,
    opts: {
        nextMessage: () => Promise<{ message: string, mode: EnhancedMode } | null>
        specialCommandCtx: SpecialCommandContext
        /** 中止信号，外部调用 abort() 时退出循环 */
        signal?: AbortSignal
    },
): Promise<void> {
    while (!opts.signal?.aborted) {
        // 将 nextMessage 与 abort 信号竞争，避免 sdkOutputLoop 结束后永远挂起
        const next = await (opts.signal
            ? abortable(opts.nextMessage(), opts.signal, null)
            : opts.nextMessage()
        )

        // null 或已中止 → 结束
        if (!next || opts.signal?.aborted) {
            messages.end();
            return;
        }

        const result = await handleSpecialCommand(next.message, opts.specialCommandCtx);

        // 需要退出（如 /clear）
        if (result.shouldExit) {
            messages.end();
            return;
        }

        // /compact 命令：设置标记并继续发送给 SDK
        if (result.isCompact) {
            ctx.isCompactCommand = true;
        }

        // 已处理但非 compact（即 bash），继续等待下一条
        if (result.handled && !result.isCompact) {
            continue;
        }

        // 普通消息或 compact，推送到 messages
        messages.push({
            type: 'user',
            message: { role: 'user', content: sanitizeUserMessage(next.message) },
            parent_tool_use_id: null,
            session_id: '',
        });
    }
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
    getSessionConfig: () => EnhancedMode,
    flushConfig?: () => void,
    canCallTool: (toolName: string, input: unknown, options: { signal: AbortSignal; suggestions?: PermissionUpdate[]; toolUseID?: string } & SDKUIHints) => Promise<PermissionResult>,

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

    if (!startFrom) {
        startFrom = resolveResumeSessionId(opts.claudeArgs, opts.path);
    }

    // Set environment variables for Claude Code SDK
    if (opts.claudeEnvVars) {
        Object.entries(opts.claudeEnvVars).forEach(([key, value]) => {
            process.env[key] = value;
        });
    }
    process.env.DISABLE_AUTOUPDATER = '1';

    // 清理 IDE 调试器环境变量，避免 SDK spawn 的 claude 子进程继承后冲突
    stripBunDebuggerEnv(process.env as Record<string, string | undefined>);

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

    // 并行：预热子进程 + 等待用户首条消息
    let warmRef: WarmQuery | null = null

    const baseConfig = opts.getSessionConfig()
    const sdkOptions: Options = {
        cwd: opts.path,
        includePartialMessages: true,
        agentProgressSummaries: true,
        resume: startFrom ?? undefined,
        sessionId: pregeneratedSessionId,
        mcpServers: opts.mcpServers,
        permissionMode: baseConfig.permissionMode,
        model: baseConfig.model,
        // effort 依赖 thinking 默认值 { type: 'adaptive' } 才能生效，SDK 默认即为 adaptive
        effort: baseConfig.effort,
        fallbackModel: baseConfig.fallbackModel,
        systemPrompt: baseConfig.customSystemPrompt
            ? baseConfig.customSystemPrompt + '\n\n' + systemPrompt
            : {
                type: 'preset' as const,
                preset: 'claude_code' as const,
                append: baseConfig.appendSystemPrompt
                    ? baseConfig.appendSystemPrompt + '\n\n' + systemPrompt
                    : systemPrompt,
            },
        allowedTools: baseConfig.allowedTools ? baseConfig.allowedTools.concat(opts.allowedTools) : opts.allowedTools,
        disallowedTools: baseConfig.disallowedTools,
        canUseTool: async (toolName, input, options) => {
            const result = await opts.canCallTool(toolName, input, options);
            return result;
        },
        pathToClaudeCodeExecutable: getDefaultClaudeCodePath(),
        settings: opts.hookSettingsPath,
        additionalDirectories: [getMobiBlobsDir()],
        toolConfig: {
            askUserQuestion: { previewFormat: 'html' }
        },
    }

    const [warmSettled, msgSettled] = await Promise.allSettled([
        startup({ options: sdkOptions }),
        opts.nextMessage(),
    ])

    if (warmSettled.status === 'fulfilled') {
        warmRef = warmSettled.value
    }

    if (msgSettled.status !== 'fulfilled' || !msgSettled.value) {
        warmRef?.close()
        return
    }
    const initial = msgSettled.value

    const specialCommandCtx = createSpecialCommandContext(opts, executeBashCommand)
    const initialResult = await handleSpecialCommand(initial.message, specialCommandCtx)

    if (initialResult.shouldExit) {
        warmRef?.close()
        return
    }

    if (initialResult.handled && !initialResult.isCompact) {
        warmRef?.close()
        return
    }

    let isCompactCommand = initialResult.isCompact;

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

    let warmConsumed = false;
    let response: Query;
    if (warmRef) {
        response = warmRef.query(messages)
        warmConsumed = true
    } else {
        const fallbackConfig = opts.getSessionConfig()
        const fallbackOptions: Options = {
            ...sdkOptions,
            permissionMode: fallbackConfig.permissionMode,
            model: fallbackConfig.model,
            effort: fallbackConfig.effort,
        }
        response = query({ prompt: messages, options: fallbackOptions })
    }

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

    const loopCtx: LoopContext = {
        isCompactCommand,
    }

    // 双循环协调：任一退出时 abort 通知另一个终止
    const loopAbort = new AbortController()

    try {
        await Promise.race([
            sdkOutputLoop(response, loopCtx, {
                initialModel: initial.mode.model,
                path: opts.path,
                onMessage: opts.onMessage,
                snapshotSender,
                onSessionFound: opts.onSessionFound,
                onReady: opts.onReady,
                onRunningChange: updateRunning,
                onCompletionEvent: opts.onCompletionEvent,
                signal: loopAbort.signal,
            }),
            userInputLoop(messages, loopCtx, {
                nextMessage: opts.nextMessage,
                specialCommandCtx,
                signal: loopAbort.signal,
            }),
        ])
    } catch (e) {
        // 增强错误日志：捕获 SDK 抛出的非标准错误对象
        const errorInfo = e instanceof Error
            ? { name: e.name, message: e.message, stack: e.stack?.substring(0, 500) }
            : { type: typeof e, value: String(e), keys: typeof e === 'object' && e !== null ? Object.keys(e) : [] };
        logger.debug(`[claudeRemote] Error iterating response:`, errorInfo);
        throw e;
    } finally {
        // 通知未退出的循环终止
        loopAbort.abort()
        // 关闭 SDK 输出，确保 sdkOutputLoop 停止迭代
        try { response.close() } catch (e) {
            logger.debug(`[claudeRemote] Error closing response:`, e)
        }
        snapshotSender.destroy();
        updateRunning(false);
        if (!warmConsumed) warmRef?.close();
    }
}
