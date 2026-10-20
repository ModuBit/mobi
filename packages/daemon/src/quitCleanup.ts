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
 * QuitCleanup（迭代四票 4.1，borrow Desktop onQuitCleanup）：daemon 退出时的
 * 逐项清理编排——命名 handler 注册表 + 并发分批（≤4）+ 逐项计时 + **总时限到点
 * 放弃未完成者并记名单**，不阻塞退出（supervisor 的 KILL_GRACE_MS 之外 daemon
 * 自己不再无限等任何清理项）。
 *
 * 语义边界：单项无独立超时——总时限是唯一闸；被放弃的 handler 不再被等待，
 * 其 promise 由运行时自行落定（典型如 flush 类任务的丢弃是可接受的：结构化
 * 日志/governance 事件均允许尾丢）。降载与进程级关停（executor.stop/server.stop）
 * 不在此注册表内，由 daemonEntry 编排序承载（先降载 → handlers → 进程级 stop）。
 */

import { daemonLogger } from './logger'

/** 清理并发上限（Desktop 同款） */
export const QUIT_HANDLER_CONCURRENCY = 4;

export type QuitHandler = () => Promise<void>;

export interface QuitCleanupResult {
    /** 按落定顺序（去重由注册侧保证）记录完成（含 failed——见字段）以外的名单 */
    completed: string[];
    /** 总时限到点仍在途、被放弃的 handler 名单（落日志供事后排查） */
    abandoned: string[];
    /** 执行中抛错的 handler 名单（已捕获，不影响其余项） */
    failed: string[];
    /** 逐项耗时毫秒（completed + failed 有值；abandoned 无） */
    timings: Record<string, number>;
}

export class QuitCleanup {
    private readonly handlers = new Map<string, QuitHandler>();

    /**
     * 注册清理 handler。重复 name 直接抛错：清理项的 name 是日志与放弃名单里的
     * 身份，静默覆盖会让排查时张冠李戴——注册期失败优于退出期才发现。
     */
    registerQuitHandler(name: string, fn: QuitHandler): void {
        if (this.handlers.has(name)) {
            throw new Error(`duplicate quit handler name: ${name}`);
        }
        this.handlers.set(name, fn);
    }

    /**
     * 执行全部清理 handler：分批并发（≤QUIT_HANDLER_CONCURRENCY）、逐项计时；
     * 总时限到点即返回——仍在途者进 abandoned 名单并整体落一条日志，不等待。
     */
    async runAll(totalTimeoutMs: number): Promise<QuitCleanupResult> {
        const completed: string[] = [];
        const failed: string[] = [];
        const timings: Record<string, number> = {};
        const settled = new Set<string>();
        const entries = Array.from(this.handlers.entries());

        const runOne = async ([name, fn]: [string, QuitHandler]): Promise<void> => {
            const startedAt = Date.now();
            try {
                await fn();
                timings[name] = Date.now() - startedAt;
                completed.push(name);
                daemonLogger.debug(`[QUIT] handler '${name}' done in ${timings[name]}ms`);
            } catch (error) {
                timings[name] = Date.now() - startedAt;
                failed.push(name);
                daemonLogger.warn(`[QUIT] handler '${name}' failed in ${timings[name]}ms: ${error instanceof Error ? error.message : String(error)}`);
            } finally {
                settled.add(name);
            }
        };

        // 分批并发（≤4）：批内 Promise.allSettled 等待；整体与总时限 race
        const runBatches = (async () => {
            for (let i = 0; i < entries.length; i += QUIT_HANDLER_CONCURRENCY) {
                await Promise.allSettled(
                    entries.slice(i, i + QUIT_HANDLER_CONCURRENCY).map(runOne),
                );
            }
        })();

        const deadline = new Promise<'timeout'>((resolve) => {
            setTimeout(() => { resolve('timeout'); }, totalTimeoutMs);
        });

        const outcome = await Promise.race([runBatches.then(() => 'done' as const), deadline]);
        if (outcome === 'timeout') {
            const abandoned = entries.map(([name]) => name).filter((name) => !settled.has(name));
            daemonLogger.warn(
                `[QUIT] quit cleanup deadline (${totalTimeoutMs}ms) reached; abandoned handlers: ${abandoned.join(', ') || '(none)'}`,
            );
            return { completed, abandoned, failed, timings };
        }
        return { completed, abandoned: [], failed, timings };
    }
}
