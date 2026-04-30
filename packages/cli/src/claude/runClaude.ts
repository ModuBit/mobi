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

import { logger } from '@/ui/logger';
import { loop } from '@/claude/loop';
import { AgentState, SessionModel } from '@/api/types';
import { EnhancedMode, PermissionMode, type QueryControlRef } from './loop';
import { MessageQueue } from '@/utils/MessageQueue';
import { hashObject } from '@/utils/deterministicJson';
import { extractSDKMetadataAsync } from '@/claude/sdk/metadataExtractor';
import { parseSpecialCommand } from '@/parsers/specialCommands';
import { getEnvironmentInfo } from '@/ui/doctor';
import { startMobiMcpServer } from '@/claude/utils/startMobiMcpServer';
import { startHookServer } from '@/claude/utils/startHookServer';
import { generateHookSettingsFile, cleanupHookSettingsFile } from '@/modules/common/hooks/generateHookSettings';
import { registerKillSessionHandler } from './registerKillSessionHandler';
import type { Session } from './session';
import { bootstrapSession } from '@/agent/sessionFactory';
import { createModeChangeHandler, createRunnerLifecycle, setControlledByUser } from '@/agent/runnerLifecycle';
import { EFFORT_LEVELS, type EffortLevel, isPermissionModeAllowedForFlavor } from '@mobi/shared';
import { PermissionModeSchema } from '@mobi/shared/schemas';
import { formatMessageWithAttachments } from '@/utils/attachmentFormatter';
import { normalizeClaudeSessionModel } from './model';
import { getInvokedCwd } from '@/utils/invokedCwd';
import { initializeSandbox } from '@/modules/sandbox/sandboxManager';

export interface StartOptions {
    model?: string
    permissionMode?: PermissionMode
    effort?: EffortLevel
    startingMode?: 'local' | 'remote'
    shouldStartRunner?: boolean
    claudeEnvVars?: Record<string, string>
    claudeArgs?: string[]
    startedBy?: 'runner' | 'terminal'
}

