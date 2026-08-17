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
import { join } from "node:path";
import { Session } from "./session";
import { RemoteModeDisplay } from "@/ui/ink/RemoteModeDisplay";
import { claudeRemote } from "./claudeRemote";
import { parseSpecialCommand } from "@/parsers/specialCommands";
import { PermissionHandler } from "./utils/permissionHandler";
import { Future } from "@/utils/future";
import type { SDKAssistantMessage, SDKMessage, SDKResultMessage, SDKUserMessage, Query } from "@anthropic-ai/claude-agent-sdk";
import type { ContentBlockParam } from "@anthropic-ai/sdk/resources/messages";
import { formatClaudeMessageForInk } from "@/ui/messageFormatterInk";
import { logger } from "@/ui/logger";
import { SDKToLogConverter } from "./utils/sdkToLogConverter";
import { calcContextUsageFromResult, calcContextUsageFromCompact } from "./utils/contextUsageCalc";
import { EnhancedMode, type QueryControlRef } from "./types";
import { OutgoingMessageQueue } from "./utils/OutgoingMessageQueue";
import type { RawJSONLines } from "./types";
import { createSessionScanner, readSessionLog } from "./utils/sessionScanner";
import { GoalStatusHandler } from "./goalStatusHandler";
import { getProjectPath } from "./utils/path";
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
    // steer sink：由 claudeRemote 启动循环时注入，把 steer 文本 push 进 SDK input stream
    private steerSink: ((text: string) => boolean) | null = null;
    // 上次真实 turn 的窗口大小与累计成本，供 compact_boundary 上报时复用
    // （compact_boundary 消息不带 contextWindow 与 costUsd，只能复用上次记忆）
    private lastMaxTokens = 0;
    private lastCostUsd = 0;

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

    /**
     * 上下文用量上报（真实 turn 的 result）：组装逻辑见 calcContextUsageFromResult（纯函数）。
     * 本地命令（/usage 等，usage=0）/ 窗口未知 → 组装返回 null，跳过保持上一轮读数。
     * compact / 中断已在 claudeRemote 层过滤（不到此）。记忆 maxTokens/costUsd 供 compact 复用。
     */
    private handleContextUsage(resultMsg: SDKResultMessage, isCompact: boolean): void {
        // compact 的 result：用量已由 compact_boundary 的 post_tokens 上报，此处只回填累计成本
        // （compact 自身的 total_cost_usd），避免连续 /compact 期间 lastCostUsd 冻结
        if (isCompact) {
            this.lastCostUsd = resultMsg.total_cost_usd ?? this.lastCostUsd
            return
        }
        const r = calcContextUsageFromResult(resultMsg)
        if (!r) return
        this.lastMaxTokens = r.maxTokens
        this.lastCostUsd = r.costUsd
        try {
            this.session.client.reportContextUsage(r.usage)
        } catch (e) {
            logger.debug('[remote]: reportContextUsage failed', e)
        }
    }

    /**
     * 上下文用量上报（compact_boundary）：用 post_tokens 反映压缩后真实占用，复用上次记忆的
     * 窗口大小与成本。组装逻辑见 calcContextUsageFromCompact（纯函数）。
     */
    private handleCompactBoundary(postTokens: number | undefined): void {
        const usage = calcContextUsageFromCompact(postTokens, this.lastMaxTokens, this.lastCostUsd)
        if (!usage) return
        try {
            this.session.client.reportContextUsage(usage)
        } catch (e) {
            logger.debug('[remote]: reportContextUsage (compact) failed', e)
        }
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

        // goal 状态处理器：scanner 提取 goal_status attachment 后双发(RPC + goal_progress 消息)
        const goalHandler = new GoalStatusHandler(
            session.client,
            (m) => session.client.sendClaudeSessionMessage(m),
        );
        // scanner 只启动一次(首次 onSessionFound)；后续 session 切换走 onNewSession
        let scanner: Awaited<ReturnType<typeof createSessionScanner>> | null = null;
        // pending promise 跟踪：防止 start() 完成前的重复启动竞争 + cleanup 时序问题
        let scannerPromise: Promise<Awaited<ReturnType<typeof createSessionScanner>>> | null = null;

        // 启动恢复：读 transcript 最后一条 goal_status，仅恢复未达成的 active goal
        const restoreGoalStatus = async (sessionId: string) => {
            try {
                const file = join(getProjectPath(session.path), `${sessionId}.jsonl`);
                const { goalStatuses } = await readSessionLog(file, 0);
                const last = goalStatuses[goalStatuses.length - 1];
                if (last && !last.met) {
                    // 仅恢复未达成的 active goal；met:true 不恢复(已达成,等下次 active)
                    // 用 restore(只 RPC)而非 handle(双发)——恢复时不发 goal_progress 聊天消息，
                    // 避免每次重连/会话切换都往历史注入一条合成消息
                    goalHandler.restore(last);
                }
            } catch (e) {
                logger.debug('[remote]: restoreGoalStatus failed', e);
            }
        };

        // 注册 stop-task RPC 处理器，用于远程停止后台任务
        session.client.rpcHandlerManager.registerHandler('stop-task', async (params) => {
            const { taskId } = params as { taskId: string }
            if (this.queryRef) {
                await this.queryRef.stopTask(taskId)
            }
        });

        // 取消排队消息（web → hub → cli 两阶段取消的 CLI 侧）
        // CLI 是「是否仍可安全取消」的权威：in-flight（已 collectBatch/steal，即将喂 agent）→ 不可取消，
        // 否则会产生幽灵消息。tryCancel 区分 in-flight / 仍在队列 / CLI 未知三种。
        session.client.rpcHandlerManager.registerHandler('cancel-queued-message', async (params) => {
            const { localId } = (params ?? {}) as { localId?: string }
            if (!localId) return { status: 'submitted' }
            return { status: session.queue.tryCancel(localId) }
        });

        // steer 排队消息（web → hub → cli）：把仍排队的消息从内存队列取出，
        // 立即 push 进 SDK input stream，由 Claude Code 在内部安全点处理。
        // 设计权衡：steer 绕过 MessageQueue 的 modeHash 一致性检查与 collectBatch 的 pending 重启机制，
        // 消息以「当前运行 Query 的配置」被处理，而非入队时的配置。若用户排队后改了 model/permissionMode，
        // steer 消息不会触发 Query 重启——这是为「即时性」刻意取舍（mode 重启走正常 collectBatch 路径）。
        session.client.rpcHandlerManager.registerHandler('steer-queued-message', async (params) => {
            const { localId } = (params ?? {}) as { localId?: string }
            if (!localId) return { status: 'submitted' }

            // 特殊命令（!bash / /clear / /compact）不 steal：steer 会把文本直接 push 进 SDK
            // input stream 绕过 claudeRemote 正常泵的 handleSpecialCommand（!bash 会被 SDK 当
            // 普通消息用自己的 Bash 工具执行，/clear /compact 也失效）。用 peek（不移除）探测，
            // 命中则留队列走正常泵（executeBash/onClear/isCompact）——保留消息原始 isolate 标志
            // 与位置，避免 steal 后 pushBack 丢 isolate（/clear 由 pushIsolateAndClear 入队）
            // 并被 collectBatch 重排序合并进相邻同 mode 消息。
            const peeked = session.queue.peekByLocalId(localId)
            if (peeked && parseSpecialCommand(peeked.message).type) {
                return { status: 'submitted' }
            }

            const stolen = session.queue.stealByLocalId(localId)
            if (!stolen) return { status: 'submitted' }

            // push 失败的统一回填：消息已从队列移除，若 SDK input stream 未就绪或已关闭，
            // 必须放回队列，否则消息丢失（DB 行仍 submitted_at=null 但 agent 永远收不到）
            const pushBack = () => session.queue.push(stolen.message, stolen.mode, localId)

            if (!this.steerSink) {
                // query 未就绪：放回队列，保持排队态
                pushBack()
                return { status: 'submitted' }
            }
            let ok: boolean
            try {
                ok = this.steerSink(stolen.message)
            } catch (e) {
                // SDK input stream 已 end（mode 切换重启/turn 间隙旧循环已结束）→ push 抛错，回填保命
                logger.debug('[remote]: steer push failed, restoring queue', e)
                ok = false
            }
            if (!ok) {
                pushBack()
                return { status: 'submitted' }
            }
            // push 成功 → 立即通知 Hub 已提交（与 collectBatch 同路径）
            session.client.emitMessagesSubmitted([localId])
            return { status: 'steered' }
        });

        const permissionHandler = new PermissionHandler(session, {
            // mode 变更时通知运行中 SDK Query 动态切换 permissionMode（见 permissionHandler 说明）
            onApplyPermissionMode: (mode) => this.queryControlRef?.current?.setPermissionMode(mode),
        });
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

        // 跟踪 enter_plan_mode 工具调用，成功后同步 permissionMode 为 plan
        // （exit_plan_mode 批准已改为 allow + query.setPermissionMode 直切，
        //  无需再拦截伪造 tool_result，见 permissionHandler exit_plan_mode 分支）
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
        }

        try {
            // 暂存待下轮重启会话再投递的完整批次（mode 变更/isolate 时存入，恢复时原样返回）
            let pending: Awaited<ReturnType<typeof session.queue.waitForMessagesAndGetAsString>> = null;

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
                                return {
                                    message: msg.message,
                                    mode: msg.mode,
                                    localIds: msg.localIds,
                                };
                            }

                            return null;
                        },
                        onSessionFound: (sessionId) => {
                            session.onSessionFound(sessionId);
                            if (!scannerPromise) {
                                // 首次：启动 scanner(只传 onAttachmentStatus,不传 onMessage——
                                // remote 模式 SDK 消息流已送聊天消息,scanner 送消息会重复)
                                scannerPromise = createSessionScanner({
                                    sessionId,
                                    workingDirectory: session.path,
                                    onAttachmentStatus: (status) => goalHandler.handle(status),
                                });
                                scannerPromise
                                    .then((s) => { scanner = s; restoreGoalStatus(sessionId); })
                                    .catch((e) => { scannerPromise = null; logger.debug('[remote]: scanner start failed', e); });
                            } else if (scanner) {
                                // 后续 session 切换(fork/compact)：切监听文件 + 恢复 goal 状态
                                scanner.onNewSession(sessionId);
                                restoreGoalStatus(sessionId);
                            }
                        },
                        onRunningChange: session.onRunningChange,
                        claudeEnvVars: session.claudeEnvVars,
                        claudeArgs: session.claudeArgs,
                        additionalDirectories: session.additionalDirectories,
                        onMessage,
                        onCompletionEvent: (message: string) => {
                            logger.debug(`[remote]: Completion event: ${message}`);
                            session.client.sendSessionEvent({ type: 'message', message });
                        },
                        onCompactCompleted: () => {
                            logger.debug('[remote]: Compaction completed');
                            session.client.sendSessionEvent({ type: 'compact-completed' });
                        },
                        onContextCleared: () => {
                            logger.debug('[remote]: Context cleared');
                            session.client.sendSessionEvent({ type: 'context-cleared' });
                            // 清空用量：/clear 后新会话从 0 开始，避免用量线残留上个会话的旧值
                            session.client.clearContextUsage();
                            // 重置成本/窗口记忆，避免下个 compact_boundary 复用上个会话的累计成本
                            this.lastMaxTokens = 0;
                            this.lastCostUsd = 0;
                        },
                        onContextUsage: (resultMsg, isCompact) => {
                            this.handleContextUsage(resultMsg, isCompact);
                        },
                        onCompactBoundary: (postTokens) => {
                            this.handleCompactBoundary(postTokens);
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
                        // 流式期间 abort/中断时，把已累积但 full 未到的内容补全落库。
                        // 经 messageQueue 入队（非直接 send）：让 messageQueue 统一仲裁顺序——abort 时
                        // messageQueue 可能含 delay 中的上一条 assistant（tool_use 未配对 result），补全按 FIFO
                        // 入队其后，由本 launch finally 的 messageQueue.flush() 统一发送，保证
                        // 「上一条 tool_use → 当前补全」的正确时序。前端 resolveMessageCache 按 message.id
                        // 清理 snapshot + 追加补全 full，刷新后内容仍在。
                        onAbortFlush: (pending) => {
                            try {
                                const raw = sdkToLogConverter.convertSnapshot(pending.blocks, {
                                    model: pending.model,
                                    parentToolUseId: pending.parentToolUseId,
                                    messageId: pending.messageId,
                                });
                                messageQueue.enqueue(raw);
                            } catch (e) {
                                logger.warn('[remote]: onAbortFlush failed', e);
                            }
                        },
                        onSteerSinkReady: (push) => { this.steerSink = push },
                    });

                    session.consumeOneTimeFlags();

                    if (!this.exitReason && controller.signal.aborted) {
                        session.client.sendSessionEvent({ type: 'message', message: 'Aborted by user' });
                    }
                } catch (e) {
                    // 增强错误日志：序列化非标准错误对象
                    // 用 error 级而非 debug：SDK 崩溃错误（含 stderr tail，见 getProcessExitError）
                    // 需始终落盘以便事后从日志排查。debug 在生产模式只进 ringBuffer、不落盘，
                    // 而此处错误被优雅捕获（不崩溃）→ ringBuffer 永不 dump → 日志文件空白。
                    const errorDetail = e instanceof Error
                        ? `${e.name}: ${e.message}\n${e.stack?.substring(0, 500)}`
                        : `Non-Error thrown: type=${typeof e}, value=${JSON.stringify(e)}, keys=${typeof e === 'object' && e !== null ? Object.keys(e).join(',') : 'N/A'}`;
                    logger.error(`[remote]: launch error: ${errorDetail}`);
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
                    // 清空 steer sink：旧 SDK input stream 已 end，避免下一轮 claudeRemote 注入新 sink 前
                    // 命中 stale sink 导致 steer push 抛错（虽已 try/catch 回填，但清空让未就绪态更明确）
                    this.steerSink = null;
                    if (this.queryControlRef) {
                        this.queryControlRef.current = null;
                    }
                    logger.debug('[remote]: launch done');
                    permissionHandler.resetForNewTurn();
                    modeHash = null;
                }
            }
        } finally {
            // scanner 与 goalHandler 跟 launcher 生命周期一致(跨 turn 复用,仅销毁时清理)
            goalHandler.dispose();
            // 等待 pending scanner 创建完成再 cleanup,防止 launcher 在 start() 完成前退出致孤儿 watcher
            // scannerPromise 仅在回调闭包内赋值，TS CFA 不跟踪闭包赋值会窄化为 null，需 as 恢复联合类型
            const pendingScanner = scannerPromise as Promise<Awaited<ReturnType<typeof createSessionScanner>>> | null;
            if (pendingScanner) {
                try {
                    const s = await pendingScanner.catch(() => null);
                    await s?.cleanup();
                } catch (e) {
                    logger.debug('[remote]: scanner cleanup failed', e);
                }
            }
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
