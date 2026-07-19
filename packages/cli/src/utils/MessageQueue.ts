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

interface QueueItem<T> {
    message: string;
    mode: T;
    modeHash: string;
    isolate?: boolean; // If true, this message must be processed alone
    localId?: string; // 用户消息的本地 ID，用于通知 Hub 已消费
}

/**
 * in-flight 集合容量上限（近期守卫）。被 collect/steal 的 localId 在 Hub 确认 consumed 前需保留，
 * 以拒绝取消（防幽灵消息）。正常情况下 Hub 几百 ms 内即落库，in-flight 实际只积压个位数；
 * 此上限只是防止异常积压时无界增长。
 */
export const IN_FLIGHT_CAP = 500

/**
 * 「曾 shift 出队列」的 localId 容量上限（最终兜底）。
 *
 * in-flight 淘汰只是因为「近期守卫」过期，但「这条消息曾经被 dispatch 喂给 agent」这一事实永久
 * 有效——即便 Hub 迟迟未落库（onBatchConsumed 的 socket emit 丢失 / Hub 重启不重放历史），
 * 也不能让 Web 取消成功删除 DB，否则 agent 已收到并会回复一条用户以为已取消的幽灵消息。
 * 故 in-flight 淘汰时把 localId 留在 everDispatched，tryCancel 对其仍返回 'submitted'（保守不可取消）。
 *
 * 只有当 everDispatched 也超限（单 session dispatch 5000 条仍未落库，现实不可达）才彻底遗忘，
 * 退回 'not-in-queue' 交 Hub DB 裁决。reset/close 随 session 清空。
 */
export const EVER_DISPATCHED_CAP = 5000

/**
 * A mode-aware message queue that stores messages with their modes.
 * Returns consistent batches of messages with the same mode.
 */
export class MessageQueue<T> {
    public queue: QueueItem<T>[] = []; // Made public for testing
    private waiter: ((hasMessages: boolean) => void) | null = null;
    private closed = false;
    private onMessageHandler: ((message: string, mode: T) => void) | null = null;
    private onBatchConsumedHandler: ((localIds: string[]) => void) | null = null;
    /**
     * 已被 collectBatch/steal 取出（即将喂给 agent）、但 Hub 尚未确认 consumed 的 localId。
     * 取消竞态防护：此集合内的消息已离开队列，不可取消，否则会产生幽灵消息
     * （agent 收到并回复一条用户以为已取消的消息）。FIFO 有界（IN_FLIGHT_CAP），防长会话无界增长。
     */
    private readonly inFlightLocalIds: Map<string, true> = new Map();
    /**
     * 曾 shift 出队列（dispatch 给 agent 或经 pushAfterClear 丢弃）的全部 localId，FIFO 有界
     * （EVER_DISPATCHED_CAP）。即便 in-flight 近期守卫过期淘汰，此处仍保留——「曾 dispatch」
     * 的事实永久有效，Hub 未落库时也不可取消（详见 EVER_DISPATCHED_CAP 注释）。
     */
    private readonly everDispatchedLocalIds: Map<string, true> = new Map();
    modeHasher: (mode: T) => string;

    constructor(
        modeHasher: (mode: T) => string,
        onMessageHandler: ((message: string, mode: T) => void) | null = null
    ) {
        this.modeHasher = modeHasher;
        this.onMessageHandler = onMessageHandler;
        logger.debug(`[MessageQueue] Initialized`);
    }

    /**
     * Set a handler that will be called when a message arrives
     */
    setOnMessage(handler: ((message: string, mode: T) => void) | null): void {
        this.onMessageHandler = handler;
    }

    /** 设置「一批消息被 collectBatch shift 消费」回调（用于 emit messages-submitted） */
    setOnBatchConsumed(handler: ((localIds: string[]) => void) | null): void {
        this.onBatchConsumedHandler = handler;
    }

