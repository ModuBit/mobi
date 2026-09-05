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
import type { PromptContentBlock, PromptPayload } from "./promptBuilder";

interface QueueItem<T> {
    message: PromptPayload;
    mode: T;
    modeHash: string;
    isolate?: boolean; // If true, this message must be processed alone
    noBatch?: boolean; // If true, never batch-merge with others (no isolate's restart-to-next-session semantics, for !bash local execution)
    localId?: string; // 用户消息的本地 ID，用于通知 Hub 已消费
}

/**
 * 多条用户消息合并为一份 payload：两侧均为 string 用 '\n' 连接（与历史 join('\n') 行为一致）；
 * 任一侧为数组则走元素级 concat（插入的 '\n' 分隔符是独立 text 元素，Anthropic 拼接语义下
 * 与原行为等价，元素零丢失）。
 */
function mergePayloads(a: PromptPayload, b: PromptPayload): PromptPayload {
    if (typeof a === "string" && typeof b === "string") return `${a}\n${b}`;
    const toEls = (p: PromptPayload): PromptContentBlock[] =>
        typeof p === "string" ? [{ type: "text", text: p }] : p;
    return [...toEls(a), { type: "text", text: "\n" }, ...toEls(b)];
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
    private onMessageHandler: ((message: PromptPayload, mode: T) => void) | null = null;
    private onBatchConsumedHandler: ((localIds: string[]) => void) | null = null;
    /** collectBatch 前的排序屏障（见 setBeforeCollect） */
    private beforeCollectHandler: (() => void | Promise<void>) | null = null;
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
        onMessageHandler: ((message: PromptPayload, mode: T) => void) | null = null
    ) {
        this.modeHasher = modeHasher;
        this.onMessageHandler = onMessageHandler;
        logger.debug(`[MessageQueue] Initialized`);
    }

    /**
     * Set a handler that will be called when a message arrives
     */
    setOnMessage(handler: ((message: PromptPayload, mode: T) => void) | null): void {
        this.onMessageHandler = handler;
    }

    /** 设置「一批消息被 collectBatch shift 消费」回调（用于 emit messages-facts pushed fact） */
    setOnBatchConsumed(handler: ((localIds: string[]) => void) | null): void {
        this.onBatchConsumedHandler = handler;
    }

    /**
     * 设置「collectBatch 消费前」的排序屏障 hook（每次消费前 await）。
     *
     * 为什么需要：collectBatch 触发的 onBatchConsumed（pushed fact）走直连 socket emit，
     * 而上游发送队列（OutgoingMessageQueue）经 setTimeout(0) 异步发送上一轮消息（含 result）。
     * turn 结束立即消费排队消息时，fact 会抢在上一轮 result 落库前到达 Hub——position_at
     * 跳变时刻早于 result 的 created_at，Web 按 positionAt 排序时排队消息会被排到
     * 上一轮 result 之前。屏障保证「先清空上游发送队列，再上报消费事实」。
     */
    setBeforeCollect(handler: (() => void | Promise<void>) | null): void {
        this.beforeCollectHandler = handler;
    }

    /**
     * Push a message to the queue with a mode.
     */
    push(message: PromptPayload, mode: T, localId?: string): void {
        this.enqueue(message, mode, localId);
    }

    /**
     * Push a message that must never be batch-merged with others.
     * Unlike isolate (which additionally means "stash to next session restart", e.g. /clear),
     * noBatch only prevents merging — used for !bash local execution: a merged batch like
     * "! cmd\n正文" would run the normal message text as shell input and mis-bind native_id.
     */
    pushNoBatch(message: PromptPayload, mode: T, localId?: string): void {
        this.enqueue(message, mode, localId, { noBatch: true });
    }

    /** 入队内部实现：统一的 handler 通知与 waiter 唤醒 */
    private enqueue(message: PromptPayload, mode: T, localId?: string, flags: { noBatch?: boolean } = {}): void {
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
            noBatch: flags.noBatch,
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
    pushImmediate(message: PromptPayload, mode: T, localId?: string): void {
        this.push(message, mode, localId);
    }

    /**
     * Push a message after clearing the queue.
     * Clears any pending messages but does NOT set isolate flag.
     * Used for commands like /compact that need a clean queue but should be processed normally.
     */
    pushAndClear(message: PromptPayload, mode: T, localId?: string): void {
        this.pushAfterClear(message, mode, false, localId);
    }

    /**
     * Push a message that must be processed in complete isolation.
     * Clears any pending messages and ensures this message is never batched with others.
     * Used for special commands that require dedicated processing (e.g., /clear).
     */
    pushIsolateAndClear(message: PromptPayload, mode: T, localId?: string): void {
        this.pushAfterClear(message, mode, true, localId);
    }

    /**
     * 内部方法：清空队列后推送消息
     * @param isolate - true 表示隔离处理（触发 claudeRemote 重启），false 表示正常处理
     */
    private pushAfterClear(message: PromptPayload, mode: T, isolate: boolean, localId?: string): void {
        if (this.closed) {
            throw new Error('Cannot push to closed queue');
        }

        const modeHash = this.modeHasher(mode);
        const methodName = isolate ? 'pushIsolateAndClear' : 'pushAndClear';
        logger.debug(`[MessageQueue] ${methodName}() mode=${modeHash}, clearing ${this.queue.length} messages`);

        // 被清空的排队项需要通知 Hub 标记为已推送（lifecycle='pushed'），否则其 DB 行永远停留 queued，
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
     * rewind 前清空未消费排队项（不注入新消息）：丢弃项经 onBatchConsumed 通知 Hub 标记，
     * 防 Web 悬浮条永久卡死（对齐 pushAfterClear 的丢弃通知与 markInFlight 模式）。
     * 与 pushAfterClear 的区别：不压入任何替代消息——rewind 的「重启触发」由调用方
     * 随后经 pushIsolateAndClear(REWIND_EXIT_SENTINEL) 的 isolate 哨兵承担。
     */
    clearPending(): void {
        const discardedLocalIds = this.queue
            .map(item => item.localId)
            .filter((l): l is string => Boolean(l));

        logger.debug(`[MessageQueue] clearPending() called. Clearing ${this.queue.length} messages`);
        this.queue = [];

        // 通知丢弃项已「离开队列」（agent 不会再处理它们）。同步标 in-flight，与
        // collectBatch/steal 语义一致：此窗口内不可取消（否则与「保留为 consumed」矛盾）
        if (discardedLocalIds.length > 0) {
            for (const id of discardedLocalIds) this.markInFlight(id);
            this.onBatchConsumedHandler?.(discardedLocalIds);
        }
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
     * 读取（不移除）指定 localId 的排队消息文本。用于 steal 前探测消息内容
     * （如 steer 前判断是否为特殊命令），避免 steal 后再 pushBack 丢失 isolate
     * 标志或被 collectBatch 重排序。不命中返回 null。
     */
    peekByLocalId(localId: string): { message: PromptPayload } | null {
        const item = this.queue.find(it => it.localId === localId);
        if (!item) return null;
        return { message: item.message };
    }

    /**
     * 取出并移除指定 localId 的排队消息，返回其内容与 mode。
     * 用于 steer：把仍排队的消息提前提交给 SDK input stream，避免 collectBatch 重复投递。
     * 不命中返回 null。
     */
    stealByLocalId(localId: string): { message: PromptPayload, mode: T } | null {
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
     * Wait for messages and return all messages with the same mode as a single payload
     * Returns { message: PromptPayload, mode: T, isolate: boolean, hash: string, localIds: string[] } or null if aborted/closed
     * （方法名保留历史 AsString 字样：payload 全程无图片时即 string，数组仅在图片场景出现）
     */
    async waitForMessagesAndGetAsString(abortSignal?: AbortSignal): Promise<{ message: PromptPayload, mode: T, isolate: boolean, hash: string, localIds: string[] } | null> {
        // If we have messages, return them immediately
        if (this.queue.length > 0) {
            await this.beforeCollectHandler?.();
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

        await this.beforeCollectHandler?.();
        return this.collectBatch();
    }

    /**
     * Collect a batch of messages with the same mode, respecting isolation requirements
     */
    private collectBatch(): { message: PromptPayload, mode: T, hash: string, isolate: boolean, localIds: string[] } | null {
        if (this.queue.length === 0) {
            return null;
        }

        const firstItem = this.queue[0];
        const sameModeMessages: PromptPayload[] = [];
        const consumedLocalIds: string[] = [];
        const mode = firstItem.mode;
        const isolate = firstItem.isolate ?? false;
        const targetModeHash = firstItem.modeHash;

        // If the first message requires isolation or no-merge, only process it alone
        if (firstItem.isolate || firstItem.noBatch) {
            const item = this.queue.shift()!;
            sameModeMessages.push(item.message);
            if (item.localId) {
                consumedLocalIds.push(item.localId);
            }
            logger.debug(`[MessageQueue] Collected isolated message with mode hash: ${targetModeHash}`);
        } else {
            // Collect all messages with the same mode until we hit an isolated or no-merge message
            while (this.queue.length > 0 &&
                this.queue[0].modeHash === targetModeHash &&
                !this.queue[0].isolate &&
                !this.queue[0].noBatch) {
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

        // 批量合并：string+string 等价历史 join('\n')；数组参与时元素级 concat（见 mergePayloads）
        const combinedMessage = sameModeMessages.reduce((acc, m) => mergePayloads(acc, m));

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
