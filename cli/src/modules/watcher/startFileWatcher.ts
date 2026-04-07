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

import { logger } from "@/ui/logger";
import { delay } from "@/utils/time";
import { watch } from "fs/promises";

/**
 * 启动指定文件的监视器，监听文件变化并触发回调
 *
 * @param file - 要监视的文件路径
 * @param onFileChange - 文件变化时的回调函数，接收变化的文件路径作为参数
 * @returns 停止监视的函数，调用后可中止文件监视
 *
 * @description
 * 该函数使用 Node.js fs/promises.watch API 实现文件监视，具有以下特性：
 * - 自动重启：当监视器因错误中断时，会等待 1 秒后自动重新启动
 * - 优雅退出：返回的停止函数可通过 AbortController 立即中止监视
 * - 事件驱动：使用异步迭代器监听文件变化事件，无事件时处于挂起状态
 *
 * @example
 * ```typescript
 * const stopWatcher = startFileWatcher('/path/to/config.json', (file) => {
 *     console.log(`文件 ${file} 已变化，重新加载配置...`);
 * });
 *
 * // 停止监视
 * stopWatcher();
 * ```
 */
export function startFileWatcher(file: string, onFileChange: (file: string) => void) {
    const abortController = new AbortController();

    void (async () => {
        while (true) {
            try {
                logger.debug(`[FILE_WATCHER] Starting watcher for ${file}`);
                const watcher = watch(file, { persistent: true, signal: abortController.signal });
                for await (const event of watcher) {
                    if (abortController.signal.aborted) {
                        return;
                    }
                    logger.debug(`[FILE_WATCHER] File changed: ${file}`);
                    onFileChange(file);
                }
            } catch (e: any) {
                if (abortController.signal.aborted) {
                    return;
                }
                logger.debug(`[FILE_WATCHER] Watch error: ${e.message}, restarting watcher in a second`);
                await delay(1000);
            }
        }
    })();

    return () => {
        abortController.abort();
    };
}