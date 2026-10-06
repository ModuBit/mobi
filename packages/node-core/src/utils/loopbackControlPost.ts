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
 * 向本机 executor controlServer 发 POST 的传输底座：读 daemon 本地状态（ticket-22
 * 起 runner.state.json 停写，controlServer 端口记录在 daemon.state.json 的
 * controlPort，502 前旧名 runnerHttpPort 读兜底）→ 探活 → loopback fetch。
 * daemon（controlClient）与 session（sessionWebhook）两侧共用，从
 * 历史 controlClient 的 runnerPost 抽出（personal-agent-rewrite 解缠 6）。
 */

import { readDaemonState, type LegacyDaemonStateFields } from '../persistence'
import { isProcessAlive } from './process'
import { logger } from '../logger'

/** 向本机 executor controlServer 发 POST；daemon 不在 / 请求失败时返回 { error } 不抛异常 */
export async function loopbackControlPost(
    path: string,
    body?: unknown
): Promise<{ error?: string } | Record<string, unknown>> {
    const state = await readDaemonState();
    if (!state) {
        const errorMessage = 'No daemon running, no state file found';
        logger.debug(`[CONTROL CLIENT] ${errorMessage}`);
        return {
            error: errorMessage
        };
    }

    // 502 读旧写新：新名 controlPort，存量旧名 runnerHttpPort 兜底
    const controlPort = state.controlPort ?? (state as typeof state & LegacyDaemonStateFields).runnerHttpPort;
    if (!controlPort) {
        const errorMessage = 'No daemon running, no state file found';
        logger.debug(`[CONTROL CLIENT] ${errorMessage}`);
        return {
            error: errorMessage
        };
    }

    if (!isProcessAlive(state.pid)) {
        const errorMessage = 'Daemon is not running, file is stale';
        logger.debug(`[CONTROL CLIENT] ${errorMessage}`);
        return {
            error: errorMessage
        };
    }

    try {
        const timeout = process.env.MOBI_RUNNER_HTTP_TIMEOUT ? parseInt(process.env.MOBI_RUNNER_HTTP_TIMEOUT) : 10_000;
        const response = await fetch(`http://127.0.0.1:${controlPort}${path}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body || {}),
            // Mostly increased for stress test
            signal: AbortSignal.timeout(timeout)
        });

        if (!response.ok) {
            const errorMessage = `Request failed: ${path}, ${response.status}`;
            logger.debug(`[CONTROL CLIENT] ${errorMessage}`);
            return {
                error: errorMessage
            };
        }

        const result = await response.json().catch(() => ({}));
        return result as Record<string, unknown>;
    } catch (error) {
        const errorMessage = `Request failed: ${path}, ${error instanceof Error ? error.message : 'Unknown error'}`;
        logger.debug(`[CONTROL CLIENT] ${errorMessage}`);
        return {
            error: errorMessage
        };
    }
}
