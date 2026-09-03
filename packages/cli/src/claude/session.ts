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

import { ApiClient, ApiSessionClient } from '@/lib';
import { MessageQueue } from '@/utils/MessageQueue';
import { logger } from '@/ui/logger';
import { AgentSessionBase } from '@/agent/sessionBase';
import type { McpServerConfig } from '@anthropic-ai/claude-agent-sdk';
import type { SessionModel } from '@/api/types';
import type { EffortLevel } from '@mobi/shared';
import type { EnhancedMode, PermissionMode, PendingRewind } from './types';
import type { LocalLaunchExitReason } from '@/agent/localLaunchPolicy';

type LocalLaunchFailure = {
    message: string;
    exitReason: LocalLaunchExitReason;
};

export class Session extends AgentSessionBase<EnhancedMode> {
    readonly claudeEnvVars?: Record<string, string>;
    claudeArgs?: string[];
    readonly mcpServers: Record<string, McpServerConfig>;
    readonly allowedTools?: string[];
    readonly hookSettingsPath: string;
    readonly startedBy: 'runner' | 'terminal';
    readonly startingMode: 'local' | 'remote';
    /** 项目冻结的额外工作目录（创建时来自项目 folders，resume 时回放 metadata） */
    readonly additionalDirectories: string[];
    /**
     * rewind 待执行状态：rewind RPC handler 写（受理成功时）、claudeRemoteLauncher 的
     * while 循环读（下轮以 resumeSessionAt 截断重启）。挂在本对象上的理由见 PendingRewind 注释。
     */
    pendingRewind: PendingRewind | null = null;
    /**
     * rewind RPC 受理中占位（多端并发互斥）：rewind handler 入口在任何 await 前同步置位、
     * finally 释放。与 pendingRewind 语义分离——本字段挡住「文件回滚耗时窗口内并发第二个
     * rewind 覆盖 pendingRewind 单槽」的竞态。见 rewindHandlers.ts
     */
    rewindInFlight: boolean = false;
    localLaunchFailure: LocalLaunchFailure | null = null;

    constructor(opts: {
        api: ApiClient;
        client: ApiSessionClient;
        path: string;
        logPath: string;
        sessionId: string | null;
        claudeEnvVars?: Record<string, string>;
        claudeArgs?: string[];
        mcpServers: Record<string, McpServerConfig>;
        messageQueue: MessageQueue<EnhancedMode>;
        onModeChange: (mode: 'local' | 'remote') => void;
        allowedTools?: string[];
        mode?: 'local' | 'remote';
        startedBy: 'runner' | 'terminal';
        startingMode: 'local' | 'remote';
        hookSettingsPath: string;
        permissionMode?: PermissionMode;
        model?: SessionModel;
        effort?: EffortLevel;
        outputStyle?: string;
        additionalDirectories?: string[];
    }) {
        super({
            api: opts.api,
            client: opts.client,
            path: opts.path,
            logPath: opts.logPath,
            sessionId: opts.sessionId,
            messageQueue: opts.messageQueue,
            onModeChange: opts.onModeChange,
            mode: opts.mode,
            sessionLabel: 'Session',
            sessionIdLabel: 'Claude Code',
            applySessionIdToMetadata: (metadata, sessionId) => ({
                ...metadata,
                nativeSessionId: sessionId
            }),
            permissionMode: opts.permissionMode,
            model: opts.model,
            effort: opts.effort,
            outputStyle: opts.outputStyle,
        });

        this.claudeEnvVars = opts.claudeEnvVars;
        this.claudeArgs = opts.claudeArgs;
        this.mcpServers = opts.mcpServers;
        this.allowedTools = opts.allowedTools;
        this.hookSettingsPath = opts.hookSettingsPath;
        this.startedBy = opts.startedBy;
        this.startingMode = opts.startingMode;
        this.additionalDirectories = opts.additionalDirectories ?? [];
    }

    setPermissionMode = (mode: PermissionMode): void => {
        this.permissionMode = mode;
    };

    setModel = (model: SessionModel): void => {
        this.model = model;
    };

    setEffort = (effort: EffortLevel): void => {
        this.effort = effort;
    };

    setOutputStyle = (style: string): void => {
        this.outputStyle = style;
    };

    recordLocalLaunchFailure = (message: string, exitReason: LocalLaunchExitReason): void => {
        this.localLaunchFailure = { message, exitReason };
    };

    /**
     * Clear the current session ID (used by /clear command)
     */
    clearSessionId = (): void => {
        this.sessionId = null;
        logger.debug('[Session] Session ID cleared');
    };

    /**
     * Consume one-time Claude flags from claudeArgs after Claude spawn
     * Currently handles: --resume (with or without session ID)
     */
    consumeOneTimeFlags = (): void => {
        if (!this.claudeArgs) return;

        const filteredArgs: string[] = [];
        for (let i = 0; i < this.claudeArgs.length; i++) {
            if (this.claudeArgs[i] === '--resume' || this.claudeArgs[i] === '-r') {
                // Check if next arg looks like a UUID (contains dashes and alphanumeric)
                if (i + 1 < this.claudeArgs.length) {
                    const nextArg = this.claudeArgs[i + 1];
                    // Simple UUID pattern check - contains dashes and is not another flag
                    if (!nextArg.startsWith('-') && nextArg.includes('-')) {
                        // Skip both --resume and the UUID
                        i++; // Skip the UUID
                        logger.debug(`[Session] Consumed --resume flag with session ID: ${nextArg}`);
                    } else {
                        // Just --resume without UUID
                        logger.debug('[Session] Consumed --resume flag (no session ID)');
                    }
                } else {
                    // --resume at the end of args
                    logger.debug('[Session] Consumed --resume flag (no session ID)');
                }
            } else {
                filteredArgs.push(this.claudeArgs[i]);
            }
        }

        this.claudeArgs = filteredArgs.length > 0 ? filteredArgs : undefined;
        logger.debug(`[Session] Consumed one-time flags, remaining args:`, this.claudeArgs);
    };
}