    /**
     * Push a message to the queue with a mode.
     */
    push(message: string, mode: T, localId?: string): void {
        if (this.closed) {
            throw new Error('Cannot push to closed queue');
        }

        const modeHash = this.modeHasher(mode);
        logger.debug(`[MessageQueue] push() called with mode hash: ${modeHash}`);

        this.queue.push({
            message,
            mode,
            modeHash,
            isolate: false,
            localId
        });

        // Trigger message handler if set
        if (this.onMessageHandler) {
            this.onMessageHandler(message, mode);
        }

        // Notify waiter if any
        if (this.waiter) {
            logger.debug(`[MessageQueue] Notifying waiter`);
            const waiter = this.waiter;
            this.waiter = null;
            waiter(true);
        }

        logger.debug(`[MessageQueue] push() completed. Queue size: ${this.queue.length}`);
    }

    /**
     * Push a message immediately without batching delay.
     * Does not clear the queue or enforce isolation.
     */
    pushImmediate(message: string, mode: T, localId?: string): void {
        this.push(message, mode, localId);
    }

    /**
     * Push a message after clearing the queue.
     * Clears any pending messages but does NOT set isolate flag.
     * Used for commands like /compact that need a clean queue but should be processed normally.
     */
    pushAndClear(message: string, mode: T, localId?: string): void {
        this.pushAfterClear(message, mode, false, localId);
    }

    /**
     * Push a message that must be processed in complete isolation.
     * Clears any pending messages and ensures this message is never batched with others.
     * Used for special commands that require dedicated processing (e.g., /clear).
     */
    pushIsolateAndClear(message: string, mode: T, localId?: string): void {
        this.pushAfterClear(message, mode, true, localId);
    }

    /**
     * 内部方法：清空队列后推送消息
     * @param isolate - true 表示隔离处理（触发 claudeRemote 重启），false 表示正常处理
     */
    private pushAfterClear(message: string, mode: T, isolate: boolean, localId?: string): void {
        if (this.closed) {
            throw new Error('Cannot push to closed queue');
        }

        const modeHash = this.modeHasher(mode);
        const methodName = isolate ? 'pushIsolateAndClear' : 'pushAndClear';
        logger.debug(`[MessageQueue] ${methodName}() mode=${modeHash}, clearing ${this.queue.length} messages`);

        // 被清空的排队项需要通知 Hub 标记为已处理（submittedAt），否则其 DB 行永远 submitted_at=null，
        // Web 悬浮条会永久卡死。收集带 localId 的丢弃项，触发 onBatchConsumed（与正常消费同路径）。
        const discardedLocalIds = this.queue
            .map(item => item.localId)
            .filter((l): l is string => Boolean(l));

        this.queue = [];

        this.queue.push({
            message,
            mode,
            modeHash,
            isolate,
            localId
        });

        // 通知丢弃项已「离开队列」（agent 不会再处理它们）。同步标 in-flight，与 collectBatch/steal
        // 语义一致：这些 localId 已离开 CLI 队列、即将经 onBatchConsumed 标 consumed 落库，此窗口内
        // 不可取消（否则与「保留为 consumed」矛盾，且 onBatchConsumed 落库前删除会让消息无故消失）
        if (discardedLocalIds.length > 0) {
            for (const id of discardedLocalIds) this.markInFlight(id);
            this.onBatchConsumedHandler?.(discardedLocalIds);
        }

        if (this.onMessageHandler) {
            this.onMessageHandler(message, mode);
        }

        if (this.waiter) {
            logger.debug(`[MessageQueue] Notifying waiter`);
            const waiter = this.waiter;
            this.waiter = null;
            waiter(true);
        }

        logger.debug(`[MessageQueue] ${methodName}() done, queue.size=${this.queue.length}`);
    }

    /**
     * Push a message to the beginning of the queue with a mode.
     */
    unshift(message: string, mode: T, localId?: string): void {
        if (this.closed) {
            throw new Error('Cannot unshift to closed queue');
        }

        const modeHash = this.modeHasher(mode);
        logger.debug(`[MessageQueue] unshift() called with mode hash: ${modeHash}`);

        this.queue.unshift({
            message,
            mode,
            modeHash,
            isolate: false,
            localId
        });

        // Trigger message handler if set
        if (this.onMessageHandler) {
            this.onMessageHandler(message, mode);
        }

        // Notify waiter if any
        if (this.waiter) {
            logger.debug(`[MessageQueue] Notifying waiter`);
            const waiter = this.waiter;
            this.waiter = null;
            waiter(true);
        }

        logger.debug(`[MessageQueue] unshift() completed. Queue size: ${this.queue.length}`);
    }

