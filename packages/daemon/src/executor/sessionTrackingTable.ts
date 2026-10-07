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
 * 会话追踪表（架构评审候选⑧票①）：executor 侧会话行的单一持有者。
 *
 * 此前 pidToTrackedSession / pidToAwaiter / pidToErrorAwaiter 三个 Map 是
 * startExecutor 闭包的自由变量，6 处 delete 配对散在 webhook / exit / error /
 * timeout / stop / prune 各路径——漏一处就漏 resolve 或悬空回调。本 module 把
 * 表行与其等待端（awaiter）收编同体：两者按 pid 同生共死，awaiter 不是独立
 * 概念而是「表行的等待端」，delete 配对全部消失在内部。
 *
 * 纯函数族（applySessionTrackingSignal / pruneDeadTrackedSessions /
 * createResumeDedupGuard，sessionTracking.ts / spawnDedup.ts）保持独立签名
 * 不变——server 侧 contract 测试直接消费它们；本表在方法内转发。
 */

import { logger } from '@mobi/node-core/logger';
import type { Metadata } from '@mobi/node-core/api/types';
import { isProcessAlive } from '@mobi/node-core/utils/process';
import type { TrackedSession } from './types';
import { applySessionTrackingSignal, pruneDeadTrackedSessions, type SessionTrackingSignal } from './sessionTracking';
import { createResumeDedupGuard } from './spawnDedup';

/** waitForWebhook 的结果：webhook 到达（成功）或 exit/error/超时（失败） */
export type WebhookWaitResult =
    | { ok: true; sessionId: string }
    | { ok: false; errorMessage: string };

export class SessionTrackingTable {
    private readonly sessions = new Map<number, TrackedSession>();
    /** spawn 等待端（webhook 到达 resolve）与失败端（exit/error/timeout resolve），与表行同生共死 */
    private readonly successAwaiters = new Map<number, (session: TrackedSession) => void>();
    private readonly errorAwaiters = new Map<number, (errorMessage: string) => void>();

    /** 当前全部追踪行（快照数组） */
    all(): TrackedSession[] {
        return Array.from(this.sessions.values());
    }

    get(pid: number): TrackedSession | undefined {
        return this.sessions.get(pid);
    }

    /** daemon spawn 登记（spawnSession 拿到 pid 后写入；随后 waitForWebhook 挂等待端） */
    registerDaemon(session: TrackedSession): void {
        this.sessions.set(session.pid, session);
    }

    /** 唤醒去重（.scratch/wake-dedup）：同机已有活 child 以相同 resume 目标拉起时命中 */
    checkResumeDedup(resumeSessionId: string | undefined) {
        return createResumeDedupGuard(this.sessions)(resumeSessionId);
    }

    /**
     * 会话子进程 webhook 上报（/session-started）：daemon spawn 的行回填
     * MobiSessionId 并 resolve 等待端；外部（终端直接启动）会话登记新行。
     */
    applyWebhook(sessionId: string, sessionMetadata: Metadata): void {
        logger.debugLargeJson(`[EXECUTOR] Session reported`, sessionMetadata);

        const pid = sessionMetadata.hostPid;
        if (!pid) {
            logger.debug(`[EXECUTOR] Session webhook missing hostPid for sessionId: ${sessionId}`);
            return;
        }

        logger.debug(`[EXECUTOR] Session webhook: ${sessionId}, PID: ${pid}, started by: ${sessionMetadata.startedBy || 'unknown'}`);
        logger.debug(`[EXECUTOR] Current tracked sessions before webhook: ${Array.from(this.sessions.keys()).join(', ')}`);

        const existingSession = this.sessions.get(pid);

        if (existingSession && existingSession.startedBy === 'daemon') {
            // Update executor-spawned session with reported data
            existingSession.MobiSessionId = sessionId;
            existingSession.MobiSessionMetadataFromLocalWebhook = sessionMetadata;
            logger.debug(`[EXECUTOR] Updated executor-spawned session ${sessionId} with metadata`);

            // Resolve any awaiter for this PID
            const awaiter = this.successAwaiters.get(pid);
            if (awaiter) {
                this.successAwaiters.delete(pid);
                this.errorAwaiters.delete(pid);
                awaiter(existingSession);
                logger.debug(`[EXECUTOR] Resolved session awaiter for PID ${pid}`);
            }
        } else if (!existingSession) {
            // New session started externally
            const trackedSession: TrackedSession = {
                startedBy: 'mobi directly - likely by user from terminal',
                MobiSessionId: sessionId,
                MobiSessionMetadataFromLocalWebhook: sessionMetadata,
                pid
            };
            this.sessions.set(pid, trackedSession);
            logger.debug(`[EXECUTOR] Registered externally-started session ${sessionId}`);
        }
    }

    /**
     * 挂等待端并等 webhook。timeoutMs 到点 resolve 失败——超时文案由调用方
     * 构造（stderr tail / exit 观测是 spawn 编排侧状态，经 onTimeout 回调交给此处）
     */
    waitForWebhook(pid: number, timeoutMs: number, onTimeout: () => string): Promise<WebhookWaitResult> {
        return new Promise((resolve) => {
            const timeout = setTimeout(() => {
                this.successAwaiters.delete(pid);
                this.errorAwaiters.delete(pid);
                resolve({ ok: false, errorMessage: onTimeout() });
            }, timeoutMs);

            this.successAwaiters.set(pid, (completedSession) => {
                clearTimeout(timeout);
                this.errorAwaiters.delete(pid);
                logger.debug(`[EXECUTOR] Session ${completedSession.MobiSessionId} fully spawned with webhook`);
                resolve({ ok: true, sessionId: completedSession.MobiSessionId! });
            });
            this.errorAwaiters.set(pid, (errorMessage) => {
                clearTimeout(timeout);
                resolve({ ok: false, errorMessage });
            });
        });
    }

    /** 失败端 resolve（exit / process error 先于 webhook）：无等待端时静默（后续 waitForWebhook 靠超时兜底） */
    failAwaiter(pid: number, errorMessage: string): void {
        const errorAwaiter = this.errorAwaiters.get(pid);
        if (errorAwaiter) {
            this.errorAwaiters.delete(pid);
            this.successAwaiters.delete(pid);
            errorAwaiter(errorMessage);
        }
    }

    /** 行退场（进程退出 / stop 命中）：连带清等待端，防悬空回调 */
    remove(pid: number): void {
        this.sessions.delete(pid);
        this.successAwaiters.delete(pid);
        this.errorAwaiters.delete(pid);
    }

    /** 会话 socket 重连/心跳的追踪补登（Q8 补登 + 查重键刷新，决策单源 sessionTracking.ts） */
    applySignal(signal: SessionTrackingSignal): void {
        const outcome = applySessionTrackingSignal(this.sessions, signal, isProcessAlive);
        logger.debug(`[EXECUTOR] Session tracking signal ${signal.sessionId}: ${outcome.op}${outcome.op === 'skip' ? ` (${outcome.reason})` : ''}`);
    }

    /** 定时自检：清理已死会话的追踪行，返回被清的 pid 列表 */
    pruneDead(): number[] {
        return pruneDeadTrackedSessions(this.sessions, isProcessAlive);
    }
}
