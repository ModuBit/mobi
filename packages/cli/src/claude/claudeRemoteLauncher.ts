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

import React from "react";
import { Session } from "./session";
import { RemoteModeDisplay } from "@/ui/ink/RemoteModeDisplay";
import { claudeRemote } from "./claudeRemote";
import { PermissionHandler } from "./utils/permissionHandler";
import { Future } from "@/utils/future";
import type { SDKAssistantMessage, SDKMessage, SDKUserMessage, Query } from "@anthropic-ai/claude-agent-sdk";
import type { ContentBlockParam } from "@anthropic-ai/sdk/resources/messages";
import { formatClaudeMessageForInk } from "@/ui/messageFormatterInk";
import { logger } from "@/ui/logger";
import { SDKToLogConverter } from "./utils/sdkToLogConverter";
import { PLAN_FAKE_REJECT } from "./sdk/prompts";
import { EnhancedMode, type QueryControlRef } from "./loop";
import { OutgoingMessageQueue } from "./utils/OutgoingMessageQueue";
import type { RawJSONLines } from "./types";
import { classifyMessage } from '@mobi/shared';
import type { ClaudePermissionMode } from "@mobi/shared/types";
import {
    RemoteLauncherBase,
    type RemoteLauncherDisplayContext,
    type RemoteLauncherExitReason
} from "@/modules/common/remote/RemoteLauncherBase";

interface PermissionsField {
    date: number;
    result: 'approved' | 'denied';
    mode?: ClaudePermissionMode;
    allowedTools?: string[];
}

class ClaudeRemoteLauncher extends RemoteLauncherBase {
    private readonly session: Session;
    private readonly processCleanupRef?: { current: (() => void) | null };
    private readonly queryControlRef?: QueryControlRef;
    private readonly getSessionConfig: () => EnhancedMode;
    private readonly flushConfig: () => void;
    private abortController: AbortController | null = null;
    private abortFuture: Future<void> | null = null;
    private permissionHandler: PermissionHandler | null = null;
    private handleSessionFound: ((sessionId: string) => void) | null = null;
    // SDK Query 引用，用于 interrupt/close 控制
    private queryRef: Query | null = null;

    constructor(
        session: Session,
        processCleanupRef?: { current: (() => void) | null },
        queryControlRef?: QueryControlRef,
        getSessionConfig: () => EnhancedMode = () => ({ permissionMode: 'default' }),
        flushConfig: () => void = () => {},
    ) {
        super(process.env.DEBUG ? session.logPath : undefined);
        this.session = session;
        this.processCleanupRef = processCleanupRef;
        this.queryControlRef = queryControlRef;
        this.getSessionConfig = getSessionConfig;
        this.flushConfig = flushConfig;
    }

    protected createDisplay(context: RemoteLauncherDisplayContext): React.ReactElement {
        return React.createElement(RemoteModeDisplay, context);
    }

    private async abort(): Promise<void> {
        if (this.abortController && !this.abortController.signal.aborted) {
            this.abortController.abort();
        }
        await this.abortFuture?.promise;
    }

    private async handleAbortRequest(): Promise<void> {
        logger.debug('[remote]: doAbort');
        if (this.queryRef) {
            // 优雅中断：SDK 发送 result，内循环不退出，等待下一条用户消息
            await this.queryRef.interrupt();
        } else {
            // Query 还没创建，直接 abort signal
            await this.abort();
        }
    }

    private async handleSwitchRequest(): Promise<void> {
        logger.debug('[remote]: doSwitch');
        await this.requestExit('switch', async () => {
            this.queryRef?.close();
            this.queryRef = null;
            await this.abort();
        });
    }

    private async handleExitFromUi(): Promise<void> {
        logger.debug('[remote]: Exiting client via Ctrl-C');
        await this.requestExit('exit', async () => {
            this.queryRef?.close();
            this.queryRef = null;
            await this.abort();
        });
    }

    private async handleSwitchFromUi(): Promise<void> {
        logger.debug('[remote]: Switching to local mode via double space');
        await this.handleSwitchRequest();
    }