    /**
     * Reset the queue - clears all messages and resets to empty state
     */
    reset(): void {
        logger.debug(`[MessageQueue] reset() called. Clearing ${this.queue.length} messages`);
        this.queue = [];
        this.inFlightLocalIds.clear();
        this.everDispatchedLocalIds.clear();
        this.closed = false;

        // Clear waiter without calling it since we're not closing
        this.waiter = null;
    }

    /**
     * Close the queue - no more messages can be pushed
     */
    close(): void {
        logger.debug(`[MessageQueue] close() called`);
        this.closed = true;

        // Notify any waiting caller
        if (this.waiter) {
            const waiter = this.waiter;
            this.waiter = null;
            waiter(false);
        }
    }

    /**
     * Check if the queue is closed
     */
    isClosed(): boolean {
        return this.closed;
    }

    /**
     * Get the current queue size
     */
    size(): number {
        return this.queue.length;
    }

    /** 删除仍排队（未消费）的 localId 消息。返回是否删除成功。 */
    cancelByLocalId(localId: string): boolean {
        const idx = this.queue.findIndex(item => item.localId === localId);
        if (idx < 0) return false;
        this.queue.splice(idx, 1);
        logger.debug(`[MessageQueue] cancelByLocalId removed ${localId}, size=${this.queue.length}`);
        return true;
    }

    /**
     * 取出并移除指定 localId 的排队消息，返回其内容与 mode。
     * 用于 steer：把仍排队的消息提前提交给 SDK input stream，避免 collectBatch 重复投递。
     * 不命中返回 null。
     */
    stealByLocalId(localId: string): { message: string, mode: T } | null {
        const idx = this.queue.findIndex(item => item.localId === localId);
        if (idx < 0) return null;
        const [item] = this.queue.splice(idx, 1);
        // 同步标记 in-flight：消息已离开队列、即将推入 SDK input stream，不可取消
        this.markInFlight(localId);
        logger.debug(`[MessageQueue] stealByLocalId stole ${localId}, size=${this.queue.length}`);
        return { message: item.message, mode: item.mode };
    }

    /**
     * 尝试取消仍排队的 localId 消息。返回：
     * - 'cancelled'：仍在队列中，已移除（可安全取消）。
     * - 'submitted'：已 collectBatch/steal（in-flight），或曾 shift 出队列（everDispatched），
     *   即将/已经喂给 agent，不可取消（否则幽灵消息）。
     * - 'not-in-queue'：CLI 未知（尚未送达，或 everDispatched 已彻底遗忘），交由 Hub DB 裁决。
     */
    tryCancel(localId: string): 'cancelled' | 'submitted' | 'not-in-queue' {
        if (this.inFlightLocalIds.has(localId)) return 'submitted'
        if (this.everDispatchedLocalIds.has(localId)) return 'submitted'
        return this.cancelByLocalId(localId) ? 'cancelled' : 'not-in-queue'
    }

    /**
     * 标记 localId 为已 dispatch（in-flight 近期守卫 + everDispatched 永久事实）。
     * inFlight 与 everDispatched 各自 FIFO 淘汰最旧，但 inFlight 淘汰不影响 everDispatched。
     */
    private markInFlight(localId: string): void {
        // 重新插入到末尾，维持时序
        this.inFlightLocalIds.delete(localId)
        this.inFlightLocalIds.set(localId, true)
        this.everDispatchedLocalIds.delete(localId)
        this.everDispatchedLocalIds.set(localId, true)
        // inFlight 近期守卫淘汰（落库后此集合过期无碍，everDispatched 仍兜底）
        while (this.inFlightLocalIds.size > IN_FLIGHT_CAP) {
            const oldest = this.inFlightLocalIds.keys().next().value
            if (oldest === undefined) break
            this.inFlightLocalIds.delete(oldest)
        }
        // everDispatched 最终兜底淘汰（单 session dispatch 5000 条仍未落库，现实不可达）
        while (this.everDispatchedLocalIds.size > EVER_DISPATCHED_CAP) {
            const oldest = this.everDispatchedLocalIds.keys().next().value
            if (oldest === undefined) break
            this.everDispatchedLocalIds.delete(oldest)
        }
    }

