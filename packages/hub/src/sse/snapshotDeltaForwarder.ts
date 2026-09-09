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
import type { SnapshotDeltaAssembler } from '../sync/snapshotDeltaAssembler'

type MessageSnapshotDeltaEvent = Extract<SyncEvent, { type: 'message-snapshot-delta' }>

/** 订阅的 delta 能力与进度上下文（SSEManager 广播时传入） */
export type ForwarderConnection = {
    id: string
    wantsDelta: boolean
}

/**
 * snapshot delta 的 SSE 订阅转发器（.scratch/snapshot-delta 票 02）。
 *
 * hub→web 段按订阅者进度转发：游标衔接且协商了 delta → 原样转发增量帧；
 * 否则（新订阅/重连/追赶/老 web）→ 从拼接器缓存构造全量 message-snapshot 追赶。
 * 全量内容返回缓存共享引用（订阅端 send 即时序列化，无拷贝——与拼接器同款纪律）。
 */
export class SnapshotDeltaForwarder {
    /** 订阅 id → localId → 已发送 rev */
    private readonly sentRev = new Map<string, Map<string, number>>()

    constructor(private readonly assembler: SnapshotDeltaAssembler) {}

    /**
     * SSEManager.broadcast 对 message-snapshot-delta 事件逐订阅调用。
     * @returns 实际下发的事件（delta 原样或全量追赶）；null = 不下发（缓存缺失等）
     */
    resolve(event: MessageSnapshotDeltaEvent, connection: ForwarderConnection): SyncEvent | null {
        const caughtUp = connection.wantsDelta
            && this.sentRev.get(connection.id)?.get(event.localId) === event.baseRev

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
            message: {
                id: event.localId,
                seq: null,
                localId: event.localId,
                snapshot: true,
                snapshotRev: cached.rev,
                content: cached.content,
                createdAt: Date.now(),
            },
        }
    }

    /** message-snapshot 全量事件下发后标记游标（衔接该订阅后续 delta）。rev=null（legacy）不建链 */
    markFullSent(subscriptionId: string, localId: string | null, rev: number | null | undefined): void {
        if (localId === null || rev === null || rev === undefined) return
        this.markRev(subscriptionId, localId, rev)
    }

    /** 订阅断开：清游标（重连后必然全量起步，重基线规则） */
    onUnsubscribe(subscriptionId: string): void {
        this.sentRev.delete(subscriptionId)
    }

    /** resync：清该订阅全部游标（web 打开会话时调用，下一 delta 触发全量追赶） */
    resetSubscription(subscriptionId: string): void {
        this.sentRev.delete(subscriptionId)
    }

    private markRev(subscriptionId: string, localId: string, rev: number): void {
        let entryMap = this.sentRev.get(subscriptionId)
        if (!entryMap) {
            entryMap = new Map()
            this.sentRev.set(subscriptionId, entryMap)
        }
        entryMap.set(localId, rev)
    }
}
