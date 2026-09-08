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
    markMessagesPushed,
    getUnsubmittedLocalMessages,
    cancelQueuedMessage,
    getMessageSubmitState
} from '../../src/store/messages'

function makeDb() {
    const db = new Database(':memory:', { create: true, readwrite: true, strict: true })
    db.run(`CREATE TABLE messages (id TEXT PRIMARY KEY, session_id TEXT NOT NULL, content TEXT NOT NULL, created_at INTEGER NOT NULL, seq INTEGER NOT NULL, local_id TEXT, metadata TEXT, deleted_at INTEGER, is_sidechain INTEGER DEFAULT 0, parent_tool_use_id TEXT, category TEXT DEFAULT 'persistent', lifecycle TEXT, lifecycle_at INTEGER, position_at INTEGER NOT NULL)`)
    db.run(`CREATE INDEX idx_messages_session_position ON messages(session_id, position_at DESC, seq DESC)`)
    return db
}

/** 排队的 webapp 用户消息内容：denylist 下唯一进排队轨道的来源 */
const WEBAPP_USER = { role: 'user', content: { type: 'text' }, meta: { sentFrom: 'webapp' } }
/** CLI 回显（local-command-stdout 等）：永不排队 */
const CLI_ECHO = { role: 'user', content: { type: 'text', text: '<local-command-stdout>x</local-command-stdout>' }, meta: { sentFrom: 'cli' } }

