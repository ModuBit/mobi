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

import { Store } from '../../src/store'
import { addMessage, bindNativeIds, getMessages, markMessagesAcked } from '../../src/store/messages'

/** 建一个带 metadata/deleted_at 列的最小 messages 表（无 FK/无 sessions，纯模块级函数测试，参照 messages-byposition.test.ts） */
function makeDb(): Database {
    const db = new Database(':memory:', { create: true, readwrite: true, strict: true })
    db.run(`CREATE TABLE messages (id TEXT PRIMARY KEY, session_id TEXT NOT NULL, content TEXT NOT NULL, created_at INTEGER NOT NULL, seq INTEGER NOT NULL, local_id TEXT, metadata TEXT, deleted_at INTEGER, is_sidechain INTEGER DEFAULT 0, parent_tool_use_id TEXT, category TEXT DEFAULT 'persistent', submitted_at INTEGER, queue_state TEXT, position_at INTEGER NOT NULL)`)
    return db
}

/** webapp 用户消息内容（排队轨道来源；metadata 断言不依赖排队语义，仅保持真实信封） */
const WEBAPP_USER = { role: 'user', content: { type: 'text', text: 'hi' }, meta: { sentFrom: 'webapp' } }

describe('addMessage metadata', () => {
    let db: Database
    beforeEach(() => { db = makeDb() })

    test('插入时写入 metadata 列', () => {
        const msg = addMessage(db, 's1', WEBAPP_USER, 'local-1', 'persistent', { nativeId: 'uu-1' })
        expect(msg.metadata?.nativeId).toBe('uu-1')
        expect(getMessages(db, 's1')[0].metadata?.nativeId).toBe('uu-1')
    })

    test('metadata 缺省为 null', () => {
        const msg = addMessage(db, 's1', WEBAPP_USER, 'local-2')
        expect(msg.metadata).toBeNull()
    })

    test('相同 localId 重复插入：nativeId 首写保留', () => {
        addMessage(db, 's1', WEBAPP_USER, 'local-3', 'persistent', { nativeId: 'uu-3' })
        const again = addMessage(db, 's1', WEBAPP_USER, 'local-3')
        expect(again.metadata?.nativeId).toBe('uu-3')
    })

    test('相同 localId 重复插入且带不同 nativeId：首写值仍保留（first-write-wins）', () => {
        addMessage(db, 's1', WEBAPP_USER, 'local-x', 'persistent', { nativeId: 'uu-first' })
        const again = addMessage(db, 's1', WEBAPP_USER, 'local-x', 'persistent', { nativeId: 'uu-second' })
        expect(again.metadata?.nativeId).toBe('uu-first')
        expect(getMessages(db, 's1')[0].metadata?.nativeId).toBe('uu-first')
    })

    test('重放更新只补空缺：已有 nativeId 保留、nativeSessionId 补入', () => {
        addMessage(db, 's1', WEBAPP_USER, 'local-y', 'persistent', { nativeId: 'uu-y' })
        const again = addMessage(db, 's1', WEBAPP_USER, 'local-y', 'persistent', { nativeSessionId: 'ns-y' })
        expect(again.metadata).toEqual({ nativeId: 'uu-y', nativeSessionId: 'ns-y' })
    })
})

