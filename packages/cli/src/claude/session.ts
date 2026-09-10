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
import type { McpServerConfig, Settings } from '@anthropic-ai/claude-agent-sdk';
import type { SessionModel } from '@/api/types';
import type { EffortLevel } from '@mobi/shared';
import type { EnhancedMode, PermissionMode } from './types';
import { QueryRestartController } from './utils/queryRestart';
import type { ForkActivationPlan } from './utils/forkActivation';
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
    readonly hookSettings: string | Settings;
    readonly startedBy: 'runner' | 'terminal';
    readonly startingMode: 'local' | 'remote';
    /** 项目冻结的额外工作目录（创建时来自项目 folders，resume 时回放 metadata） */
    readonly additionalDirectories: string[];
    /** Query 重启状态机：隐藏 pending、异步占位、队列清理和退出哨兵配对。 */
    readonly restart: QueryRestartController;
    localLaunchFailure: LocalLaunchFailure | null = null;
    /**
     * fork 激活计划（fork-session spec §5.2）：bootstrap 从 fork 行 metadata.forkFrom
     * 解析；首条消息触发激活，init 返回预生成 id 时由 launcher 置 null 并上报 hub
     * 清除 forkFrom。null = 非 fork 激活轮（普通 / 已激活）。
     */
    forkActivation: ForkActivationPlan | null;

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
        hookSettings: string | Settings;
        permissionMode?: PermissionMode;
        model?: SessionModel;
        effort?: EffortLevel;
        outputStyle?: string;
        additionalDirectories?: string[];
        /** fork 激活计划（runClaude 从 bootstrap metadata 解析后传入；缺省 null） */
        forkActivation?: ForkActivationPlan | null;
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

        this.restart = new QueryRestartController(opts.messageQueue);

        this.claudeEnvVars = opts.claudeEnvVars;
        this.claudeArgs = opts.claudeArgs;
        this.mcpServers = opts.mcpServers;
        this.allowedTools = opts.allowedTools;
        this.hookSettings = opts.hookSettings;
        this.startedBy = opts.startedBy;
        this.startingMode = opts.startingMode;
        this.additionalDirectories = opts.additionalDirectories ?? [];
        this.forkActivation = opts.forkActivation ?? null;
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
