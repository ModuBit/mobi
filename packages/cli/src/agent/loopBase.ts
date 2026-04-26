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

export async function runLocalRemoteLoop<TSession extends AgentSessionBase<any>>(opts: {
    session: TSession;
    startingMode?: 'local' | 'remote';
    logTag: string;
    runLocal: LoopLauncher<TSession>;
    runRemote: LoopLauncher<TSession>;
}): Promise<void> {
    let mode: 'local' | 'remote' = opts.startingMode ?? 'local';

    // 初始化时根据 startingMode 启动 IdleTimer
    if (mode === 'remote') {
        logger.debug(`[${opts.logTag}] Initial mode is remote, calling onModeChange('remote')`);
        opts.session.onModeChange(mode);
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