    /**
     * Wait for messages and return all messages with the same mode as a single string
     * Returns { message: string, mode: T, isolate: boolean, hash: string, localIds: string[] } or null if aborted/closed
     */
    async waitForMessagesAndGetAsString(abortSignal?: AbortSignal): Promise<{ message: string, mode: T, isolate: boolean, hash: string, localIds: string[] } | null> {
        // If we have messages, return them immediately
        if (this.queue.length > 0) {
            return this.collectBatch();
        }

        // If closed or already aborted, return null
        if (this.closed || abortSignal?.aborted) {
            return null;
        }

        // Wait for messages to arrive
        const hasMessages = await this.waitForMessages(abortSignal);

        if (!hasMessages) {
            return null;
        }

        return this.collectBatch();
    }

    /**
     * Collect a batch of messages with the same mode, respecting isolation requirements
     */
    private collectBatch(): { message: string, mode: T, hash: string, isolate: boolean, localIds: string[] } | null {
        if (this.queue.length === 0) {
            return null;
        }

        const firstItem = this.queue[0];
        const sameModeMessages: string[] = [];
        const consumedLocalIds: string[] = [];
        const mode = firstItem.mode;
        const isolate = firstItem.isolate ?? false;
        const targetModeHash = firstItem.modeHash;

        // If the first message requires isolation, only process it alone
        if (firstItem.isolate) {
            const item = this.queue.shift()!;
            sameModeMessages.push(item.message);
            if (item.localId) {
                consumedLocalIds.push(item.localId);
            }
            logger.debug(`[MessageQueue] Collected isolated message with mode hash: ${targetModeHash}`);
        } else {
            // Collect all messages with the same mode until we hit an isolated message
            while (this.queue.length > 0 &&
                this.queue[0].modeHash === targetModeHash &&
                !this.queue[0].isolate) {
                const item = this.queue.shift()!;
                sameModeMessages.push(item.message);
                if (item.localId) {
                    consumedLocalIds.push(item.localId);
                }
            }
            logger.debug(`[MessageQueue] Collected batch of ${sameModeMessages.length} messages with mode hash: ${targetModeHash}`);
        }

        // 通知 Hub：这批消息已被消费
        if (consumedLocalIds.length > 0) {
            // 同步标记 in-flight（早于 onBatchConsumed 触发的异步 socket），关闭取消竞态窗口
            for (const id of consumedLocalIds) this.markInFlight(id);
            this.onBatchConsumedHandler?.(consumedLocalIds);
        }

        // Join all messages with newlines
        const combinedMessage = sameModeMessages.join('\n');

        return {
            message: combinedMessage,
            mode,
            hash: targetModeHash,
            isolate,
            localIds: consumedLocalIds
        };
    }

    /**
     * Wait for messages to arrive
     */
    private waitForMessages(abortSignal?: AbortSignal): Promise<boolean> {
        return new Promise((resolve) => {
            let settled = false;
            let abortHandler: (() => void) | null = null;
            const waiterFunc: (hasMessages: boolean) => void = (hasMessages: boolean) => {
                finish(hasMessages);
            };

            const finish = (hasMessages: boolean) => {
                if (settled) {
                    return;
                }
                settled = true;
                if (this.waiter === waiterFunc) {
                    this.waiter = null;
                }
                // Clean up abort handler
                if (abortHandler && abortSignal) {
                    abortSignal.removeEventListener('abort', abortHandler);
                }
                resolve(hasMessages);
            };

            // Set up abort handler
            if (abortSignal) {
                abortHandler = () => {
                    logger.debug('[MessageQueue] Wait aborted');
                    finish(false);
                };
                abortSignal.addEventListener('abort', abortHandler);
            }

            // Set the waiter before checking the queue to avoid missed notifications
            this.waiter = waiterFunc;

            // Check again in case messages arrived or queue closed while setting up
            if (this.queue.length > 0) {
                finish(true);
                return;
            }

            if (this.closed || abortSignal?.aborted) {
                finish(false);
                return;
            }

            logger.debug('[MessageQueue] Waiting for messages...');
        });
    }
}
