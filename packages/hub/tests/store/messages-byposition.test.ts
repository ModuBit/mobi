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
    db.run(`CREATE TABLE messages (id TEXT PRIMARY KEY, session_id TEXT NOT NULL, content TEXT NOT NULL, created_at INTEGER NOT NULL, seq INTEGER NOT NULL, local_id TEXT, native_id TEXT, is_sidechain INTEGER DEFAULT 0, parent_tool_use_id TEXT, category TEXT DEFAULT 'persistent', submitted_at INTEGER, queue_state TEXT, position_at INTEGER NOT NULL)`)
    db.run(`CREATE INDEX idx_messages_session_position ON messages(session_id, position_at DESC, seq DESC)`)
    return db
}

/** 排队的 webapp 用户消息内容：denylist 下唯一进排队轨道的来源 */
const WEBAPP_USER = { role: 'user', content: { type: 'text' }, meta: { sentFrom: 'webapp' } }
/** CLI 回显（local-command-stdout 等）：永不排队 */
const CLI_ECHO = { role: 'user', content: { type: 'text', text: '<local-command-stdout>x</local-command-stdout>' }, meta: { sentFrom: 'cli' } }

describe('queue_state + position_at', () => {
    let db: Database
    beforeEach(() => { db = makeDb() })

    test('webapp 用户消息 → queue_state=pending；agent/CLI 消息 → NULL', () => {
        const web = addMessage(db, 's', WEBAPP_USER, 'loc-1')
        const agent = addMessage(db, 's', { role: 'assistant' }, undefined)
        const cli = addMessage(db, 's', CLI_ECHO, 'sdk-uuid')
        expect(web.queueState).toBe('pending')
        expect(web.submittedAt).toBeNull()
        expect(agent.queueState).toBeNull()
        expect(cli.queueState).toBeNull() // CLI 回显永不排队
    })

    test('pending 消息 positionAt=createdAt；消费后跳到消费时刻', () => {
        const web = addMessage(db, 's', WEBAPP_USER, 'loc-1')
        expect(web.positionAt).toBe(web.createdAt)
        const consumedAt = web.createdAt + 100_000
        markMessagesSubmitted(db, 's', ['loc-1'], consumedAt)
        const after = getMessages(db, 's', 10)[0]
        expect(after.queueState).toBe('consumed')
        expect(after.submittedAt).toBe(consumedAt)
        expect(after.positionAt).toBe(consumedAt) // 跳到消费时刻（保留 turn 之后排序 UX）
    })

    test('getUnsubmittedLocalMessages 仅返回 pending', () => {
        addMessage(db, 's', WEBAPP_USER, 'loc-1')
        addMessage(db, 's', { role: 'assistant' }, undefined)
        addMessage(db, 's', CLI_ECHO, 'sdk-uuid')
        expect(getUnsubmittedLocalMessages(db, 's').map(m => m.localId)).toEqual(['loc-1'])
    })

    test('markMessagesSubmitted first-write-wins（consumed 不二次跳变）', () => {
        addMessage(db, 's', WEBAPP_USER, 'loc-1')
        const r1 = markMessagesSubmitted(db, 's', ['loc-1'], 100)
        const r2 = markMessagesSubmitted(db, 's', ['loc-1'], 200)
        expect(r1).toEqual(['loc-1'])
        expect(r2).toEqual([]) // 已 consumed，不再更新
        const after = getMessages(db, 's', 10)[0]
        expect(after.positionAt).toBe(100) // 不被 200 覆盖
        expect(getUnsubmittedLocalMessages(db, 's')).toEqual([])
    })

    test('低 seq + 晚消费的消息出现在最新页（byPosition）', () => {
        addMessage(db, 's', WEBAPP_USER, 'loc-1')     // seq1, pending
        for (let i = 0; i < 4; i++) addMessage(db, 's', { role: 'assistant' }, undefined) // seq2..5
        markMessagesSubmitted(db, 's', ['loc-1'], Date.now() + 100_000) // 晚消费，position 跳到最大
        const page = getMessages(db, 's', 3)
        expect(page[page.length - 1].localId).toBe('loc-1') // position 最高，排页末
    })

    test('cancelQueuedMessage：pending 可删；consumed 不可删', () => {
        addMessage(db, 's', WEBAPP_USER, 'loc-1')
        expect(cancelQueuedMessage(db, 's', 'loc-1')).toEqual({ cancelled: true, submitted: false })
        addMessage(db, 's', WEBAPP_USER, 'loc-2')
        markMessagesSubmitted(db, 's', ['loc-2'], 1)
        expect(cancelQueuedMessage(db, 's', 'loc-2')).toEqual({ cancelled: false, submitted: true })
    })

    test('cancelQueuedMessage：不存在的 localId → cancelled:false submitted:false', () => {
        expect(cancelQueuedMessage(db, 's', 'never')).toEqual({ cancelled: false, submitted: false })
    })

    test('markMessagesSubmitted：无候选返回空', () => {
        expect(markMessagesSubmitted(db, 's', [], 100)).toEqual([])
        addMessage(db, 's', WEBAPP_USER, 'loc-1')
        markMessagesSubmitted(db, 's', ['loc-1'], 100)
        expect(markMessagesSubmitted(db, 's', ['loc-1'], 200)).toEqual([])
    })

    test('markMessagesSubmitted：多条混合（部分已 consumed）只更新 pending 的', () => {
        addMessage(db, 's', WEBAPP_USER, 'loc-1')
        addMessage(db, 's', WEBAPP_USER, 'loc-2')
        addMessage(db, 's', WEBAPP_USER, 'loc-3')
        markMessagesSubmitted(db, 's', ['loc-2'], 100)
        const fresh = markMessagesSubmitted(db, 's', ['loc-1', 'loc-2', 'loc-3'], 200)
        expect(fresh.sort()).toEqual(['loc-1', 'loc-3'])
        expect(markMessagesSubmitted(db, 's', ['loc-1', 'loc-2', 'loc-3'], 300)).toEqual([])
    })

    test('getMessages：beforeSeq 指向已删除行 → 返回空', () => {
        addMessage(db, 's', WEBAPP_USER, 'loc-1')
        addMessage(db, 's', { role: 'assistant' }, undefined) // seq=2
        cancelQueuedMessage(db, 's', 'loc-1') // 物理删除 loc-1(seq=1)
        expect(getMessages(db, 's', 50, 1)).toEqual([])
    })

    test('getMessageSubmitState：pending/consumed/不存在', () => {
        addMessage(db, 's', WEBAPP_USER, 'loc-q')
        addMessage(db, 's', { role: 'assistant' }, undefined)
        expect(getMessageSubmitState(db, 's', 'loc-q')).toEqual({ exists: true, submitted: false })
        markMessagesSubmitted(db, 's', ['loc-q'], 1234)
        expect(getMessageSubmitState(db, 's', 'loc-q')).toEqual({ exists: true, submitted: true })
        expect(getMessageSubmitState(db, 's', 'never')).toEqual({ exists: false, submitted: false })
    })

    test('重复 localId（resume 重放）：仍可排队则保留 consumed 状态，不再可排队则归 NULL', () => {
        // 先排队 + 消费
        addMessage(db, 's', WEBAPP_USER, 'loc-1')
        markMessagesSubmitted(db, 's', ['loc-1'], 500)
        // resume 重放同 localId（webapp 内容）→ 保持 consumed，不回退为 pending
        const replayed = addMessage(db, 's', { role: 'user', content: { type: 'text', text: 'hi' }, meta: { sentFrom: 'webapp' } }, 'loc-1')
        expect(replayed.queueState).toBe('consumed')
        expect(replayed.positionAt).toBe(500)

        // resume 重放为 CLI 回显 → 归入非排队轨道
        const asCli = addMessage(db, 's', CLI_ECHO, 'loc-1')
        expect(asCli.queueState).toBeNull()
    })

    test('重复 localId 退出排队轨道时清空 submitted_at（维持非排队消息 submittedAt=null 不变量）', () => {
        addMessage(db, 's', WEBAPP_USER, 'loc-1')
        markMessagesSubmitted(db, 's', ['loc-1'], 500)
        expect(getMessages(db, 's', 10)[0].submittedAt).toBe(500)
        // 退出排队轨道 → submitted_at 必须清空，否则留下 queue_state=NULL 但 submitted_at 非空的脏行
        const asCli = addMessage(db, 's', CLI_ECHO, 'loc-1')
        expect(asCli.queueState).toBeNull()
        expect(asCli.submittedAt).toBeNull()
    })
})
