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

import { describe, test, expect, beforeEach } from 'bun:test'
import { Database } from 'bun:sqlite'

import {
    addMessage,
    getMessages,
    markMessagesInvoked,
    getUninvokedLocalMessages,
    cancelQueuedMessage
} from '../../src/store/messages'

function makeDb() {
    const db = new Database(':memory:', { create: true, readwrite: true, strict: true })
    db.run(`CREATE TABLE messages (id TEXT PRIMARY KEY, session_id TEXT NOT NULL, content TEXT NOT NULL, created_at INTEGER NOT NULL, seq INTEGER NOT NULL, local_id TEXT, is_sidechain INTEGER DEFAULT 0, parent_tool_use_id TEXT, category TEXT DEFAULT 'persistent', invoked_at INTEGER)`)
    db.run(`CREATE INDEX idx_messages_session_position ON messages(session_id, COALESCE(invoked_at, created_at) DESC, seq DESC)`)
    return db
}

describe('byPosition + invokedAt', () => {
    let db: Database
    beforeEach(() => { db = makeDb() })

    test('user 消息（带 localId）invokedAt=null，agent 消息 invokedAt=createdAt', () => {
        addMessage(db, 's', { role: 'user' }, 'loc-1')
        addMessage(db, 's', { role: 'assistant' }, undefined)
        const uninvoked = getUninvokedLocalMessages(db, 's')
        expect(uninvoked.map(m => m.localId)).toEqual(['loc-1'])
    })

    test('markMessagesInvoked first-write-wins', () => {
        addMessage(db, 's', { role: 'user' }, 'loc-1')
        const r1 = markMessagesInvoked(db, 's', ['loc-1'], 100)
        const r2 = markMessagesInvoked(db, 's', ['loc-1'], 200)
        expect(r1).toEqual(['loc-1'])
        expect(r2).toEqual([])
        expect(getUninvokedLocalMessages(db, 's')).toEqual([])
    })

    test('低 seq + 晚 invoke 的消息出现在最新页（byPosition）', () => {
        addMessage(db, 's', { role: 'user' }, 'loc-1')     // seq1, invokedAt=null
        for (let i = 0; i < 4; i++) addMessage(db, 's', { role: 'assistant' }, undefined) // seq2..5
        markMessagesInvoked(db, 's', ['loc-1'], Date.now() + 100_000)  // 晚 invoke（比其他 created_at 大）
        const page = getMessages(db, 's', 3)               // 最新 3 条（oldest-first）
        // loc-1 晚 invoke，position 最高，排在页末（getMessages 按 oldest-first 返回）
        expect(page[page.length - 1].localId).toBe('loc-1')
    })

    test('cancelQueuedMessage：未 invoke 可删；已 invoke 不可删', () => {
        addMessage(db, 's', { role: 'user' }, 'loc-1')
        expect(cancelQueuedMessage(db, 's', 'loc-1')).toEqual({ cancelled: true, invoked: false })
        addMessage(db, 's', { role: 'user' }, 'loc-2')
        markMessagesInvoked(db, 's', ['loc-2'], 1)
        expect(cancelQueuedMessage(db, 's', 'loc-2')).toEqual({ cancelled: false, invoked: true })
    })
})
