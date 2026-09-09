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

import type { SyncEvent } from '@mobi/shared/types'
import { buildSnapshotMessage } from '@mobi/shared'
import type { SnapshotDeltaAssembler } from '../sync/snapshotDeltaAssembler'

type MessageSnapshotDeltaEvent = Extract<SyncEvent, { type: 'message-snapshot-delta' }>

/** 订阅的 delta 能力与进度上下文（SSEManager 广播时传入） */
export type ForwarderConnection = {
    id: string
    wantsDelta: boolean
}

/** 游标条目：已发送 rev + 最后更新时刻（TTL 过期防泄漏） */
type CursorEntry = { rev: number; at: number }

/**
 * snapshot delta 的 SSE 订阅转发器（.scratch/snapshot-delta 票 02）。
 *
 * hub→web 段按订阅者进度转发：游标衔接且协商了 delta → 原样转发增量帧；
 * 否则（新订阅/重连/追赶/老 web）→ 从拼接器缓存构造全量 message-snapshot 追赶。
 * 全量内容返回缓存共享引用（订阅端 send 即时序列化，无拷贝——与拼接器同款纪律）。
 *
 * 游标生命周期（防无界增长）：消息终态（snapshot-stream-end）经 dropMessage 精确清理；
 * 信号丢失时由 TTL 兜底（条目过期视为无游标 → 全量追赶，语义安全）。
 */
export class SnapshotDeltaForwarder {
    /** 订阅 id → localId → 游标 */
    private readonly sentRev = new Map<string, Map<string, CursorEntry>>()
    private readonly ttlMs: number
    private readonly now: () => number

    constructor(
        private readonly assembler: SnapshotDeltaAssembler,
        options?: { ttlMs?: number; now?: () => number },
    ) {
        this.ttlMs = options?.ttlMs ?? 10 * 60_000
        this.now = options?.now ?? (() => Date.now())
    }

    /**
     * SSEManager.broadcast 对 message-snapshot-delta 事件逐订阅调用。
     * @returns 实际下发的事件（delta 原样或全量追赶）；null = 不下发（缓存缺失等）
     */
    resolve(event: MessageSnapshotDeltaEvent, connection: ForwarderConnection): SyncEvent | null {
        const caughtUp = connection.wantsDelta
            && this.lookup(connection.id, event.localId) === event.baseRev

        if (caughtUp) {
            this.markRev(connection.id, event.localId, event.rev)
            return event
        }

        // 全量追赶：内容来自拼接器缓存（apply 已由 CLI 帧入端完成，rev 同步推进）
        const cached = this.assembler.getContent(event.sessionId, event.localId)
        if (!cached || cached.rev === null) {
            // 缓存缺失（断档被删/已清理/legacy 无链）——无内容可发，丢弃等下个全量基线
            return null
        }
        this.markRev(connection.id, event.localId, cached.rev)
        return {
            type: 'message-snapshot',
            sessionId: event.sessionId,
            namespace: event.namespace,
            message: buildSnapshotMessage(event.localId, cached.content, cached.rev),
        }
    }

    /**
     * message-snapshot 全量事件下发后标记游标（衔接该订阅后续 delta）。
     * 仅对协商 delta 的连接有意义（老 web 恒收全量，游标无人读，徒增泄漏）。rev 无值不建链。
     */
    markFullSent(subscriptionId: string, localId: string | null, rev: number | null | undefined): void {
        if (localId === null || rev == null) return
        this.markRev(subscriptionId, localId, rev)
    }

    /** 消息终态（snapshot-stream-end）：删该 localId 的全部订阅游标（精确防泄漏主路径） */
    dropMessage(localId: string): void {
        for (const entryMap of this.sentRev.values()) {
            entryMap.delete(localId)
        }
    }

    /**
     * 重置该订阅全部游标。两个触发条件共用同一语义（游标清空 → 下一 delta 触发全量追赶，
     * 重基线规则）：订阅断开（重连后必然全量起步）/ resync 端点（web 打开会话时主动补基线）。
     */
    resetSubscription(subscriptionId: string): void {
        this.sentRev.delete(subscriptionId)
    }

    /** 读游标（TTL 过期视为无游标并清除——信号丢失的兜底清理） */
    private lookup(subscriptionId: string, localId: string): number | undefined {
        const entryMap = this.sentRev.get(subscriptionId)
        const entry = entryMap?.get(localId)
        if (!entry) return undefined
        if (this.now() - entry.at > this.ttlMs) {
            entryMap!.delete(localId)
            return undefined
        }
        return entry.rev
    }

    private markRev(subscriptionId: string, localId: string, rev: number): void {
        let entryMap = this.sentRev.get(subscriptionId)
        if (!entryMap) {
            entryMap = new Map()
            this.sentRev.set(subscriptionId, entryMap)
        }
        entryMap.set(localId, { rev, at: this.now() })
    }
}
