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
 * 关停闩（架构评审候选⑧票①）：executor 关停请求的一次性汇聚点。
 *
 * 此前 shutdownRequest / resolveExited / exited 三个闭包变量 + handle.stop 与
 * exited.then 双入口各自做「if (!shutdownRequest) 才挂 cleanup」的幂等守卫——
 * 两处守卫漂移即双跑清理。本 module 收口：请求只兑现一次 exited、cleanup 只挂
 * 一次；清理本体（停 control server / 释放锁 / 上报状态）由装配层注入。
 */

import { logger } from '@mobi/node-core/logger';

export class ShutdownLatch<TSource extends string = string> {
    private resolveExited!: (value: { source: TSource; errorMessage?: string }) => void;
    private cleanupPromise: Promise<void> | null = null;

    /** 关停事实（daemonEntry await 它编排薄壳退出） */
    readonly exited: Promise<{ source: TSource; errorMessage?: string }> = new Promise((resolve) => {
        this.resolveExited = resolve;
    });

    constructor(
        /** 关停后的清理（幂等由本闩保证，本体只需执行一次的顺序） */
        private readonly cleanup: (source: TSource, errorMessage?: string) => Promise<void>,
    ) {}

    /**
     * 发起关停（幂等）：内部触发（control server 指令）与外部 handle.stop()
     * 汇聚到同一份清理；首次请求兑现 exited 并挂 cleanup。
     */
    shutdown(source: TSource, errorMessage?: string): Promise<void> {
        logger.debug(`[EXECUTOR] Requesting shutdown (source: ${source}, errorMessage: ${errorMessage})`);
        this.resolveExited({ source, errorMessage });
        this.resolveExited = () => undefined;
        this.cleanupPromise ??= this.cleanup(source, errorMessage).catch((e) => {
            logger.debug('[EXECUTOR] Cleanup failed', e);
        });
        return this.cleanupPromise;
    }
}
