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
    markMessagesSubmitted,
    mergeSessionMessages,
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

    /** 绑定用户消息的 native 锚点到 metadata（push 时上报）；只补空缺，幂等。返回实际绑定的 localId。 */
    bindNativeIds(sessionId: string, bindings: { localId: string; metadata: { nativeId: string; nativeSessionId?: string } }[]): string[] {
        return bindNativeIds(this.db, sessionId, bindings)
    }

    /** attach 补写：该会话所有缺 nativeSessionId 的行补上新 session id（幂等）。返回补写后的行。 */
    attachNativeSessionId(sessionId: string, nativeSessionId: string): StoredMessage[] {
        return attachNativeSessionId(this.db, sessionId, nativeSessionId)
    }

    /** 软删除 seq >= fromSeq 且未删的行（rewind 截断，幂等）。返回删除行数。 */
    softDeleteMessagesFrom(sessionId: string, fromSeq: number): number {
        return softDeleteMessagesFrom(this.db, sessionId, fromSeq)
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

    markMessagesSubmitted(sessionId: string, localIds: string[], submittedAt: number): string[] {
        return markMessagesSubmitted(this.db, sessionId, localIds, submittedAt)
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
