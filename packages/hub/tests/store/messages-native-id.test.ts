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
import { addMessage, bindNativeIds, getMessages } from '../../src/store/messages'

/** 建一个带 native_id 列的最小 messages 表（无 FK/无 sessions，纯模块级函数测试，参照 messages-byposition.test.ts） */
function makeDb(): Database {
    const db = new Database(':memory:', { create: true, readwrite: true, strict: true })
    db.run(`CREATE TABLE messages (id TEXT PRIMARY KEY, session_id TEXT NOT NULL, content TEXT NOT NULL, created_at INTEGER NOT NULL, seq INTEGER NOT NULL, local_id TEXT, native_id TEXT, is_sidechain INTEGER DEFAULT 0, parent_tool_use_id TEXT, category TEXT DEFAULT 'persistent', submitted_at INTEGER, queue_state TEXT, position_at INTEGER NOT NULL)`)
    return db
}

/** webapp 用户消息内容（排队轨道来源；nativeId 断言不依赖排队语义，仅保持真实信封） */
const WEBAPP_USER = { role: 'user', content: { type: 'text', text: 'hi' }, meta: { sentFrom: 'webapp' } }

describe('addMessage nativeId', () => {
    let db: Database
    beforeEach(() => { db = makeDb() })

    test('插入时写入 native_id', () => {
        const msg = addMessage(db, 's1', WEBAPP_USER, 'local-1', 'persistent', 'uu-1')
        expect(msg.nativeId).toBe('uu-1')
        expect(getMessages(db, 's1')[0].nativeId).toBe('uu-1')
    })

    test('nativeId 缺省为 null', () => {
        const msg = addMessage(db, 's1', WEBAPP_USER, 'local-2')
        expect(msg.nativeId).toBeNull()
    })

    test('相同 localId 重复插入：native_id 首写保留', () => {
        addMessage(db, 's1', WEBAPP_USER, 'local-3', 'persistent', 'uu-3')
        const again = addMessage(db, 's1', WEBAPP_USER, 'local-3')
        expect(again.nativeId).toBe('uu-3')
    })

    test('相同 localId 重复插入且带不同 nativeId：首写值仍保留（COALESCE 竞争值丢弃）', () => {
        addMessage(db, 's1', WEBAPP_USER, 'local-x', 'persistent', 'uu-first')
        const again = addMessage(db, 's1', WEBAPP_USER, 'local-x', 'persistent', 'uu-second')
        expect(again.nativeId).toBe('uu-first')
        expect(getMessages(db, 's1')[0].nativeId).toBe('uu-first')
    })
})

describe('bindNativeIds', () => {
    let db: Database
    beforeEach(() => { db = makeDb() })

    test('绑定 NULL 行并返回命中的 localId', () => {
        addMessage(db, 's1', WEBAPP_USER, 'local-a')
        addMessage(db, 's1', WEBAPP_USER, 'local-b')
        const bound = bindNativeIds(db, 's1', [
            { localId: 'local-a', nativeId: 'uu-a' },
            { localId: 'local-b', nativeId: 'uu-a' },
        ])
        expect(bound).toEqual(['local-a', 'local-b'])
        const rows = getMessages(db, 's1')
        expect(rows.find(r => r.localId === 'local-a')!.nativeId).toBe('uu-a')
        expect(rows.find(r => r.localId === 'local-b')!.nativeId).toBe('uu-a')
    })

    test('幂等：已绑定的行不覆盖、不重复计入', () => {
        addMessage(db, 's1', WEBAPP_USER, 'local-c')
        bindNativeIds(db, 's1', [{ localId: 'local-c', nativeId: 'uu-1' }])
        const second = bindNativeIds(db, 's1', [{ localId: 'local-c', nativeId: 'uu-2' }])
        expect(second).toEqual([])
        expect(getMessages(db, 's1')[0].nativeId).toBe('uu-1')
    })

    test('行不存在 → 跳过不报错', () => {
        const bound = bindNativeIds(db, 's1', [{ localId: 'ghost', nativeId: 'uu-x' }])
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

    test('addMessage 经 MessageStore 透传 nativeId', () => {
        const msg = store.messages.addMessage(sessionId, WEBAPP_USER, 'local-d', 'persistent', 'uu-d')
        expect(msg.nativeId).toBe('uu-d')
        expect(store.messages.getMessages(sessionId)[0].nativeId).toBe('uu-d')
    })

    test('MessageStore 类暴露 bindNativeIds', () => {
        store.messages.addMessage(sessionId, WEBAPP_USER, 'local-e')
        const bound = store.messages.bindNativeIds(sessionId, [{ localId: 'local-e', nativeId: 'uu-e' }])
        expect(bound).toEqual(['local-e'])
        expect(store.messages.getMessages(sessionId)[0].nativeId).toBe('uu-e')
    })
})
