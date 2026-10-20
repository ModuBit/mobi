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

import { RpcHandlerManager } from "@mobi/node-core/rpc/RpcHandlerManager";
import { logger } from '@mobi/node-core/logger'
import type { SessionEndReason, SessionPauseTrigger } from '@mobi/shared'

/** 可选终结语义（票 2.2）：携带时 daemon 指定了本次退出的 endReason——
 *  Governor 逐出走 pause/governor_evict；缺省沿用会话内已记录的终结原因（stop） */
type KillSessionRequest = { endReason?: SessionEndReason; pauseTrigger?: SessionPauseTrigger };

interface KillSessionResponse {
    success: boolean;
    message: string;
}


export function registerKillSessionHandler(
    rpcHandlerManager: RpcHandlerManager,
    killThisMobi: (end?: KillSessionRequest) => Promise<void>
) {
    rpcHandlerManager.registerHandler<KillSessionRequest, KillSessionResponse>('killSession', async (end) => {
        logger.debug('Kill session request received', end ?? {});

        // This will start the cleanup process
        void killThisMobi(end);

        // We should still be able to respond the the client, though they
        // should optimistically assume the session is dead.
        return {
            success: true,
            message: 'Killing mobi CLI process'
        };
    });
}
