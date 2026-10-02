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

import { render } from 'ink';
import type { ReactElement } from 'react';
import type { StopKind } from '@mobi/shared';
import { normalizeStopKind } from '@/claude/utils/stopAction';
import { MessageBuffer } from '@/ui/ink/messageBuffer';
import { restoreTerminalState } from '@/ui/terminalState';

export type RemoteLauncherExitReason = 'switch' | 'exit';

export type RemoteLauncherDisplayContext = {
    messageBuffer: MessageBuffer;
    logPath?: string;
    onExit: () => void | Promise<void>;
    onSwitchToLocal: () => void | Promise<void>;
};

export type RemoteLauncherTerminalHandlers = {
    onExit: () => void | Promise<void>;
    onSwitchToLocal: () => void | Promise<void>;
};

export type RemoteLauncherAbortHandlers = {
    /** 停止请求（批次 A 三档：turn 只中断当前 turn / turn-queue 加清两层队列 / turn-queue-tasks 再停后台任务） */
    onAbort: (stopKind: StopKind) => void | Promise<void>;
    onSwitch: () => void | Promise<void>;
};

type RpcHandlerManagerLike = {
    registerHandler<TRequest = unknown, TResponse = unknown>(
        method: string,
        handler: (params: TRequest) => Promise<TResponse> | TResponse
    ): void;
};

export abstract class RemoteLauncherBase {
    protected readonly messageBuffer: MessageBuffer;
    protected readonly hasTTY: boolean;
    protected readonly logPath?: string;
    protected exitReason: RemoteLauncherExitReason | null = null;
    protected shouldExit: boolean = false;
    private inkInstance: ReturnType<typeof render> | null = null;

    protected constructor(logPath?: string) {
        this.logPath = logPath;
        this.hasTTY = Boolean(process.stdout.isTTY && process.stdin.isTTY);
        this.messageBuffer = new MessageBuffer();
    }

    protected abstract createDisplay(context: RemoteLauncherDisplayContext): ReactElement;

    protected abstract runMainLoop(): Promise<void>;

    protected abstract cleanup(): Promise<void>;

    protected setupTerminal(handlers: RemoteLauncherTerminalHandlers): void {
        if (this.hasTTY) {
            console.clear();
            this.inkInstance = render(this.createDisplay({
                messageBuffer: this.messageBuffer,
                logPath: this.logPath,
                onExit: handlers.onExit,
                onSwitchToLocal: handlers.onSwitchToLocal
            }), {
                exitOnCtrlC: false,
                patchConsole: false
            });
        }

        if (this.hasTTY) {
            process.stdin.resume();
            if (process.stdin.isTTY) {
                process.stdin.setRawMode(true);
            }
            process.stdin.setEncoding('utf8');
        }
    }

    protected setupAbortHandlers(
        rpcHandlerManager: RpcHandlerManagerLike,
        handlers: RemoteLauncherAbortHandlers
    ): void {
        rpcHandlerManager.registerHandler('abort', async (params: { stopKind?: StopKind }) => {
            // stopKind 入口校验：缺省（旧 hub / 本地触发）或未知值（未来第 4 档 / 手误字符串）
            // 一律回落 'turn'——isCancelQueued 负向默认下，未知值透传会静默升级为破坏性清队列
            await handlers.onAbort(normalizeStopKind(params?.stopKind));
        });

        rpcHandlerManager.registerHandler('switch', async () => {
            await handlers.onSwitch();
        });
    }

    protected clearAbortHandlers(rpcHandlerManager: RpcHandlerManagerLike): void {
        rpcHandlerManager.registerHandler('abort', async () => {});
        rpcHandlerManager.registerHandler('switch', async () => {});
    }

    protected async requestExit(
        reason: RemoteLauncherExitReason,
        handler: () => void | Promise<void>
    ): Promise<void> {
        if (!this.exitReason) {
            this.exitReason = reason;
        }
        this.shouldExit = true;
        await handler();
    }

    protected finalizeTerminal(): void {
        restoreTerminalState();
        if (this.hasTTY) {
            try {
                process.stdin.pause();
            } catch {
                // 错误可忽略：stdin 已关闭或不可暂停
            }
        }
        if (this.inkInstance) {
            this.inkInstance.unmount();
        }
        this.messageBuffer.clear();
    }

    protected async start(handlers: RemoteLauncherTerminalHandlers): Promise<RemoteLauncherExitReason> {
        this.setupTerminal(handlers);
        try {
            await this.runMainLoop();
        } finally {
            await this.cleanup();
            this.finalizeTerminal();
        }

        return this.exitReason || 'exit';
    }
}