describe('bindNativeIds（metadata 形态）', () => {
    let db: Database
    beforeEach(() => { db = makeDb() })

    test('绑定空缺行并返回补写后的行', () => {
        addMessage(db, 's1', WEBAPP_USER, 'local-a')
        addMessage(db, 's1', WEBAPP_USER, 'local-b')
        const bound = bindNativeIds(db, 's1', [
            { localId: 'local-a', metadata: { nativeId: 'uu-a' } },
            { localId: 'local-b', metadata: { nativeId: 'uu-a' } },
        ])
        expect(bound.map(m => m.localId)).toEqual(['local-a', 'local-b'])
        expect(bound.every(m => m.metadata?.nativeId === 'uu-a')).toBe(true)
        const rows = getMessages(db, 's1')
        expect(rows.find(r => r.localId === 'local-a')!.metadata?.nativeId).toBe('uu-a')
        expect(rows.find(r => r.localId === 'local-b')!.metadata?.nativeId).toBe('uu-a')
    })

    test('幂等：已绑定的行不覆盖、不重复计入', () => {
        addMessage(db, 's1', WEBAPP_USER, 'local-c')
        bindNativeIds(db, 's1', [{ localId: 'local-c', metadata: { nativeId: 'uu-1' } }])
        const second = bindNativeIds(db, 's1', [{ localId: 'local-c', metadata: { nativeId: 'uu-2' } }])
        expect(second).toEqual([])
        expect(getMessages(db, 's1')[0].metadata?.nativeId).toBe('uu-1')
    })

    test('绑定带 nativeSessionId：写入且行内已有 session 保留', () => {
        addMessage(db, 's1', WEBAPP_USER, 'local-d', 'persistent', { nativeSessionId: 'ns-old' })
        bindNativeIds(db, 's1', [{ localId: 'local-d', metadata: { nativeId: 'uu-d', nativeSessionId: 'ns-new' } }])
        expect(getMessages(db, 's1')[0].metadata).toEqual({ nativeId: 'uu-d', nativeSessionId: 'ns-old' })
    })

    test('行不存在 → 跳过不报错', () => {
        const bound = bindNativeIds(db, 's1', [{ localId: 'ghost', metadata: { nativeId: 'uu-x' } }])
        expect(bound).toEqual([])
    })

    test('空绑定列表 → 返回空', () => {
        expect(bindNativeIds(db, 's1', [])).toEqual([])
    })
})

describe('MessageStore 类（Store 全链路）', () => {
    let store: Store
    let sessionId: string

    beforeEach(() => {
        store = new Store(':memory:')
        const session = store.sessions.getOrCreateSession('native-id-test', null, null, 'default')
        sessionId = session.id
    })

    test('addMessage 经 MessageStore 透传 metadata', () => {
        const msg = store.messages.addMessage(sessionId, WEBAPP_USER, 'local-d', 'persistent', { nativeId: 'uu-d' })
        expect(msg.metadata?.nativeId).toBe('uu-d')
        expect(store.messages.getMessages(sessionId)[0].metadata?.nativeId).toBe('uu-d')
    })

    test('MessageStore 类暴露 bindNativeIds', () => {
        store.messages.addMessage(sessionId, WEBAPP_USER, 'local-e')
        const bound = store.messages.bindNativeIds(sessionId, [{ localId: 'local-e', metadata: { nativeId: 'uu-e' } }])
        expect(bound.map(m => m.localId)).toEqual(['local-e'])
        expect(store.messages.getMessages(sessionId)[0].metadata?.nativeId).toBe('uu-e')
    })
})

describe('markMessagesAcked（isReplay 回显 → nativeAckAt）', () => {
    let store: Store
    let sessionId: string

    beforeEach(() => {
        store = new Store(':memory:')
        sessionId = store.sessions.getOrCreateSession('ack-test', null, null, 'default').id
    })

    test('首次 ack 写 nativeAckAt 并按 native_id 生成列命中返回行', () => {
        store.messages.addMessage(sessionId, WEBAPP_USER, 'local-1', 'persistent', { nativeId: 'uu-1' })
        const acked = store.messages.markMessagesAcked(sessionId, 'uu-1', 1755500000000)
        expect(acked).not.toBeNull()
        expect(acked!.metadata?.nativeAckAt).toBe(1755500000000)
        // 落库生效（nativeId/nativeSessionId 同族保留，nativeAckAt 追加）
        const row = store.messages.getMessages(sessionId)[0]
        expect(row.metadata).toEqual({ nativeId: 'uu-1', nativeAckAt: 1755500000000 })
    })

    test('重复 ack → first-write-wins 不覆盖，返回 null', () => {
        store.messages.addMessage(sessionId, WEBAPP_USER, 'local-1', 'persistent', { nativeId: 'uu-1' })
        store.messages.markMessagesAcked(sessionId, 'uu-1', 111)
        const again = store.messages.markMessagesAcked(sessionId, 'uu-1', 222)
        expect(again).toBeNull()
        expect(store.messages.getMessages(sessionId)[0].metadata?.nativeAckAt).toBe(111)
    })

    test('无此 nativeId 行 → 返回 null 不落库', () => {
        store.messages.addMessage(sessionId, WEBAPP_USER, 'local-1', 'persistent', { nativeId: 'uu-1' })
        const acked = store.messages.markMessagesAcked(sessionId, 'ghost', 1755500000000)
        expect(acked).toBeNull()
        expect(store.messages.getMessages(sessionId)[0].metadata?.nativeAckAt).toBeUndefined()
    })
})
