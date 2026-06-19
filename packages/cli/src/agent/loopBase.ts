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
import type { AgentSessionBase } from './sessionBase';

export type LoopLauncher<TSession> = (session: TSession) => Promise<'switch' | 'exit'>;

// 注：约束使用 any 而非 unknown 是刻意的——AgentSessionBase<Mode> 的 Mode
// 仅出现在逆变位置（MessageQueue.onMessageHandler 回调参数），严格函数类型下
// AgentSessionBase<EnhancedMode> 无法赋值给 AgentSessionBase<unknown>，会破坏
// 所有上游调用（Session -> AgentSessionBase<EnhancedMode>）。改 unknown 需要重构
// MessageQueue 的泛型方法签名（改成 method 而非 property），ROI 过低。
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function runLocalRemoteSession<TSession extends AgentSessionBase<any>>(opts: {
    session: TSession;
    startingMode?: 'local' | 'remote';
    logTag: string;
    runLocal: LoopLauncher<TSession>;
    runRemote: LoopLauncher<TSession>;
    onSessionReady?: (session: TSession) => void;
}): Promise<void> {
    if (opts.onSessionReady) {
        opts.onSessionReady(opts.session);
    }

    await runLocalRemoteLoop({
        session: opts.session,
        startingMode: opts.startingMode,
        logTag: opts.logTag,
        runLocal: opts.runLocal,
        runRemote: opts.runRemote
    });
}

// 见上方 runLocalRemoteSession 注释：AgentSessionBase<Mode> 在严格函数类型下
// 存在逆变约束，unknown 会导致上游 Session 赋值失败。
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function runLocalRemoteLoop<TSession extends AgentSessionBase<any>>(opts: {
    session: TSession;
    startingMode?: 'local' | 'remote';
    logTag: string;
    runLocal: LoopLauncher<TSession>;
    runRemote: LoopLauncher<TSession>;
}): Promise<void> {
    let mode: 'local' | 'remote' = opts.startingMode ?? 'local';

    // 初始化时根据 startingMode 启动 IdleTimer（不发送 switch 事件）
    if (mode === 'remote') {
        logger.debug(`[${opts.logTag}] Initial mode is remote, starting IdleTimer`);
        opts.session.client.startIdleTimer();
    }

    while (true) {
        logger.debug(`[${opts.logTag}] Iteration with mode: ${mode}`);

        if (mode === 'local') {
            const reason = await opts.runLocal(opts.session);
            if (reason === 'exit') {
                return;
            }

            mode = 'remote';
            opts.session.onModeChange(mode);
            continue;
        }

        if (mode === 'remote') {
            const reason = await opts.runRemote(opts.session);
            if (reason === 'exit') {
                return;
            }

            mode = 'local';
            opts.session.onModeChange(mode);
            continue;
        }
    }
}
