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

import type { StopKind } from '@mobi/shared';
import { normalizeStopKind } from '../../../claude/utils/stopAction';

export type RemoteLauncherAbortHandlers = {
    /** 停止请求（批次 A 三档：turn 只中断当前 turn / turn-queue 加清两层队列 / turn-queue-tasks 再停后台任务） */
    onAbort: (stopKind: StopKind) => void | Promise<void>;
};

type RpcHandlerManagerLike = {
    registerHandler<TRequest = unknown, TResponse = unknown>(
        method: string,
        handler: (params: TRequest) => Promise<TResponse> | TResponse,
        options?: { countsAsUserActivity?: boolean }
    ): void;
};

/**
 * remote 启动器骨架。tui-fork 票 05 起 local 模式退场，会话宿主只剩进程内驱动
 * 这一条路径：这里不再有终端渲染、模式切换快捷键与 switch RPC——只保留
 * 主循环、清理与 abort RPC 的装配。
 */
export abstract class RemoteLauncherBase {
    /** 置位表示启动器应结束主循环（进程崩溃等终态由子类置位） */
    protected exited = false;

    protected abstract runMainLoop(): Promise<void>;

    protected abstract cleanup(): Promise<void>;

    protected setupAbortHandlers(
        rpcHandlerManager: RpcHandlerManagerLike,
        handlers: RemoteLauncherAbortHandlers
    ): void {
        // abort 是用户显式操作（Web 停止按钮），必须重置空闲计时——
        // 漏标会让用户刚点完停止的会话在 ~30s 后休眠退出
        rpcHandlerManager.registerHandler('abort', async (params: { stopKind?: StopKind }) => {
            // stopKind 入口校验：缺省（旧 daemon / 本地触发）或未知值（未来第 4 档 / 手误字符串）
            // 一律回落 'turn'——isCancelQueued 负向默认下，未知值透传会静默升级为破坏性清队列
            await handlers.onAbort(normalizeStopKind(params?.stopKind));
        }, { countsAsUserActivity: true });
    }

    protected clearAbortHandlers(rpcHandlerManager: RpcHandlerManagerLike): void {
        rpcHandlerManager.registerHandler('abort', async () => {});
    }

    protected async start(): Promise<void> {
        try {
            await this.runMainLoop();
        } finally {
            await this.cleanup();
        }
    }
}
