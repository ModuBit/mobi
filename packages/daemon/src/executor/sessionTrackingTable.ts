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
 * createSpawnDedupGuard，sessionTracking.ts / spawnDedup.ts）保持独立签名
 * 不变——server 侧 contract 测试直接消费它们；本表在方法内转发。
 */

import { logger } from '@mobi/node-core/logger';
import type { Metadata } from '@mobi/node-core/api/types';
import { isProcessAlive } from '@mobi/node-core/utils/process';
import type { TrackedSession } from './types';
import { applySessionTrackingSignal, pruneDeadTrackedSessions, type SessionTrackingSignal } from './sessionTracking';
import { createSpawnDedupGuard, dedupKeys, findRunningDuplicate, type SpawnClaim, type SpawnDedupKey } from './spawnDedup';

/** waitForWebhook 的结果：webhook 到达（成功）或 exit/error/超时（失败） */
export type WebhookWaitResult =
    | { ok: true; sessionId: string }
    | { ok: false; errorMessage: string };

export class SessionTrackingTable {
    private readonly sessions = new Map<number, TrackedSession>();
    /** 在途 spawn 的会话键预约（dedupKeys 编码 → 占用令牌）；登记表行后释放 */
    private readonly pendingSpawnClaims = new Map<string, symbol>();
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

    /** 唤醒去重（.scratch/wake-dedup + #108 双键）：同机已有活 child 属于同一会话时命中——
     *  resume 目标相同，或 mobi 行 id 相同（覆盖 webhook 前在途窗口）。
     *  传快照而非内部 Map 活引用——spawnDedup 只做一次性决策，不应对表内部结构形成依赖 */
    checkSpawnDedup(key: SpawnDedupKey) {
        return createSpawnDedupGuard(new Map(this.sessions))(key);
    }

    /**
     * spawn 在途预约（同步）：查重命中（活表项或别的在途 spawn 已占同一会话键）返回
     * null；否则当场占用比对键并返回释放凭证。查重与占用之间没有 await——这是收口
     * check-then-act 竞态的关键：registerDaemon 之前隔着目录检查/mkdir/进程创建，
     * 并发激活请求都能通过 checkSpawnDedup。
     *
     * 登记追踪表行后立即 release（交接：表行接管去重），失败路径由调用方 finally 释放。
     * 无键（Web 新会话）不预约，行为与既有查重一致。
     *
     * 命中必须落 INFO：spawn/dormancy 事故（幽灵行阻塞唤醒，2026-10-29）在生产日志
     * 不可考的根因就是这条路径只写 debug。命中行详情（pid/年龄/来源）是事后定位
     * 「幽灵从哪来」的唯一证据。
     */
    claimSpawn(key: SpawnDedupKey): SpawnClaim | null {
        const duplicate = findRunningDuplicate(this.sessions.values(), key);
        if (duplicate) {
            const ageS = Math.round((Date.now() - duplicate.registeredAt) / 1000);
            logger.info(
                `[EXECUTOR] spawn deduped by tracked row (key=${dedupKeys(key).join(',') || '<none>'}, ` +
                `hit pid=${duplicate.pid}, mobi=${duplicate.MobiSessionId ?? '<unset>'}, ` +
                `resume=${duplicate.resumeSessionId ?? '<unset>'}, startedBy=${duplicate.startedBy}, age=${ageS}s)`
            );
            return null;
        }

        const keys = dedupKeys(key);
        if (keys.some((k) => this.pendingSpawnClaims.has(k))) {
            logger.info(`[EXECUTOR] spawn deduped by in-flight claim (key=${keys.join(',')})`);
            return null;
        }

        const token = Symbol('spawn-claim');
        for (const k of keys) this.pendingSpawnClaims.set(k, token);

        let released = false;
        return {
            release: () => {
                if (released) return;
                released = true;
                for (const k of keys) {
                    if (this.pendingSpawnClaims.get(k) === token) this.pendingSpawnClaims.delete(k);
                }
            },
        };
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
                pid,
                registeredAt: Date.now()
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