describe('lifecycle + position_at', () => {
    let db: Database
    beforeEach(() => { db = makeDb() })

    test('webapp 用户消息 → lifecycle=queued；agent/CLI 消息 → NULL', () => {
        const web = addMessage(db, 's', WEBAPP_USER, 'loc-1')
        const agent = addMessage(db, 's', { role: 'assistant' }, undefined)
        const cli = addMessage(db, 's', CLI_ECHO, 'sdk-uuid')
        expect(web.lifecycle).toBe('queued')
        expect(web.lifecycleAt).toBe(web.createdAt)
        expect(agent.lifecycle).toBeNull()
        expect(agent.lifecycleAt).toBeNull()
        expect(cli.lifecycle).toBeNull() // CLI 回显永不排队
        expect(cli.lifecycleAt).toBeNull()
    })

    test('queued 消息 positionAt=createdAt；push 后跳到 push 时刻', () => {
        const web = addMessage(db, 's', WEBAPP_USER, 'loc-1')
        expect(web.positionAt).toBe(web.createdAt)
        const pushedAt = web.createdAt + 100_000
        markMessagesPushed(db, 's', ['loc-1'], pushedAt)
        const after = getMessages(db, 's', 10)[0]
        expect(after.lifecycle).toBe('pushed')
        expect(after.lifecycleAt).toBe(pushedAt)
        expect(after.positionAt).toBe(pushedAt) // 跳到 push 时刻（保留 turn 之后排序 UX）
    })

    test('markMessagesPushed：queued→pushed 单调，position_at 跳到 max(传入时刻, 时间线max+1)', () => {
        const t1 = Date.now() + 100_000 // 未来时刻：地板不触发，跳到传入时刻
        addMessage(db, 's', { role: 'user', content: { type: 'text', text: 'hi' }, meta: { sentFrom: 'webapp' } }, 'l1')
        expect(getUnsubmittedLocalMessages(db, 's')[0].lifecycle).toBe('queued')

        expect(markMessagesPushed(db, 's', ['l1'], t1)).toEqual({ localIds: ['l1'], positionAt: t1 })
        const after = getMessages(db, 's', 10)[0]
        expect(after.lifecycle).toBe('pushed')
        expect(after.lifecycleAt).toBe(t1)
        expect(after.positionAt).toBe(t1)
        // 二次 mark（first-write-wins）不再命中
        expect(markMessagesPushed(db, 's', ['l1'], t1 + 5)).toEqual({ localIds: [], positionAt: t1 + 5 })
    })

    test('cancelQueuedMessage：lifecycle=queued 可删，pushed 不可删', () => {
        addMessage(db, 's', { role: 'user', content: { type: 'text', text: 'q' }, meta: { sentFrom: 'webapp' } }, 'lq')
        addMessage(db, 's', { role: 'user', content: { type: 'text', text: 'p' }, meta: { sentFrom: 'webapp' } }, 'lp')
        markMessagesPushed(db, 's', ['lp'], 2000)
        expect(cancelQueuedMessage(db, 's', 'lq')).toEqual({ cancelled: true, submitted: false })
        expect(cancelQueuedMessage(db, 's', 'lp')).toEqual({ cancelled: false, submitted: true })
    })

    test('getUnsubmittedLocalMessages 仅返回 queued', () => {
        addMessage(db, 's', WEBAPP_USER, 'loc-1')
        addMessage(db, 's', { role: 'assistant' }, undefined)
        addMessage(db, 's', CLI_ECHO, 'sdk-uuid')
        expect(getUnsubmittedLocalMessages(db, 's').map(m => m.localId)).toEqual(['loc-1'])
    })

    test('markMessagesPushed first-write-wins（pushed 不二次跳变）', () => {
        const web = addMessage(db, 's', WEBAPP_USER, 'loc-1')
        // pushedAt=100 早于时间线 max（消息 created_at=now）→ 地板到 web.positionAt + 1
        const r1 = markMessagesPushed(db, 's', ['loc-1'], 100)
        const r2 = markMessagesPushed(db, 's', ['loc-1'], 200)
        expect(r1).toEqual({ localIds: ['loc-1'], positionAt: web.positionAt + 1 })
        expect(r2.localIds).toEqual([]) // 已 pushed，不再更新
        const after = getMessages(db, 's', 10)[0]
        expect(after.positionAt).toBe(web.positionAt + 1) // 不被 200 覆盖
        expect(getUnsubmittedLocalMessages(db, 's')).toEqual([])
    })

    test('低 seq + 晚 push 的消息出现在最新页（byPosition）', () => {
        addMessage(db, 's', WEBAPP_USER, 'loc-1')     // seq1, queued
        for (let i = 0; i < 4; i++) addMessage(db, 's', { role: 'assistant' }, undefined) // seq2..5
        markMessagesPushed(db, 's', ['loc-1'], Date.now() + 100_000) // 晚 push，position 跳到最大
        const page = getMessages(db, 's', 3)
        expect(page[page.length - 1].localId).toBe('loc-1') // position 最高，排页末
    })

    test('cancelQueuedMessage：不存在的 localId → cancelled:false submitted:false', () => {
        expect(cancelQueuedMessage(db, 's', 'never')).toEqual({ cancelled: false, submitted: false })
    })

    test('markMessagesPushed：position 地板——pushedAt 早于时间线 max 时跳到 max+1', () => {
        // 复刻线上竞态（session ed7937ae）：result 由 hub 落库（position_at = 落库时刻），
        // 排队消息的 pushed fact 携带 CLI 时钟时间戳，早于 hub 落库 result 的时刻（传输+处理延迟），
        // 同毫秒 tie 时 seq 决胜（排队消息 seq 是入队旧值）必排到 result 之前。
        // 地板语义：position_at 严格大于时间线当前 max，排序正确性收归 hub 单点，不依赖时钟域。
        const resultMsg = addMessage(db, 's', { role: 'agent' }, undefined) // result 行，position = 落库时刻
        addMessage(db, 's', WEBAPP_USER, 'loc-1') // 更早排队（position = 入队时刻）
        const staleFactAt = resultMsg.positionAt - 5 // CLI fact.at 早于 result 落库时刻
        const r = markMessagesPushed(db, 's', ['loc-1'], staleFactAt)
        expect(r.localIds).toEqual(['loc-1'])
        expect(r.positionAt).toBe(resultMsg.positionAt + 1)
        const page = getMessages(db, 's', 10)
        const after = page[page.length - 1] // 跳变后排到时间线末尾（result 之后）
        expect(after.localId).toBe('loc-1')
        expect(after.positionAt).toBe(resultMsg.positionAt + 1)
        // lifecycle_at 记录真实进入 pushed 时刻（pushedAt），只有 position_at 用地板修正值
        expect(after.lifecycleAt).toBe(staleFactAt)
    })

    test('markMessagesPushed：无候选返回空', () => {
        expect(markMessagesPushed(db, 's', [], 100)).toEqual({ localIds: [], positionAt: 100 })
        addMessage(db, 's', WEBAPP_USER, 'loc-1')
        markMessagesPushed(db, 's', ['loc-1'], 100)
        expect(markMessagesPushed(db, 's', ['loc-1'], 200)).toEqual({ localIds: [], positionAt: 200 })
    })

    test('markMessagesPushed：多条混合（部分已 pushed）只更新 queued 的', () => {
        addMessage(db, 's', WEBAPP_USER, 'loc-1')
        addMessage(db, 's', WEBAPP_USER, 'loc-2')
        addMessage(db, 's', WEBAPP_USER, 'loc-3')
        markMessagesPushed(db, 's', ['loc-2'], 100)
        const fresh = markMessagesPushed(db, 's', ['loc-1', 'loc-2', 'loc-3'], 200)
        expect(fresh.localIds.sort()).toEqual(['loc-1', 'loc-3'])
        expect(markMessagesPushed(db, 's', ['loc-1', 'loc-2', 'loc-3'], 300)).toEqual({ localIds: [], positionAt: 300 })
    })

    test('getMessages：beforeSeq 指向已删除行 → 返回空', () => {
        addMessage(db, 's', WEBAPP_USER, 'loc-1')
        addMessage(db, 's', { role: 'assistant' }, undefined) // seq=2
        cancelQueuedMessage(db, 's', 'loc-1') // 物理删除 loc-1(seq=1)
        expect(getMessages(db, 's', 50, 1)).toEqual([])
    })

    test('getMessageSubmitState：queued/pushed/不存在', () => {
        addMessage(db, 's', WEBAPP_USER, 'loc-q')
        addMessage(db, 's', { role: 'assistant' }, undefined)
        expect(getMessageSubmitState(db, 's', 'loc-q')).toEqual({ exists: true, submitted: false })
        markMessagesPushed(db, 's', ['loc-q'], 1234)
        expect(getMessageSubmitState(db, 's', 'loc-q')).toEqual({ exists: true, submitted: true })
        expect(getMessageSubmitState(db, 's', 'never')).toEqual({ exists: false, submitted: false })
    })

    test('重复 localId（resume 重放）：仍可排队则保留已推进状态，不再可排队则归 NULL', () => {
        const pushAt = Date.now() + 60_000 // 未来时刻：地板不触发，position 跳到传入时刻
        // 先排队 + push
        addMessage(db, 's', WEBAPP_USER, 'loc-1')
        markMessagesPushed(db, 's', ['loc-1'], pushAt)
        // resume 重放同 localId（webapp 内容）→ 保持 pushed，不回退为 queued
        const replayed = addMessage(db, 's', { role: 'user', content: { type: 'text', text: 'hi' }, meta: { sentFrom: 'webapp' } }, 'loc-1')
        expect(replayed.lifecycle).toBe('pushed')
        expect(replayed.positionAt).toBe(pushAt)
        expect(replayed.lifecycleAt).toBe(pushAt)

        // resume 重放为 CLI 回显 → 归入非排队轨道
        const asCli = addMessage(db, 's', CLI_ECHO, 'loc-1')
        expect(asCli.lifecycle).toBeNull()
    })

    test('重复 localId 退出排队轨道时清空 lifecycle_at（维持非排队消息 lifecycleAt=null 不变量）', () => {
        const pushAt = Date.now() + 60_000
        addMessage(db, 's', WEBAPP_USER, 'loc-1')
        markMessagesPushed(db, 's', ['loc-1'], pushAt)
        expect(getMessages(db, 's', 10)[0].lifecycleAt).toBe(pushAt)
        // 退出排队轨道 → lifecycle_at 必须清空，否则留下 lifecycle=NULL 但 lifecycle_at 非空的脏行
        const asCli = addMessage(db, 's', CLI_ECHO, 'loc-1')
        expect(asCli.lifecycle).toBeNull()
        expect(asCli.lifecycleAt).toBeNull()
    })
})
