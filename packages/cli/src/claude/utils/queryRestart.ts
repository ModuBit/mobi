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

import type { RpcAcceptResult } from '@mobi/shared'
import { MessageQueue } from '@/utils/MessageQueue'
import type { EnhancedMode, PendingRewind } from '../types'

/**
 * 重启请求单槽（深化候选④）：rewind 截断重启与 output style /clear 重启共用同一套
 * 「受理检查 → 状态位置位 → 清排队 → 哨兵入队 → launcher 门控退轮 → 循环顶层分派」机制，
 * 此前两套状态位互不知晓，互斥靠 rewindBusy 特判，互吞 bug 由 be966df0 / ecef7061
 * 两次补丁修复——单槽置位即互斥，整类 bug 失去存在土壤。
 */

/**
 * 重启退出哨兵：入队 isolate 队列唤醒阻塞中的 nextMessage，launcher 识别后按
 * restart module 的配对状态门控放行退轮。NUL 前缀防与用户消息文本碰撞（ecef7061）。
 * 只在 CLI 内存队列流转，不跨进程；旧的双哨兵（rewind-exit / output-style-exit）随单槽合并。
 */
export const RESTART_EXIT_SENTINEL = '\x00mobi:restart-exit'

/** 待执行的重启请求（受理侧写、launcher while 循环顶层消费并按 kind 分派） */
export type QueryRestartRequest =
    // rewind：保留 sessionId，以 resumeSessionAt 截断重启（字段语义见 PendingRewind）
    | Readonly<{ kind: 'rewind' } & PendingRewind>
    // output style：已 setOutputStyle + 清 sessionId，重启后新 style 生效（/clear 语义）
    | Readonly<{ kind: 'outputStyle' }>

export type QueryRestartPreparation =
    | { ready: true; request: QueryRestartRequest }
    | { ready: false; reason: string }

/**
 * Query 重启协调 module：拥有重启单槽、异步准备占位以及「请求状态 + 退出哨兵」配对。
 * 调用方只提交重启意图，不再直接改 pending/inFlight，也无需知道 MessageQueue 清理顺序。
 *
 * `tryPrepare` 在执行异步准备函数前同步占位，用于 rewind 文件恢复窗口；`trySchedule`
 * 用于不含 await 的 output style 切换。两条路径最终都经 commit 同步完成：先公开请求，
 * 再清排队并注入哨兵，保证 launcher 被唤醒时一定能读到配对状态。
 */
export class QueryRestartController {
    private pending: QueryRestartRequest | null = null
    private preparing = false

    constructor(private readonly queue: MessageQueue<EnhancedMode>) {}

    /** pending 或异步准备任一存在即忙；受理入口据此互斥。 */
    get busy(): boolean {
        return this.pending !== null || this.preparing
    }

    /** 当前待执行请求的只读快照；null 表示重启通道空闲。 */
    current(): QueryRestartRequest | null {
        return this.pending
    }

    /**
     * 同步提交重启请求。`onAccepted` 只在成功占用通道后执行，适合放置清 native id、
     * 更新 output style 等与该请求绑定的同步副作用；回调抛错时不提交请求。
     */
    trySchedule(request: QueryRestartRequest, onAccepted: () => void = () => {}): boolean {
        if (this.busy) return false

        // 先占位再执行回调，挡住回调内同步重入覆盖同一个单槽。
        this.preparing = true
        try {
            onAccepted()
            this.commit(request)
            return true
        } finally {
            this.preparing = false
        }
    }

    /**
     * 带异步准备阶段的提交。进入 prepare 前同步占位，prepare 返回拒绝或抛错时自动释放；
     * 返回 ready 时由 module 提交请求，调用方不接触中间状态。
     * `null` 表示调用开始时通道已经被另一请求占用。
     */
    async tryPrepare(
        prepare: () => Promise<QueryRestartPreparation>,
    ): Promise<RpcAcceptResult | null> {
        if (this.busy) return null

        this.preparing = true
        try {
            const prepared = await prepare()
            if (!prepared.ready) {
                return { accepted: false, reason: prepared.reason }
            }
            this.commit(prepared.request)
            return { accepted: true }
        } finally {
            this.preparing = false
        }
    }

    /**
     * launcher 收到退出哨兵时消费配对状态：outputStyle 到此即完成、立即清槽；
     * rewind 必须保留到下一轮截断成功/失败后再 complete。null = 无配对状态的 stale 哨兵。
     */
    consumeExitSignal(): QueryRestartRequest | null {
        const request = this.pending
        if (request?.kind === 'outputStyle') {
            this.pending = null
        }
        return request
    }

    /** 仅完成仍为当前对象的请求，防旧轮次的迟到回调清掉后来的请求。 */
    complete(request: QueryRestartRequest): boolean {
        if (this.pending !== request) return false
        this.pending = null
        return true
    }

    private commit(request: QueryRestartRequest): void {
        this.pending = request
        // 保留原有丢弃通知语义：clearPending 通知 Hub 后，隔离哨兵单独入队唤醒 launcher。
        this.queue.clearPending()
        this.queue.pushIsolateAndClear(RESTART_EXIT_SENTINEL, { permissionMode: 'default' })
    }
}
