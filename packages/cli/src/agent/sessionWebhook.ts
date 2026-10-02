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

/**
 * 会话自报 webhook 客户端（session 侧）：会话启动后向本机 runner（daemon）
 * POST /session-started，驱动 runner 的追踪表登记（Q3 spawn 判据的闭环信号）。
 * 从 runner/controlClient 拆出（personal-agent-rewrite 解缠 6）——session 不再
 * 依赖 daemon 包；端点路径与请求体类型单源于 @mobi/shared/hostProtocol。
 */

import type { Metadata } from '@mobi/node-core/api/types'
import { RUNNER_SESSION_STARTED_PATH, type SessionStartedWebhookBody } from '@mobi/shared/hostProtocol'
import { loopbackRunnerPost } from '@mobi/node-core/utils/loopbackRunnerPost'

export async function notifyRunnerSessionStarted(
    sessionId: string,
    metadata: Metadata
): Promise<{ error?: string } | Record<string, unknown>> {
    const body: SessionStartedWebhookBody = {
        sessionId,
        metadata
    };
    return await loopbackRunnerPost(RUNNER_SESSION_STARTED_PATH, body);
}
