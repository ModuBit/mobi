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
import type { SessionKillRequest } from '@mobi/shared'

/** 可选终结语义与 daemon 发送端共用同一形状（总纲裁决：跨进程契约单一声明） */
type KillSessionRequest = SessionKillRequest;

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
