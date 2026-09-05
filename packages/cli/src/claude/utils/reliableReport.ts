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
 * rewind 两段回报的可靠上报（M5，at-least-once + 服务端幂等）：
 * fire-and-forget 的 socket.emit 在断线窗口内会静默丢事件——CLI 已截断 transcript、
 * Hub 未软删除，永久分叉（幽灵消息）。本队列把回报改为 ack 确认制：
 *
 * - ack 成功 → 出队发下一条（单飞：同一时刻至多一条在途，保证 truncated 先于 completed 的顺序）
 * - ack 失败/超时 → 保留队首，定时重试；socket 重连 → 立即 flush
 * - 服务端幂等（hub 按 nativeId+deleteFromSeq 去重；completed 广播重放被 web 守卫吞），
 *   重发因此安全
 *
 * 残留（可接受）：进程崩溃在「截断完成 → 回报 ack 前」，内存队列随进程丢失；
 * 覆盖需落盘持久化，不值得。
 */

import { logger } from '@/ui/logger';

/** 待上报的 rewind 回报（event + body 与 hub socket handler 入参同构） */
export type PendingRewindReport =
    | { event: 'rewind-truncated'; body: { sid: string; nativeId: string; deleteFromSeq: number } }
    | { event: 'rewind-completed'; body: { sid: string; filesRestored: boolean; error?: string; skippedLinks?: number } };

/** socket.io client 的最小 ack 形状（便于单测替身） */
export interface AckSocket {
    /** socket 是否已连接（未连接时不发，等 onConnected） */
    readonly connected: boolean;
    /** 带超时的 ack emit：ack 回调首参非空 = 失败/超时 */
    emitAck(
        event: string,
        body: unknown,
        callback: (err: unknown, response?: unknown) => void,
    ): void;
}

/** ack 失败后的重试间隔 */
const RETRY_DELAY_MS = 5_000;

export class ReliableRewindReportQueue {
    private readonly socket: AckSocket;
    private readonly retryDelayMs: number;
    private pending: PendingRewindReport[] = [];
    private inFlight = false;
    private retryTimer: ReturnType<typeof setTimeout> | null = null;

    constructor(socket: AckSocket, retryDelayMs: number = RETRY_DELAY_MS) {
        this.socket = socket;
        this.retryDelayMs = retryDelayMs;
    }

    /** 入队并尝试上报（单飞保序：队首未 ack 前不动后续） */
    enqueue(report: PendingRewindReport): void {
        this.pending.push(report);
        this.flush();
    }

    /** socket（重）连后调用：立即补发未确认回报 */
    onConnected(): void {
        this.flush();
    }

    /** 队列长度（测试/诊断用） */
    get size(): number {
        return this.pending.length;
    }

    private flush(): void {
        if (this.inFlight || this.pending.length === 0 || !this.socket.connected) return
        const report = this.pending[0]!;
        this.inFlight = true
        this.socket.emitAck(report.event, report.body, (err) => {
            this.inFlight = false
            if (!err) {
                this.pending.shift()
                this.flush()
                return
            }
            logger.warn('[rewindReport] ack failed, will retry', report.event, err)
            this.scheduleRetry()
        })
    }

    private scheduleRetry(): void {
        if (this.retryTimer != null) return
        this.retryTimer = setTimeout(() => {
            this.retryTimer = null
            this.flush()
        }, this.retryDelayMs)
    }
}
