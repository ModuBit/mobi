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

import { backoff } from "@/utils/time";

/**
 * 失效-同步控制器
 *
 * 用于合并和控制异步操作的执行频率，避免短时间内多次触发相同操作。
 * 支持双缓冲机制：同步过程中收到新请求时，会在完成后再次执行一次。
 */
export class InvalidateSync {
    /** 标记当前是否正在执行同步操作，true 表示正在执行 */
    private _invalidated = false;
    /** 标记在同步执行期间是否收到新的 invalidate 请求，true 表示需要再执行一次 */
    private _invalidatedDouble = false;
    /** 标记同步器是否已停止，停止后将忽略所有 invalidate 请求 */
    private _stopped = false;
    /** 实际执行的异步命令 */
    private _command: () => Promise<void>;
    /** 等待同步完成的回调队列，用于 invalidateAndAwait() 的 Promise 解析 */
    private _pendings: (() => void)[] = [];

    /**
     * 创建同步器实例
     * @param command 实际执行的异步命令，会在 invalidate 触发时调用
     */
    constructor(command: () => Promise<void>) {
        this._command = command;
    }

    /**
     * 触发同步操作（非阻塞）
     * - 如果当前没有同步在执行，立即开始执行
     * - 如果正在执行，则标记需要再执行一次（双缓冲机制）
     * - 已停止时忽略请求
     */
    invalidate() {
        if (this._stopped) {
            return;
        }
        if (!this._invalidated) {
            this._invalidated = true;
            this._invalidatedDouble = false;
            this._doSync();
        } else {
            if (!this._invalidatedDouble) {
                this._invalidatedDouble = true;
            }
        }
    }

    /**
     * 触发同步操作并等待完成
     * - 返回 Promise，在同步完成（或停止）后 resolve
     * - 多次调用会按顺序依次完成
     */
    async invalidateAndAwait() {
        if (this._stopped) {
            return;
        }
        await new Promise<void>(resolve => {
            this._pendings.push(resolve);
            this.invalidate();
        });
    }

    /**
     * 停止同步器
     * - 停止后将忽略所有 invalidate 请求
     * - 会立即 resolve 所有等待中的 Promise
     */
    stop() {
        if (this._stopped) {
            return;
        }
        this._notifyPendings();
        this._stopped = true;
    }

    /**
     * 通知所有等待者同步已完成
     * - 遍历并执行所有 pending 回调，然后清空队列
     */
    private _notifyPendings = () => {
        for (let pending of this._pendings) {
            pending();
        }
        this._pendings = [];
    }


    /**
     * 执行实际的同步操作
     * - 使用 backoff 策略执行命令（失败时自动重试）
     * - 执行完成后检查是否有新的 invalidate 请求，有则再次执行
     * - 无新请求时重置状态并通知等待者
     */
    private _doSync = async () => {
        await backoff(async () => {
            if (this._stopped) {
                return;
            }
            await this._command();
        });
        if (this._stopped) {
            this._notifyPendings();
            return;
        }
        if (this._invalidatedDouble) {
            this._invalidatedDouble = false;
            this._doSync();
        } else {
            this._invalidated = false;
            this._notifyPendings();
        }
    }
}