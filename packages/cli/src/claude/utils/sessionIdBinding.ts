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
 * sessionId 绑定守卫（transport 无关的核心）。
 *
 * Claude 侧 SessionStart hook（local 模式经 HTTP Hook Server、remote 模式经
 * SDK 进程内回调，见 ADR 0001）与 systemInit 双源触发 onSessionFound，
 * 此处收口「仅在 id 变更时绑定一次」的幂等语义，供两个 transport 复用。
 */

import { logger } from '@/ui/logger'

/** 绑定所需的最小 Session 结构（结构化类型，避免依赖完整 Session）；sessionId 为 null 表示尚未发现 */
export interface SessionIdBindTarget {
    sessionId: string | null
    onSessionFound(sessionId: string): void
}

/**
 * 将 Claude 侧上报的 sessionId 绑定到当前会话。
 * 幂等：与当前 id 相同不触发；会话未就绪（null）静默跳过。
 */
export function applySessionIdBinding(
    getCurrentSession: () => SessionIdBindTarget | null,
    newSessionId: string,
): void {
    const currentSession = getCurrentSession();
    if (currentSession) {
        const previousSessionId = currentSession.sessionId;
        if (previousSessionId !== newSessionId) {
            logger.debug(`[START] Claude session ID changed: ${previousSessionId} -> ${newSessionId}`);
            currentSession.onSessionFound(newSessionId);
        }
    }
}