export async function runClaude(options: StartOptions = {}): Promise<void> {
    const workingDirectory = getInvokedCwd();
    const startedBy = options.startedBy ?? 'terminal';

    // Log environment info at startup
    logger.debugLargeJson('[START] MOBI process started', getEnvironmentInfo());
    logger.debug(`[START] Options: startedBy=${startedBy}, startingMode=${options.startingMode}`);

    // Validate runner spawn requirements
    if (startedBy === 'runner' && options.startingMode === 'local') {
        logger.debug('Runner spawn requested with local mode - forcing remote mode');
        options.startingMode = 'remote';
        // TODO: Eventually we should error here instead of silently switching
        // throw new Error('Runner-spawned sessions cannot use local/interactive mode');
    }

    const initialState: AgentState = {};
    const initialModel = normalizeClaudeSessionModel(options.model);
    const startingMode = options.startingMode ?? (startedBy === 'runner' ? 'remote' : 'local');
    const { api, apiSession, sessionInfo } = await bootstrapSession({
        flavor: 'claude',
        startedBy,
        workingDirectory,
        agentState: initialState,
        model: initialModel ?? undefined,
        effort: options.effort,
        claudeArgs: options.claudeArgs,   // 用于 --resume 时复用 Hub session
        startingMode
    });
    logger.debug(`Session created: ${sessionInfo.id}`);

    // Extract SDK metadata in background and update session when ready
    extractSDKMetadataAsync(async (extractedMetadata) => {
        logger.debug('[start] SDK metadata extracted, updating session:', extractedMetadata);
        try {
            // 更新会话元数据，保存完整的 SDK 元数据
            apiSession.updateMetadata((currentMetadata) => ({
                ...currentMetadata,
                sdkMetadata: extractedMetadata
            }));
            logger.debug('[start] Session metadata updated with SDK capabilities');
        } catch (error) {
            logger.debug('[start] Failed to update session metadata:', error);
        }
    });

    // Start MOBI MCP server
    const mobiMcpServer = await startMobiMcpServer(apiSession);
    logger.debug(`[START] MOBI MCP server started at ${mobiMcpServer.url}`);

    // Variable to track current session instance (updated via onSessionReady callback)
    const currentSessionRef: { current: Session | null } = { current: null };

    // 用于在信号退出时清理子进程（防止 Claude Code / SDK Query 残留）
    const processCleanupRef = { current: null as (() => void) | null };

    const formatFailureReason = (message: string): string => {
        const maxLength = 200;
        if (message.length <= maxLength) {
            return message;
        }
        return `${message.slice(0, maxLength)}...`;
    };

    // Start Hook server for receiving Claude session notifications
    const hookServer = await startHookServer({
        onSessionHook: (sessionId, data) => {
            logger.debug(`[START] Session hook received: ${sessionId}`, data);

            const currentSession = currentSessionRef.current;
            if (currentSession) {
                const previousSessionId = currentSession.sessionId;
                if (previousSessionId !== sessionId) {
                    logger.debug(`[START] Claude session ID changed: ${previousSessionId} -> ${sessionId}`);
                    currentSession.onSessionFound(sessionId);
                }
            }
        }
    });
    logger.debug(`[START] Hook server started on port ${hookServer.port}`);

    const hookSettingsPath = generateHookSettingsFile(hookServer.port, hookServer.token, {
        filenamePrefix: 'session-hook',
        logLabel: 'generateHookSettings'
    });
    logger.debug(`[START] Generated hook settings file: ${hookSettingsPath}`);

    // Print log file path
    const logPath = logger.logFilePath;
    logger.infoDeveloper(`Session: ${sessionInfo.id}`);
    logger.infoDeveloper(`Logs: ${logPath}`);

    const lifecycle = createRunnerLifecycle({
        apiSession,
        logTag: 'claude',
        stopKeepAlive: () => currentSessionRef.current?.stopKeepAlive(),
        onBeforeClose: () => {
            // 清理子进程：关闭 SDK Query / 终止 Claude Code 进程树
            processCleanupRef.current?.();
            processCleanupRef.current = null;
        },
        onAfterClose: () => {
            mobiMcpServer.stop();
            hookServer.stop();
            cleanupHookSettingsFile(hookSettingsPath, 'generateHookSettings');
        }
    });

    lifecycle.registerProcessHandlers();
    registerKillSessionHandler(apiSession.rpcHandlerManager, lifecycle.cleanupAndExit);

    // 监听超时事件
    const handleTimeout = (reason: string) => {
        logger.debug(`[Session] ${reason}, archiving and exiting`);
        lifecycle.setArchiveReason(reason);
        void lifecycle.cleanupAndExit();
    };

    apiSession.on('disconnect-timeout', () => handleTimeout('Disconnect timeout'));
    apiSession.on('idle-timeout', () => handleTimeout('Idle timeout'));

    // Set initial agent state
    setControlledByUser(apiSession, startingMode);

    // Import MessageQueue and create message queue
    // model/permissionMode 不纳入 hash，通过 SDK Query 动态切换
    const messageQueue = new MessageQueue<EnhancedMode>(mode => hashObject({
        fallbackModel: mode.fallbackModel,
        customSystemPrompt: mode.customSystemPrompt,
        appendSystemPrompt: mode.appendSystemPrompt,
        allowedTools: mode.allowedTools,
        disallowedTools: mode.disallowedTools
    }));

    // Forward messages to the queue
    let currentEffort: EffortLevel = options.effort ?? 'medium';
    let currentPermissionMode: PermissionMode = options.permissionMode ?? 'default';
    let currentModel: SessionModel = initialModel;
    let currentFallbackModel: string | undefined = undefined; // Track current fallback model
    let currentCustomSystemPrompt: string | undefined = undefined; // Track current custom system prompt
    let currentAppendSystemPrompt: string | undefined = undefined; // Track current append system prompt
    let currentAllowedTools: string[] | undefined = undefined; // Track current allowed tools
    let currentDisallowedTools: string[] | undefined = undefined; // Track current disallowed tools

    // SDK Query 动态控制引用，用于 setModel/setPermissionMode
    const queryControlRef: QueryControlRef = { current: null };

    const syncSessionModes = () => {
        const sessionInstance = currentSessionRef.current;
        if (!sessionInstance) {
            return;
        }

        const prevMode = sessionInstance.getPermissionMode();
        const prevModel = sessionInstance.getModel();
        const prevEffort = sessionInstance.getEffort();
        const modeChanged = prevMode !== currentPermissionMode;
        const modelChanged = prevModel !== currentModel;
        const effortChanged = prevEffort !== currentEffort;

        if (!modeChanged && !modelChanged && !effortChanged) {
            return;
        }

        if (modeChanged) {
            sessionInstance.setPermissionMode(currentPermissionMode);
        }
        if (modelChanged) {
            sessionInstance.setModel(currentModel);
        }
        if (effortChanged) {
            sessionInstance.setEffort(currentEffort);
        }

        const control = queryControlRef.current;
        if (control) {
            const promises: Promise<void>[] = [];
            if (modeChanged) {
                promises.push(control.setPermissionMode(currentPermissionMode));
            }
            if (modelChanged) {
                promises.push(control.setModel(currentModel ?? undefined));
            }
            if (effortChanged) {
                // effort 通过 applyFlagSettings 动态修改
                // effort 依赖 adaptive thinking（SDK thinking 默认为 { type: 'adaptive' }）
                promises.push(control.applyFlagSettings({ effortLevel: currentEffort }));
            }
            Promise.all(promises).catch(err => logger.debug(`[loop] dynamic config apply failed: ${err}`));
        }

        logger.debug(`[loop] Synced session config: permissionMode=${currentPermissionMode}, model=${currentModel ?? 'auto'}, effort=${currentEffort}`);
    };
    apiSession.onUserMessage((message) => {
        const messagePermissionMode = currentPermissionMode;
        const messageModel = currentModel ?? undefined;
        logger.debug(`[loop] User message received with permission mode: ${currentPermissionMode}, model: ${currentModel ?? 'auto'}`);

        // Resolve custom system prompt - use message.meta.customSystemPrompt if provided, otherwise use current
        let messageCustomSystemPrompt = currentCustomSystemPrompt;
        if (message.meta && 'customSystemPrompt' in message.meta) {
            messageCustomSystemPrompt = message.meta.customSystemPrompt || undefined; // null becomes undefined
            currentCustomSystemPrompt = messageCustomSystemPrompt;
            logger.debug(`[loop] Custom system prompt updated from user message: ${messageCustomSystemPrompt ? 'set' : 'reset to none'}`);
        } else {
            logger.debug(`[loop] User message received with no custom system prompt override, using current: ${currentCustomSystemPrompt ? 'set' : 'none'}`);
        }

        // Resolve fallback model - use message.meta.fallbackModel if provided, otherwise use current fallback model
        let messageFallbackModel = currentFallbackModel;
        if (message.meta && 'fallbackModel' in message.meta) {
            messageFallbackModel = message.meta.fallbackModel || undefined; // null becomes undefined
            currentFallbackModel = messageFallbackModel;
            logger.debug(`[loop] Fallback model updated from user message: ${messageFallbackModel || 'reset to none'}`);
        } else {
            logger.debug(`[loop] User message received with no fallback model override, using current: ${currentFallbackModel || 'none'}`);
        }

        // Resolve append system prompt - use message.meta.appendSystemPrompt if provided, otherwise use current
        let messageAppendSystemPrompt = currentAppendSystemPrompt;
        if (message.meta && 'appendSystemPrompt' in message.meta) {
            messageAppendSystemPrompt = message.meta.appendSystemPrompt || undefined; // null becomes undefined
            currentAppendSystemPrompt = messageAppendSystemPrompt;
            logger.debug(`[loop] Append system prompt updated from user message: ${messageAppendSystemPrompt ? 'set' : 'reset to none'}`);
        } else {
            logger.debug(`[loop] User message received with no append system prompt override, using current: ${currentAppendSystemPrompt ? 'set' : 'none'}`);
        }

        // Resolve allowed tools - use message.meta.allowedTools if provided, otherwise use current
        let messageAllowedTools = currentAllowedTools;
        if (message.meta && 'allowedTools' in message.meta) {
            messageAllowedTools = message.meta.allowedTools || undefined; // null becomes undefined
            currentAllowedTools = messageAllowedTools;
            logger.debug(`[loop] Allowed tools updated from user message: ${messageAllowedTools ? messageAllowedTools.join(', ') : 'reset to none'}`);
        } else {
            logger.debug(`[loop] User message received with no allowed tools override, using current: ${currentAllowedTools ? currentAllowedTools.join(', ') : 'none'}`);
        }

        // Resolve disallowed tools - use message.meta.disallowedTools if provided, otherwise use current
        let messageDisallowedTools = currentDisallowedTools;
        if (message.meta && 'disallowedTools' in message.meta) {
            messageDisallowedTools = message.meta.disallowedTools || undefined; // null becomes undefined
            currentDisallowedTools = messageDisallowedTools;
            logger.debug(`[loop] Disallowed tools updated from user message: ${messageDisallowedTools ? messageDisallowedTools.join(', ') : 'reset to none'}`);
        } else {
            logger.debug(`[loop] User message received with no disallowed tools override, using current: ${currentDisallowedTools ? currentDisallowedTools.join(', ') : 'none'}`);
        }

        // Check for special commands before processing
        const specialCommand = parseSpecialCommand(message.content.text);

        // Format message text with attachments for Claude
        const formattedText = formatMessageWithAttachments(message.content.text, message.content.attachments);

        const enhancedMode: EnhancedMode = {
            permissionMode: messagePermissionMode ?? 'default',
            model: messageModel,
            fallbackModel: messageFallbackModel,
            customSystemPrompt: messageCustomSystemPrompt,
            appendSystemPrompt: messageAppendSystemPrompt,
            allowedTools: messageAllowedTools,
            disallowedTools: messageDisallowedTools
        };

        if (specialCommand.type === 'compact') {
            logger.debug('[start] Detected /compact command');
            const commandText = specialCommand.originalMessage || message.content.text;
            messageQueue.pushAndClear(commandText, enhancedMode);
            logger.debugLargeJson('[start] /compact command pushed to queue:', message);
            return;
        }

        if (specialCommand.type === 'clear') {
            logger.debug('[start] Detected /clear command');
            const commandText = specialCommand.originalMessage || message.content.text;
            messageQueue.pushIsolateAndClear(commandText, enhancedMode);
            logger.debugLargeJson('[start] /clear command pushed to queue:', message);
            return;
        }

        // Push with resolved permission mode, model, system prompts, and tools
        messageQueue.push(formattedText, enhancedMode);
        logger.debugLargeJson('User message pushed to queue:', message)
    });

    const resolvePermissionMode = (value: unknown): PermissionMode => {
        const parsed = PermissionModeSchema.safeParse(value);
        if (!parsed.success || !isPermissionModeAllowedForFlavor(parsed.data, 'claude')) {
            throw new Error('Invalid permission mode');
        }
        return parsed.data as PermissionMode;
    };

    const resolveModel = (value: unknown): SessionModel => {
        if (value === null) {
            return null;
        }

        if (typeof value !== 'string') {
            throw new Error('Invalid model');
        }

        return normalizeClaudeSessionModel(value);
    };

    apiSession.rpcHandlerManager.registerHandler('set-session-config', async (payload: unknown) => {
        if (!payload || typeof payload !== 'object') {
            throw new Error('Invalid session config payload');
        }
        const config = payload as { permissionMode?: unknown; model?: unknown; effort?: unknown };

        if (config.permissionMode !== undefined) {
            currentPermissionMode = resolvePermissionMode(config.permissionMode);
        }

        if (config.model !== undefined) {
            currentModel = resolveModel(config.model);
        }

        if (config.effort !== undefined) {
            if (typeof config.effort !== 'string' || !EFFORT_LEVELS.includes(config.effort as EffortLevel)) {
                throw new Error('Invalid effort level');
            }
            currentEffort = config.effort as EffortLevel;
        }

        syncSessionModes();
        return { applied: { permissionMode: currentPermissionMode, model: currentModel, effort: currentEffort } };
    });

    let loopError: unknown = null;
    let loopFailed = false;
    try {
        // 初始化沙箱（如果可用），为 !bash 命令提供隔离
        await initializeSandbox(workingDirectory)

        await loop({
            path: workingDirectory,
            model: currentModel,
            permissionMode: options.permissionMode,
            startingMode,
            messageQueue,
            api,
            allowedTools: mobiMcpServer.toolNames.map(toolName => `mcp__mobi__${toolName}`),
            onModeChange: createModeChangeHandler(apiSession),
            onSessionReady: (sessionInstance) => {
                currentSessionRef.current = sessionInstance;
                syncSessionModes();
            },
            mcpServers: {
                'mobi': {
                    type: 'http' as const,
                    url: mobiMcpServer.url,
                }
            },
            apiSession,
            claudeEnvVars: options.claudeEnvVars,
            claudeArgs: options.claudeArgs,
            startedBy,
            hookSettingsPath,
            processCleanupRef,
            queryControlRef,
            getSessionConfig: () => ({
                permissionMode: currentPermissionMode,
                model: currentModel ?? undefined,
                effort: currentEffort,
                fallbackModel: currentFallbackModel,
                customSystemPrompt: currentCustomSystemPrompt,
                appendSystemPrompt: currentAppendSystemPrompt,
                allowedTools: currentAllowedTools,
                disallowedTools: currentDisallowedTools,
            }),
            flushConfig: syncSessionModes,
        });
    } catch (error) {
        loopError = error;
        loopFailed = true;
        lifecycle.markCrash(error);
    }

    const localFailure = currentSessionRef.current?.localLaunchFailure;
    if (localFailure?.exitReason === 'exit') {
        lifecycle.setExitCode(1);
        lifecycle.setArchiveReason(`Local launch failed: ${formatFailureReason(localFailure.message)}`);
    }

    if (loopFailed) {
        await lifecycle.cleanup();
        throw loopError;
    }

    await lifecycle.cleanupAndExit();
}
