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
import type { Metadata, SessionModel, SessionPermissionMode } from '@/api/types';
import type { EffortLevel } from '@mobi/shared';
import { logger } from '@/ui/logger';
import { readGitBranch } from '@/utils/worktreeEnv';

export type AgentSessionBaseOptions<Mode> = {
    api: ApiClient;
    client: ApiSessionClient;
    path: string;
    logPath: string;
    sessionId: string | null;
    messageQueue: MessageQueue<Mode>;
    onModeChange: (mode: 'local' | 'remote') => void;
    mode?: 'local' | 'remote';
    sessionLabel: string;
    sessionIdLabel: string;
    applySessionIdToMetadata: (metadata: Metadata, sessionId: string) => Metadata;
    permissionMode?: SessionPermissionMode;
    model?: SessionModel;
    effort?: EffortLevel;
};

export class AgentSessionBase<Mode> {
    readonly path: string;
    readonly logPath: string;
    readonly api: ApiClient;
    readonly client: ApiSessionClient;
    readonly queue: MessageQueue<Mode>;
    protected readonly _onModeChange: (mode: 'local' | 'remote') => void;

    sessionId: string | null;
    mode: 'local' | 'remote' = 'local';
    running: boolean = false;

    private sessionFoundCallbacks: ((sessionId: string) => void)[] = [];
    private readonly applySessionIdToMetadata: (metadata: Metadata, sessionId: string) => Metadata;
    private readonly sessionLabel: string;
    private readonly sessionIdLabel: string;
    private keepAliveInterval: NodeJS.Timeout | null = null;
    protected permissionMode?: SessionPermissionMode;
    protected model?: SessionModel;
    protected effort?: EffortLevel;

    constructor(opts: AgentSessionBaseOptions<Mode>) {
        this.path = opts.path;
        this.api = opts.api;
        this.client = opts.client;
        this.logPath = opts.logPath;
        this.sessionId = opts.sessionId;
        this.queue = opts.messageQueue;
        this._onModeChange = opts.onModeChange;
        this.applySessionIdToMetadata = opts.applySessionIdToMetadata;
        this.sessionLabel = opts.sessionLabel;
        this.sessionIdLabel = opts.sessionIdLabel;
        this.mode = opts.mode ?? 'local';
        this.permissionMode = opts.permissionMode;
        this.model = opts.model;
        this.effort = opts.effort;

        this.client.keepAlive(this.running, this.mode, this.getKeepAliveRuntime());
        this.keepAliveInterval = setInterval(() => {
            this.client.keepAlive(this.running, this.mode, this.getKeepAliveRuntime());
        }, 2000);

    }

    onRunningChange = (running: boolean) => {
        this.running = running;
        this.client.keepAlive(running, this.mode, this.getKeepAliveRuntime());
    };

    onModeChange = (mode: 'local' | 'remote') => {
        this.mode = mode;
        this.client.keepAlive(this.running, mode, this.getKeepAliveRuntime());
        const permissionLabel = this.permissionMode ?? 'unset';
        const modelLabel = this.model === undefined ? 'unset' : (this.model ?? 'auto');
        logger.debug(`[${this.sessionLabel}] Mode switched to ${mode} (permissionMode=${permissionLabel}, model=${modelLabel})`);

        // 模式切换时控制 IdleTimer
        if (mode === 'remote') {
            this.client.startIdleTimer();
            // 切换到 remote 时刷新 git 分支信息
            const gitBranch = readGitBranch(this.path);
            this.client.updateMetadata((metadata) => ({
                ...metadata,
                gitBranch: gitBranch ?? undefined,
            }));
        } else {
            this.client.stopIdleTimer();
        }

        this._onModeChange(mode);
    };

    onSessionFound = (sessionId: string) => {
        this.sessionId = sessionId;
        this.client.updateMetadata((metadata) => this.applySessionIdToMetadata(metadata, sessionId));
        logger.debug(`[${this.sessionLabel}] ${this.sessionIdLabel} session ID ${sessionId} added to metadata`);

        for (const callback of this.sessionFoundCallbacks) {
            callback(sessionId);
        }
    };

    addSessionFoundCallback = (callback: (sessionId: string) => void): void => {
        this.sessionFoundCallbacks.push(callback);
    };

    removeSessionFoundCallback = (callback: (sessionId: string) => void): void => {
        const index = this.sessionFoundCallbacks.indexOf(callback);
        if (index !== -1) {
            this.sessionFoundCallbacks.splice(index, 1);
        }
    };

    stopKeepAlive = (): void => {
        if (this.keepAliveInterval) {
            clearInterval(this.keepAliveInterval);
            this.keepAliveInterval = null;
        }
    };

    protected getKeepAliveRuntime(): { permissionMode?: SessionPermissionMode; model?: SessionModel; effort?: EffortLevel } | undefined {
        if (this.permissionMode === undefined && this.model === undefined && this.effort === undefined) {
            return undefined;
        }
        return {
            permissionMode: this.permissionMode,
            model: this.model,
            effort: this.effort,
        };
    }

    getPermissionMode(): SessionPermissionMode | undefined {
        return this.permissionMode;
    }

    getModel(): SessionModel | undefined {
        return this.model;
    }

    getEffort(): EffortLevel | undefined {
        return this.effort;
    }
}