    public async launch(): Promise<RemoteLauncherExitReason> {
        return this.start({
            onExit: () => this.handleExitFromUi(),
            onSwitchToLocal: () => this.handleSwitchFromUi()
        });
    }

    protected async runMainLoop(): Promise<void> {
        logger.debug('[claudeRemoteLauncher] Starting remote launcher');
        logger.debug(`[claudeRemoteLauncher] TTY available: ${this.hasTTY}`);

        const session = this.session;
        const messageBuffer = this.messageBuffer;

        this.setupAbortHandlers(session.client.rpcHandlerManager, {
            onAbort: () => this.handleAbortRequest(),
            onSwitch: () => this.handleSwitchRequest()
        });

        // 注册 stop-task RPC 处理器，用于远程停止后台任务
        session.client.rpcHandlerManager.registerHandler('stop-task', async (params) => {
            const { taskId } = params as { taskId: string }
            if (this.queryRef) {
                await this.queryRef.stopTask(taskId)
            }
        });

        const permissionHandler = new PermissionHandler(session);
        this.permissionHandler = permissionHandler;

        const messageQueue = new OutgoingMessageQueue<RawJSONLines>(
            (logMessage) => session.client.sendClaudeSessionMessage(logMessage)
        );

        permissionHandler.setOnPermissionRequest((toolCallId: string) => {
            messageQueue.releaseToolCall(toolCallId);
        });

        const sdkToLogConverter = new SDKToLogConverter({
            sessionId: session.sessionId || 'unknown',
            cwd: session.path,
            version: process.env.npm_package_version
        }, permissionHandler.getResponses());

        const handleSessionFound = (sessionId: string) => {
            sdkToLogConverter.updateSessionId(sessionId);
        };
        this.handleSessionFound = handleSessionFound;
        session.addSessionFoundCallback(handleSessionFound);

        // 跟踪 exit_plan_mode 工具调用的 ID，用于在收到 tool_result 时检测并处理 plan mode 退出逻辑
        // 当用户批准 plan mode 退出时，permissionHandler 会故意返回 deny + PLAN_FAKE_REJECT 来"欺骗" SDK
        // 此处需要拦截 PLAN_FAKE_REJECT 并替换为正常结果，同时 SDK 会处理注入的 PLAN_FAKE_RESTART 消息
        const planModeToolCalls = new Set<string>();
        // 跟踪 enter_plan_mode 工具调用，成功后同步 permissionMode 为 plan
        const enterPlanModeToolCalls = new Set<string>();
        // 跟踪所有正在执行中的工具调用，记录 parentToolCallId 用于处理嵌套工具调用场景
        // 工具开始执行时添加，收到 tool_result 时移除
        const ongoingToolCalls = new Map<string, { parentToolCallId: string | null }>();

        function onMessage(message: SDKMessage) {
            // 重置空闲计时器（Agent 输出）
            session.client.resetIdleTimer();

            formatClaudeMessageForInk(message, messageBuffer);
            permissionHandler.onMessage(message);

            if (message.type === 'assistant') {
                const umessage = message as SDKAssistantMessage;
                if (umessage.message.content && Array.isArray(umessage.message.content)) {
                    for (const c of umessage.message.content) {
                        if (c.type === 'tool_use') {
                            logger.debug('[remote]: detected tool use ' + c.id! + ' parent: ' + umessage.parent_tool_use_id);
                            ongoingToolCalls.set(c.id!, { parentToolCallId: umessage.parent_tool_use_id ?? null });
                            if (c.name === 'exit_plan_mode' || c.name === 'ExitPlanMode') {
                                logger.debug('[remote]: detected plan mode tool call ' + c.id!);
                                planModeToolCalls.add(c.id! as string);
                            }
                            if (c.name === 'enter_plan_mode' || c.name === 'EnterPlanMode') {
                                logger.debug('[remote]: detected enter plan mode tool call ' + c.id!);
                                enterPlanModeToolCalls.add(c.id! as string);
                            }
                        }
                    }
                }
            }
            if (message.type === 'user') {
                const umessage = message as SDKUserMessage;
                if (umessage.message.content && Array.isArray(umessage.message.content)) {
                    for (const c of umessage.message.content) {
                        if (c.type === 'tool_result' && c.tool_use_id) {
                            ongoingToolCalls.delete(c.tool_use_id);
                            messageQueue.releaseToolCall(c.tool_use_id);
                        }
                    }
                }
            }

            let msg = message;

            if (message.type === 'user') {
                const umessage = message as SDKUserMessage;
                if (umessage.message.content && Array.isArray(umessage.message.content)) {
                    msg = {
                        ...umessage,
                        message: {
                            ...umessage.message,
                            content: umessage.message.content.map((c: ContentBlockParam): ContentBlockParam => {
                                if (c.type === 'tool_result' && c.tool_use_id && planModeToolCalls.has(c.tool_use_id)) {
                                    planModeToolCalls.delete(c.tool_use_id);
                                    if (c.content === PLAN_FAKE_REJECT) {
                                        logger.debug('[remote]: hack plan mode exit');
                                        logger.debugLargeJson('[remote]: hack plan mode exit', c);
                                        // 透传可能存在的自定义 mode 字段（permissions 相关），保持与历史行为一致
                                        const mode = (c as ContentBlockParam & { mode?: unknown }).mode;
                                        return {
                                            ...c,
                                            is_error: false,
                                            content: 'Plan approved',
                                            ...(mode !== undefined ? { mode } : {}),
                                        } as ContentBlockParam;
                                    }
                                    return c;
                                }
                                if (c.type === 'tool_result' && c.tool_use_id && enterPlanModeToolCalls.has(c.tool_use_id)) {
                                    enterPlanModeToolCalls.delete(c.tool_use_id);
                                    if (!c.is_error) {
                                        logger.debug('[remote]: enter plan mode succeeded, syncing permissionMode');
                                        permissionHandler.handleModeChange('plan');
                                    }
                                    return c;
                                }
                                return c;
                            })
                        }
                    };
                }
            }

            const logMessage = sdkToLogConverter.convert(msg);
            if (logMessage) {
                // 过滤 discard 类消息，不发送到 Hub
                if (classifyMessage(logMessage.type, (logMessage as { subtype?: string }).subtype) === 'discard') {
                    return
                }

                if (logMessage.type === 'user' && logMessage.message?.content) {
                    const content = Array.isArray(logMessage.message.content)
                        ? logMessage.message.content
                        : [];

                    for (let i = 0; i < content.length; i++) {
                        const c = content[i];
                        if (c.type === 'tool_result' && c.tool_use_id) {
                            const responses = permissionHandler.getResponses();
                            const response = responses.get(c.tool_use_id);

                            if (response) {
                                const permissions: PermissionsField = {
                                    date: response.receivedAt || Date.now(),
                                    result: response.approved ? 'approved' : 'denied'
                                };

                                if (response.mode) {
                                    permissions.mode = response.mode;
                                }

                                if (response.allowTools && response.allowTools.length > 0) {
                                    permissions.allowedTools = response.allowTools;
                                }

                                content[i] = {
                                    ...c,
                                    permissions
                                };
                            }
                        }
                    }
                }

                if (logMessage.type === 'assistant' && message.type === 'assistant') {
                    const assistantMsg = message as SDKAssistantMessage;
                    const toolCallIds: string[] = [];

                    if (assistantMsg.message.content && Array.isArray(assistantMsg.message.content)) {
                        for (const block of assistantMsg.message.content) {
                            if (block.type === 'tool_use' && block.id) {
                                toolCallIds.push(block.id);
                            }
                        }
                    }

                    if (toolCallIds.length > 0) {
                        const isSidechain = assistantMsg.parent_tool_use_id !== undefined;

                        if (!isSidechain) {
                            messageQueue.enqueue(logMessage, {
                                delay: 250,
                                toolCallIds
                            });
                            return;
                        }
                    }
                }

                messageQueue.enqueue(logMessage);
            }

            if (message.type === 'assistant') {
                const umessage = message as SDKAssistantMessage;
                if (umessage.message.content && Array.isArray(umessage.message.content)) {
                    for (const c of umessage.message.content) {
                        if (c.type === 'tool_use' && c.name === 'Task' && c.input && typeof (c.input as Record<string, unknown>).prompt === 'string') {
                            const logMessage2 = sdkToLogConverter.convertSidechainUserMessage(c.id!, (c.input as Record<string, unknown>).prompt as string);
                            if (logMessage2) {
                                messageQueue.enqueue(logMessage2);
                            }
                        }
                    }
                }
            }
        }

        try {
            let pending: {
                message: string;
                mode: EnhancedMode;
            } | null = null;

            let previousSessionId: string | null = null;
            while (!this.exitReason) {
                logger.debug('[remote]: launch');
                messageBuffer.addMessage('═'.repeat(40), 'status');

                const isNewSession = session.sessionId !== previousSessionId;
                if (isNewSession) {
                    messageBuffer.addMessage('Starting new Claude session...', 'status');
                    permissionHandler.reset();
                    sdkToLogConverter.resetParentChain();
                    logger.debug(`[remote]: New session detected (previous: ${previousSessionId}, current: ${session.sessionId})`);
                } else {
                    messageBuffer.addMessage('Continuing Claude session...', 'status');
                    logger.debug(`[remote]: Continuing existing session: ${session.sessionId}`);
                }

                previousSessionId = session.sessionId;
                const controller = new AbortController();
                this.abortController = controller;
                this.abortFuture = new Future<void>();
                let modeHash: string | null = null;
                let mode: EnhancedMode | null = null;
                try {
                    await claudeRemote({
                        sessionId: session.sessionId,
                        path: session.path,
                        allowedTools: session.allowedTools ?? [],
                        mcpServers: session.mcpServers,
                        hookSettingsPath: session.hookSettingsPath,
                        getSessionConfig: this.getSessionConfig,
                        flushConfig: this.flushConfig,
                        canCallTool: permissionHandler.handleToolCall,
                        onQueryReady: (query) => {
                            this.queryRef = query;
                            // 暴露给外部用于动态 setModel/setPermissionMode
                            if (this.queryControlRef) {
                                this.queryControlRef.current = query;
                            }
                            // 修复配置漂移：将预热期间积累的配置变更同步到 Query
                            this.flushConfig();
                            if (this.processCleanupRef) {
                                this.processCleanupRef.current = () => {
                                    query.close();
                                    this.queryRef = null;
                                    if (this.queryControlRef) {
                                        this.queryControlRef.current = null;
                                    }
                                };
                            }
                        },
                        nextMessage: async () => {
                            if (pending) {
                                const p = pending;
                                pending = null;
                                permissionHandler.handleModeChange(p.mode.permissionMode);
                                return p;
                            }

                            const msg = await session.queue.waitForMessagesAndGetAsString(controller.signal);

                            if (msg) {
                                // 重置空闲计时器（用户发送消息）
                                session.client.resetIdleTimer();

                                if ((modeHash && msg.hash !== modeHash) || msg.isolate) {
                                    logger.debug('[remote]: mode has changed, pending message');
                                    pending = msg;
                                    return null;
                                }
                                modeHash = msg.hash;
                                mode = msg.mode;
                                permissionHandler.handleModeChange(mode.permissionMode);
                                return {
                                    message: msg.message,
                                    mode: msg.mode
                                };
                            }

                            return null;
                        },
                        onSessionFound: (sessionId) => {
                            session.onSessionFound(sessionId);
                        },
                        onRunningChange: session.onRunningChange,
                        claudeEnvVars: session.claudeEnvVars,
                        claudeArgs: session.claudeArgs,
                        onMessage,
                        onCompletionEvent: (message: string) => {
                            logger.debug(`[remote]: Completion event: ${message}`);
                            session.client.sendSessionEvent({ type: 'message', message });
                        },
                        onContextCleared: () => {
                            logger.debug('[remote]: Context cleared');
                            session.client.sendSessionEvent({ type: 'context-cleared' });
                        },
                        onSessionReset: () => {
                            logger.debug('[remote]: Session reset');
                            session.clearSessionId();
                        },
                        onReady: () => {
                            if (!pending && session.queue.size() === 0) {
                                session.client.sendSessionEvent({ type: 'ready' });
                            }
                        },
                        onSnapshot: (msg) => {
                            session.client.sendContentSnapshot(msg);
                        },
                        getConverter: () => sdkToLogConverter,
                    });

                    session.consumeOneTimeFlags();

                    if (!this.exitReason && controller.signal.aborted) {
                        session.client.sendSessionEvent({ type: 'message', message: 'Aborted by user' });
                    }
                } catch (e) {
                    // 增强错误日志：序列化非标准错误对象
                    const errorDetail = e instanceof Error
                        ? `${e.name}: ${e.message}\n${e.stack?.substring(0, 500)}`
                        : `Non-Error thrown: type=${typeof e}, value=${JSON.stringify(e)}, keys=${typeof e === 'object' && e !== null ? Object.keys(e).join(',') : 'N/A'}`;
                    logger.debug(`[remote]: launch error: ${errorDetail}`);
                    if (!this.exitReason) {
                        session.client.sendSessionEvent({ type: 'message', message: `Process exited unexpectedly: ${e instanceof Error ? e.message : String(e)}` });
                        // claude 进程崩溃，退出 session 避免僵尸进程
                        this.exitReason = 'exit';
                    }
                } finally {
                    logger.debug('[remote]: launch finally');

                    for (const [toolCallId, { parentToolCallId }] of ongoingToolCalls) {
                        const converted = sdkToLogConverter.generateInterruptedToolResult(toolCallId, parentToolCallId);
                        if (converted) {
                            logger.debug('[remote]: terminating tool call ' + toolCallId + ' parent: ' + parentToolCallId);
                            session.client.sendClaudeSessionMessage(converted);
                        }
                    }
                    ongoingToolCalls.clear();

                    logger.debug('[remote]: flushing message queue');
                    await messageQueue.flush();
                    messageQueue.destroy();
                    logger.debug('[remote]: message queue flushed');

                    this.abortController = null;
                    this.abortFuture?.resolve(undefined);
                    this.abortFuture = null;
                    this.queryRef = null;
                    if (this.queryControlRef) {
                        this.queryControlRef.current = null;
                    }
                    logger.debug('[remote]: launch done');
                    permissionHandler.resetForNewTurn();
                    modeHash = null;
                    mode = null;
                }
            }
        } finally {
            if (this.permissionHandler) {
                this.permissionHandler.reset();
            }
        }
    }

    protected async cleanup(): Promise<void> {
        this.clearAbortHandlers(this.session.client.rpcHandlerManager);

        if (this.handleSessionFound) {
            this.session.removeSessionFoundCallback(this.handleSessionFound);
            this.handleSessionFound = null;
        }

        if (this.permissionHandler) {
            this.permissionHandler.reset();
        }

        if (this.abortFuture) {
            this.abortFuture.resolve(undefined);
        }

        if (this.processCleanupRef) {
            this.processCleanupRef.current = null;
        }
    }
}

export async function claudeRemoteLauncher(
    session: Session,
    processCleanupRef?: { current: (() => void) | null },
    queryControlRef?: QueryControlRef,
    getSessionConfig?: () => EnhancedMode,
    flushConfig?: () => void,
): Promise<'switch' | 'exit'> {
    const launcher = new ClaudeRemoteLauncher(
        session,
        processCleanupRef,
        queryControlRef,
        getSessionConfig ?? (() => ({ permissionMode: 'default' as const })),
        flushConfig ?? (() => {}),
    );
    return launcher.launch();
}
