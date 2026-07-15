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
    markMessagesSubmitted,
    getUnsubmittedLocalMessages,
    cancelQueuedMessage,
    getMessageSubmitState
} from '../../src/store/messages'

function makeDb() {
    const db = new Database(':memory:', { create: true, readwrite: true, strict: true })
    db.run(`CREATE TABLE messages (id TEXT PRIMARY KEY, session_id TEXT NOT NULL, content TEXT NOT NULL, created_at INTEGER NOT NULL, seq INTEGER NOT NULL, local_id TEXT, is_sidechain INTEGER DEFAULT 0, parent_tool_use_id TEXT, category TEXT DEFAULT 'persistent', submitted_at INTEGER)`)
    db.run(`CREATE INDEX idx_messages_session_position ON messages(session_id, COALESCE(submitted_at, created_at) DESC, seq DESC)`)
    return db
}

describe('byPosition + submittedAt', () => {
    let db: Database
    beforeEach(() => { db = makeDb() })

    test('user 消息（带 localId）submittedAt=null，agent 消息 submittedAt=createdAt', () => {
        addMessage(db, 's', { role: 'user' }, 'loc-1')
        addMessage(db, 's', { role: 'assistant' }, undefined)
        const unsubmitted = getUnsubmittedLocalMessages(db, 's')
        expect(unsubmitted.map(m => m.localId)).toEqual(['loc-1'])
    })

    test('markMessagesSubmitted first-write-wins', () => {
        addMessage(db, 's', { role: 'user' }, 'loc-1')
        const r1 = markMessagesSubmitted(db, 's', ['loc-1'], 100)
        const r2 = markMessagesSubmitted(db, 's', ['loc-1'], 200)
        expect(r1).toEqual(['loc-1'])
        expect(r2).toEqual([])
        expect(getUnsubmittedLocalMessages(db, 's')).toEqual([])
    })

    test('低 seq + 晚 invoke 的消息出现在最新页（byPosition）', () => {
        addMessage(db, 's', { role: 'user' }, 'loc-1')     // seq1, submittedAt=null
        for (let i = 0; i < 4; i++) addMessage(db, 's', { role: 'assistant' }, undefined) // seq2..5
        markMessagesSubmitted(db, 's', ['loc-1'], Date.now() + 100_000)  // 晚 invoke（比其他 created_at 大）
        const page = getMessages(db, 's', 3)               // 最新 3 条（oldest-first）
        // loc-1 晚 invoke，position 最高，排在页末（getMessages 按 oldest-first 返回）
        expect(page[page.length - 1].localId).toBe('loc-1')
    })

    test('cancelQueuedMessage：未 invoke 可删；已 invoke 不可删', () => {
        addMessage(db, 's', { role: 'user' }, 'loc-1')
        expect(cancelQueuedMessage(db, 's', 'loc-1')).toEqual({ cancelled: true, submitted: false })
        addMessage(db, 's', { role: 'user' }, 'loc-2')
        markMessagesSubmitted(db, 's', ['loc-2'], 1)
        expect(cancelQueuedMessage(db, 's', 'loc-2')).toEqual({ cancelled: false, submitted: true })
    })

    test('cancelQueuedMessage：不存在的 localId 返回 cancelled:false submitted:false', () => {
        expect(cancelQueuedMessage(db, 's', 'never-exists')).toEqual({ cancelled: false, submitted: false })
    })

    test('markMessagesSubmitted：无候选返回空数组', () => {
        expect(markMessagesSubmitted(db, 's', [], 100)).toEqual([])
        addMessage(db, 's', { role: 'user' }, 'loc-1')
        markMessagesSubmitted(db, 's', ['loc-1'], 100)
        // 已 invoke → 无候选
        expect(markMessagesSubmitted(db, 's', ['loc-1'], 200)).toEqual([])
    })

    test('markMessagesSubmitted：多条 localId 混合（部分已 invoke）只更新未 invoke 的', () => {
        addMessage(db, 's', { role: 'user' }, 'loc-1')
        addMessage(db, 's', { role: 'user' }, 'loc-2')
        addMessage(db, 's', { role: 'user' }, 'loc-3')
        // 先 invoke loc-2
        markMessagesSubmitted(db, 's', ['loc-2'], 100)
        // 批量 invoke 时 loc-1 和 loc-3 还没 invoke
        const fresh = markMessagesSubmitted(db, 's', ['loc-1', 'loc-2', 'loc-3'], 200)
        expect(fresh.sort()).toEqual(['loc-1', 'loc-3'])
        // 再次调用全空
        expect(markMessagesSubmitted(db, 's', ['loc-1', 'loc-2', 'loc-3'], 300)).toEqual([])
    })

    test('getMessages：beforeSeq 指向已删除行 → 返回空（防退回最新页造成重复）', () => {
        // loc-1 是 seq=1 的排队 user 消息
        addMessage(db, 's', { role: 'user' }, 'loc-1')
        addMessage(db, 's', { role: 'assistant' }, undefined) // seq=2
        // 取消 loc-1 → 物理删除
        cancelQueuedMessage(db, 's', 'loc-1')
        // 用 loc-1 的 seq=1 作游标翻页：行已不存在，必须返回 [] 而非退回最新页
        expect(getMessages(db, 's', 50, 1)).toEqual([])
    })

    test('getMessageSubmitState：未提交/已提交/不存在三种状态', () => {
        addMessage(db, 's', { role: 'user' }, 'loc-q') // 排队，submitted_at=null
        addMessage(db, 's', { role: 'assistant' }, undefined) // 立即定位
        // 未提交
        expect(getMessageSubmitState(db, 's', 'loc-q')).toEqual({ exists: true, submitted: false })
        // 提交后
        markMessagesSubmitted(db, 's', ['loc-q'], 1234)
        expect(getMessageSubmitState(db, 's', 'loc-q')).toEqual({ exists: true, submitted: true })
        // 不存在
        expect(getMessageSubmitState(db, 's', 'never')).toEqual({ exists: false, submitted: false })
    })
})
