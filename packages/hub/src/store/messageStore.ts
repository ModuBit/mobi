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

import type { Database } from 'bun:sqlite'

import type { MessageCategory, NativeMessageMetadata } from '@mobi/shared'

import type { StoredMessage } from './types'
import {
    addMessage,
    attachNativeSessionId,
    bindNativeIds,
    cancelQueuedMessage,
    getMessageSubmitState,
    getMessages,
    getMessagesAfter,
    getSidechainMessages,
    getUnsubmittedLocalMessages,
    markMessagesPushed,
    mergeSessionMessages,
    markMessagesAcked,
    advanceMessagesAcked,
    advanceMessagesLifecycle,
    getMessagesByIds,
    getMaxSeq,
    softDeleteMessagesFrom
} from './messages'

export class MessageStore {
    private readonly db: Database

    constructor(db: Database) {
        this.db = db
    }

    addMessage(sessionId: string, content: unknown, localId?: string | null, category: MessageCategory = 'persistent', metadata?: NativeMessageMetadata | null): StoredMessage {
        return addMessage(this.db, sessionId, content, localId, category, metadata)
    }

    /** 绑定用户消息的 native 锚点到 metadata（push 时上报）；只补空缺，幂等。返回补写后的行（供广播）。 */
    bindNativeIds(sessionId: string, bindings: { localId: string; metadata: { nativeId: string; nativeSessionId?: string } }[]): StoredMessage[] {
        return bindNativeIds(this.db, sessionId, bindings)
    }

    /** attach 补写：该会话所有缺 nativeSessionId 的行补上新 session id（幂等）。返回补写后的行。 */
    attachNativeSessionId(sessionId: string, nativeSessionId: string): StoredMessage[] {
        return attachNativeSessionId(this.db, sessionId, nativeSessionId)
    }

    /** 标记 CC 已接收（isReplay 回显）。按 native_id 生成列查询，first-write-wins。
     *  合并批 1:N 全部命中，返回全部更新后的行（供逐行广播）。 */
    markMessagesAcked(sessionId: string, nativeId: string, ackAt: number): StoredMessage[] {
        return markMessagesAcked(this.db, sessionId, nativeId, ackAt)
    }

    /** 软删除 fromSeq <= seq <= maxSeq（无上界则到尾）且未删的行（rewind 截断，幂等）。返回删除行数。 */
    softDeleteMessagesFrom(sessionId: string, fromSeq: number, maxSeq?: number): number {
        return softDeleteMessagesFrom(this.db, sessionId, fromSeq, maxSeq)
    }

    /** 会话当前最大 seq（无消息返回 0）——rewind 受理时点的软删除上界 */
    getMaxSeq(sessionId: string): number {
        return getMaxSeq(this.db, sessionId)
    }

    getMessages(sessionId: string, limit: number = 200, beforeSeq?: number, excludeSidechain: boolean = false): StoredMessage[] {
        return getMessages(this.db, sessionId, limit, beforeSeq, excludeSidechain)
    }

    getMessagesAfter(sessionId: string, afterSeq: number, limit: number = 200): StoredMessage[] {
        return getMessagesAfter(this.db, sessionId, afterSeq, limit)
    }

    getSidechainMessages(sessionId: string, parentToolUseId: string): StoredMessage[] {
        return getSidechainMessages(this.db, sessionId, parentToolUseId)
    }

    mergeSessionMessages(fromSessionId: string, toSessionId: string): { moved: number; oldMaxSeq: number; newMaxSeq: number } {
        return mergeSessionMessages(this.db, fromSessionId, toSessionId)
    }

    /** 把 localId 对应的 queued 消息推进为 pushed（lifecycle/lifecycle_at 落库 + position_at 跳变），返回实际更新的 localId 列表 */
    markMessagesPushed(sessionId: string, localIds: string[], pushedAt: number): string[] {
        return markMessagesPushed(this.db, sessionId, localIds, pushedAt)
    }

    /** 按 nativeId 把 pushed 消息推进为 acked（first-write-wins，单调性），返回实际推进的行 id。 */
    advanceMessagesAcked(sessionId: string, nativeId: string, ackedAt: number): string[] {
        return advanceMessagesAcked(this.db, sessionId, nativeId, ackedAt)
    }

    /** 按 nativeId 单调推进 lifecycle 至 command_lifecycle 终态（processing/done/cancelled/discarded），
     *  已处终态（含 withdrawn）不被覆盖、processing 不回退，返回实际推进的行 id。 */
    advanceMessagesLifecycle(
        sessionId: string,
        nativeId: string,
        state: 'processing' | 'done' | 'cancelled' | 'discarded',
        at: number
    ): string[] {
        return advanceMessagesLifecycle(this.db, sessionId, nativeId, state, at)
    }

    /** 按 id 集合回读行（advance* 返回 id，广播需完整行），按 seq 升序。 */
    getMessagesByIds(sessionId: string, ids: string[]): StoredMessage[] {
        return getMessagesByIds(this.db, sessionId, ids)
    }

    getUnsubmittedLocalMessages(sessionId: string): StoredMessage[] {
        return getUnsubmittedLocalMessages(this.db, sessionId)
    }

    cancelQueuedMessage(sessionId: string, localId: string): { cancelled: boolean; submitted: boolean } {
        return cancelQueuedMessage(this.db, sessionId, localId)
    }

    getMessageSubmitState(sessionId: string, localId: string): { exists: boolean, submitted: boolean } {
        return getMessageSubmitState(this.db, sessionId, localId)
    }
}
