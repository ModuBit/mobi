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

import type { MessageCategory } from '@mobi/shared'

import type { StoredMessage } from './types'
import { addMessage, getMessages, getMessagesAfter, getSidechainMessages, mergeSessionMessages } from './messages'

export class MessageStore {
    private readonly db: Database

    constructor(db: Database) {
        this.db = db
    }

    addMessage(sessionId: string, content: unknown, localId?: string | null, category: MessageCategory = 'persistent'): StoredMessage {
        return addMessage(this.db, sessionId, content, localId, category)
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
}
