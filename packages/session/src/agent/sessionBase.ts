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

import { ApiClient } from '@mobi/node-core/api/api'
import type { ApiSessionClient } from '../api/apiSession'
import { MessageQueue } from '@mobi/node-core/utils/MessageQueue';
import type { Metadata, SessionModel, SessionPermissionMode } from '@mobi/node-core/api/types';
import type { EffortLevel } from '@mobi/shared';
import { logger } from '@mobi/node-core/logger';

export type AgentSessionBaseOptions<Mode> = {
    api: ApiClient;
    client: ApiSessionClient;
    path: string;
    logPath: string;
    sessionId: string | null;
    messageQueue: MessageQueue<Mode>;
    sessionLabel: string;
    sessionIdLabel: string;
    applySessionIdToMetadata: (metadata: Metadata, sessionId: string) => Metadata;
    permissionMode?: SessionPermissionMode;
    model?: SessionModel;
    effort?: EffortLevel;
    fastMode?: boolean;
    outputStyle?: string;
};

export class AgentSessionBase<Mode> {
    readonly path: string;
    readonly logPath: string;
    readonly api: ApiClient;
    readonly client: ApiSessionClient;
    readonly queue: MessageQueue<Mode>;

    sessionId: string | null;
    /** 会话驱动模式：local 已退场（tui-fork 票 05），只剩进程内驱动一条路径 */
    readonly mode = 'remote';
    running: boolean = false;

    private sessionFoundCallbacks: ((sessionId: string) => void)[] = [];
    private readonly applySessionIdToMetadata: (metadata: Metadata, sessionId: string) => Metadata;
    private readonly sessionLabel: string;
    private readonly sessionIdLabel: string;
    private keepAliveInterval: NodeJS.Timeout | null = null;
    protected permissionMode?: SessionPermissionMode;
    protected model?: SessionModel;
    protected effort?: EffortLevel;
    protected fastMode?: boolean;
    protected outputStyle?: string;

    constructor(opts: AgentSessionBaseOptions<Mode>) {
        this.path = opts.path;
        this.api = opts.api;
        this.client = opts.client;
        this.logPath = opts.logPath;
        this.sessionId = opts.sessionId;
        this.queue = opts.messageQueue;
        this.applySessionIdToMetadata = opts.applySessionIdToMetadata;
        this.sessionLabel = opts.sessionLabel;
        this.sessionIdLabel = opts.sessionIdLabel;
        this.permissionMode = opts.permissionMode;
        this.model = opts.model;
        this.effort = opts.effort;
        this.fastMode = opts.fastMode;
        this.outputStyle = opts.outputStyle;

        this.client.keepAlive(this.running, this.mode, this.getKeepAliveRuntime());
        this.client.startIdleTimer();
        this.keepAliveInterval = setInterval(() => {
            this.client.keepAlive(this.running, this.mode, this.getKeepAliveRuntime());
        }, 2000);

    }

    onRunningChange = (running: boolean) => {
        // 轮次起点上报（running 翻转 false→true）：StatusBar 计时的权威来源，
        // 经 daemon 落库 runtimeState.runStartedAt + SSE 推 web——不随消息窗口化丢失
        //（docs/pending.md #55）。非翻转（重复同值上报）不触发
        if (running && !this.running) {
            this.client.reportRunStarted(Date.now())
        }
        this.running = running;
        this.client.keepAlive(running, this.mode, this.getKeepAliveRuntime());
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

    /**
     * keep-alive 附带的 runtime 快照：permissionMode/model/effort/outputStyle 会经 daemon
     * 落 runtimeState 持久化——进程重启后 resume 链路回放这些字段（syncEngine resume 分支），
     * 缺报即回落默认值。outputStyle 与 effort 同款：切换受理（setOutputStyle）后即时生效于后续上报。
     * outputStyle undefined = 「跟随 CC settings」（NewSessionPage 默认不携带字段 spawn）：
     * 不上报该字段 → runtimeState 不落 → resume 不回放，用户 settings 的默认 style 保持权威。
     */
    protected getKeepAliveRuntime(): { permissionMode?: SessionPermissionMode; model?: SessionModel; effort?: EffortLevel; fastMode?: boolean; outputStyle?: string } | undefined {
        if (
            this.permissionMode === undefined
            && this.model === undefined
            && this.effort === undefined
            && this.fastMode === undefined
            && this.outputStyle === undefined
        ) {
            return undefined;
        }
        return {
            permissionMode: this.permissionMode,
            model: this.model,
            effort: this.effort,
            fastMode: this.fastMode,
            outputStyle: this.outputStyle,
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

    getFastMode(): boolean | undefined {
        return this.fastMode;
    }

    getOutputStyle(): string | undefined {
        return this.outputStyle;
    }
}
