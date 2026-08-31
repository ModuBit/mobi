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
import { addMessage, advanceMessagesLifecycle, bindNativeIds, cancelAllQueuedMessages, getMessages } from '../../src/store/messages'

/** 建一个带 metadata/deleted_at 列的最小 messages 表（无 FK/无 sessions，纯模块级函数测试，参照 messages-byposition.test.ts） */
function makeDb(): Database {
    const db = new Database(':memory:', { create: true, readwrite: true, strict: true })
    db.run(`CREATE TABLE messages (id TEXT PRIMARY KEY, session_id TEXT NOT NULL, content TEXT NOT NULL, created_at INTEGER NOT NULL, seq INTEGER NOT NULL, local_id TEXT, native_id TEXT GENERATED ALWAYS AS (json_extract(metadata, '$.nativeId')) STORED, metadata TEXT, deleted_at INTEGER, is_sidechain INTEGER DEFAULT 0, parent_tool_use_id TEXT, category TEXT DEFAULT 'persistent', lifecycle TEXT, lifecycle_at INTEGER, position_at INTEGER NOT NULL)`)
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
        expect(acked).toHaveLength(1)
        expect(acked[0].metadata?.nativeAckAt).toBe(1755500000000)
        // 落库生效（nativeId/nativeSessionId 同族保留，nativeAckAt 追加）
        const row = store.messages.getMessages(sessionId)[0]
        expect(row.metadata).toEqual({ nativeId: 'uu-1', nativeAckAt: 1755500000000 })
    })

    test('合并批 1:N（同 nativeId 多行）→ 全部命中并全量返回（供逐行广播）', () => {
        store.messages.addMessage(sessionId, WEBAPP_USER, 'local-1', 'persistent', { nativeId: 'uu-batch' })
        store.messages.addMessage(sessionId, WEBAPP_USER, 'local-2', 'persistent', { nativeId: 'uu-batch' })
        store.messages.addMessage(sessionId, WEBAPP_USER, 'local-3', 'persistent', { nativeId: 'uu-other' })
        const acked = store.messages.markMessagesAcked(sessionId, 'uu-batch', 1755500000000)
        expect(acked.map(m => m.localId).sort()).toEqual(['local-1', 'local-2'])
        expect(acked.every(m => m.metadata?.nativeAckAt === 1755500000000)).toBe(true)
        // 批外行不受影响
        expect(store.messages.getMessages(sessionId).find(r => r.localId === 'local-3')!.metadata?.nativeAckAt).toBeUndefined()
    })

    test('重复 ack → first-write-wins 不覆盖，返回空', () => {
        store.messages.addMessage(sessionId, WEBAPP_USER, 'local-1', 'persistent', { nativeId: 'uu-1' })
        store.messages.markMessagesAcked(sessionId, 'uu-1', 111)
        const again = store.messages.markMessagesAcked(sessionId, 'uu-1', 222)
        expect(again).toEqual([])
        expect(store.messages.getMessages(sessionId)[0].metadata?.nativeAckAt).toBe(111)
    })

    test('无此 nativeId 行 → 返回空不落库', () => {
        store.messages.addMessage(sessionId, WEBAPP_USER, 'local-1', 'persistent', { nativeId: 'uu-1' })
        const acked = store.messages.markMessagesAcked(sessionId, 'ghost', 1755500000000)
        expect(acked).toEqual([])
        expect(store.messages.getMessages(sessionId)[0].metadata?.nativeAckAt).toBeUndefined()
    })
})

describe('advanceMessagesAcked（isReplay 回显 → lifecycle 推进）', () => {
    let store: Store
    let sessionId: string

    beforeEach(() => {
        store = new Store(':memory:')
        sessionId = store.sessions.getOrCreateSession('advance-ack-test', null, null, 'default').id
    })

    test('合并批 1:N（同 nativeId 多行 pushed）→ 全部推进且返回全量行 id', () => {
        const m1 = store.messages.addMessage(sessionId, WEBAPP_USER, 'local-1', 'persistent', { nativeId: 'uu-batch' })
        const m2 = store.messages.addMessage(sessionId, WEBAPP_USER, 'local-2', 'persistent', { nativeId: 'uu-batch' })
        const m3 = store.messages.addMessage(sessionId, WEBAPP_USER, 'local-3', 'persistent', { nativeId: 'uu-batch' })
        // 同 nativeId 的 queued 行（尚未 push）：不被推进
        store.messages.addMessage(sessionId, WEBAPP_USER, 'local-q', 'persistent', { nativeId: 'uu-batch' })
        // 不同 nativeId 的 pushed 行：批外不受影响
        store.messages.addMessage(sessionId, WEBAPP_USER, 'local-o', 'persistent', { nativeId: 'uu-other' })
        store.messages.markMessagesPushed(sessionId, ['local-1', 'local-2', 'local-3', 'local-o'], 1000)

        const acked = store.messages.advanceMessagesAcked(sessionId, 'uu-batch', 2000)
        expect(acked.sort()).toEqual([m1.id, m2.id, m3.id].sort())

        const rows = store.messages.getMessages(sessionId)
        expect(rows.find(r => r.localId === 'local-1')!.lifecycle).toBe('acked')
        expect(rows.find(r => r.localId === 'local-2')!.lifecycle).toBe('acked')
        expect(rows.find(r => r.localId === 'local-3')!.lifecycle).toBe('acked')
        expect(rows.find(r => r.localId === 'local-1')!.lifecycleAt).toBe(2000)
        // queued 行不动（单调性：仅 pushed 可推进）
        expect(rows.find(r => r.localId === 'local-q')!.lifecycle).toBe('queued')
        // 批外 pushed 行不动
        expect(rows.find(r => r.localId === 'local-o')!.lifecycle).toBe('pushed')
    })

    test('已 acked / 重复 ack → 幂等返回空，lifecycleAt 不被覆盖', () => {
        store.messages.addMessage(sessionId, WEBAPP_USER, 'local-1', 'persistent', { nativeId: 'uu-1' })
        store.messages.markMessagesPushed(sessionId, ['local-1'], 1000)
        store.messages.advanceMessagesAcked(sessionId, 'uu-1', 2000)
        const again = store.messages.advanceMessagesAcked(sessionId, 'uu-1', 3000)
        expect(again).toEqual([])
        const row = store.messages.getMessages(sessionId)[0]
        expect(row.lifecycle).toBe('acked')
        expect(row.lifecycleAt).toBe(2000)
    })

    test('无此 nativeId 行 → 返回空，lifecycle 不动', () => {
        store.messages.addMessage(sessionId, WEBAPP_USER, 'local-1', 'persistent', { nativeId: 'uu-1' })
        store.messages.markMessagesPushed(sessionId, ['local-1'], 1000)
        expect(store.messages.advanceMessagesAcked(sessionId, 'ghost', 2000)).toEqual([])
        expect(store.messages.getMessages(sessionId)[0].lifecycle).toBe('pushed')
    })
})

describe('advanceMessagesLifecycle（command_lifecycle 终态推进）', () => {
    let store: Store
    let sessionId: string

    beforeEach(() => {
        store = new Store(':memory:')
        sessionId = store.sessions.getOrCreateSession('lifecycle-advance-test', null, null, 'default').id
    })

    /** 铺一条 pushed 且已绑 nativeId 的行 */
    function seedPushed(localId: string, nativeId: string): void {
        store.messages.addMessage(sessionId, WEBAPP_USER, localId)
        store.messages.markMessagesPushed(sessionId, [localId], 1000)
        store.messages.bindNativeIds(sessionId, [{ localId, metadata: { nativeId } }])
    }

    test('pushed → processing 推进，返回行 id，lifecycle_at 更新', () => {
        seedPushed('l1', 'nu-1')
        seedPushed('l2', 'nu-2')

        const ids = store.messages.advanceMessagesLifecycle(sessionId, 'nu-1', 'processing', 3000)
        expect(ids).toHaveLength(1)

        const rows = store.messages.getMessages(sessionId)
        const row = rows.find(r => r.localId === 'l1')!
        expect(row.lifecycle).toBe('processing')
        expect(row.lifecycleAt).toBe(3000)
        // 批外行不受影响
        expect(rows.find(r => r.localId === 'l2')!.lifecycle).toBe('pushed')
    })

    test('processing → done 推进；done → processing 不回退（乱序帧防护）', () => {
        seedPushed('l1', 'nu-1')
        store.messages.advanceMessagesLifecycle(sessionId, 'nu-1', 'processing', 3000)

        const ids = store.messages.advanceMessagesLifecycle(sessionId, 'nu-1', 'done', 4000)
        expect(ids).toHaveLength(1)

        // 乱序帧：done 之后迟到 processing 不回退
        const again = store.messages.advanceMessagesLifecycle(sessionId, 'nu-1', 'processing', 5000)
        expect(again).toEqual([])

        const row = store.messages.getMessages(sessionId).find(r => r.localId === 'l1')!
        expect(row.lifecycle).toBe('done')
        expect(row.lifecycleAt).toBe(4000)
    })

    test('cancelled → done 不互相覆盖（同为 rank 4 终态）', () => {
        seedPushed('l1', 'nu-1')
        store.messages.advanceMessagesLifecycle(sessionId, 'nu-1', 'cancelled', 3000)

        const again = store.messages.advanceMessagesLifecycle(sessionId, 'nu-1', 'done', 4000)
        expect(again).toEqual([])

        const row = store.messages.getMessages(sessionId).find(r => r.localId === 'l1')!
        expect(row.lifecycle).toBe('cancelled')
        expect(row.lifecycleAt).toBe(3000)
    })

    test('queued 也可直达终态（跳过 pushed——理论帧序异常时的容错）', () => {
        store.messages.addMessage(sessionId, WEBAPP_USER, 'l-q')
        store.messages.bindNativeIds(sessionId, [{ localId: 'l-q', metadata: { nativeId: 'nu-q' } }])

        const ids = store.messages.advanceMessagesLifecycle(sessionId, 'nu-q', 'done', 2000)
        expect(ids).toHaveLength(1)

        const row = store.messages.getMessages(sessionId).find(r => r.localId === 'l-q')!
        expect(row.lifecycle).toBe('done')
        expect(row.lifecycleAt).toBe(2000)
    })

    test('无命中 nativeId 返回空数组', () => {
        seedPushed('l1', 'nu-1')
        expect(store.messages.advanceMessagesLifecycle(sessionId, 'ghost', 'processing', 3000)).toEqual([])
        expect(store.messages.getMessages(sessionId)[0].lifecycle).toBe('pushed')
    })

    test('refused 作为终态可推进（queued/pushed 轨道），与 done 互不覆盖（同 rank first-terminal-wins）', () => {
        // refused 从 pushed 直达终态（跨会话 peer 消息被拒收，U-8）
        seedPushed('l1', 'nu-1')
        const ids = store.messages.advanceMessagesLifecycle(sessionId, 'nu-1', 'refused', 3000)
        expect(ids).toHaveLength(1)
        const row = store.messages.getMessages(sessionId).find(r => r.localId === 'l1')!
        expect(row.lifecycle).toBe('refused')
        expect(row.lifecycleAt).toBe(3000)

        // 已 done 的行不被 refused 覆盖（同为 rank 4 终态）
        seedPushed('l2', 'nu-2')
        store.messages.advanceMessagesLifecycle(sessionId, 'nu-2', 'done', 4000)
        const again = store.messages.advanceMessagesLifecycle(sessionId, 'nu-2', 'refused', 5000)
        expect(again).toEqual([])
        const doneRow = store.messages.getMessages(sessionId).find(r => r.localId === 'l2')!
        expect(doneRow.lifecycle).toBe('done')
        expect(doneRow.lifecycleAt).toBe(4000)
    })
})

describe('cancelAllQueuedMessages（停止并清空队列——批量删除 queued 行）', () => {
    let store: Store
    let sessionId: string

    beforeEach(() => {
        store = new Store(':memory:')
        sessionId = store.sessions.getOrCreateSession('cancel-all-queued-test', null, null, 'default').id
    })

    test('只删 queued 行，返回删除数；pushed 与 null 轨道不受影响', () => {
        // queued：webapp 用户消息（排队轨道）
        store.messages.addMessage(sessionId, WEBAPP_USER, 'l-queued')
        // pushed：已推进（不可删——队列清空只针对未消费消息）
        store.messages.addMessage(sessionId, WEBAPP_USER, 'l-pushed')
        store.messages.markMessagesPushed(sessionId, ['l-pushed'], 1000)
        // null：无 localId（非排队轨道）
        store.messages.addMessage(sessionId, WEBAPP_USER, null)

        const db = (store as unknown as { db: Database }).db
        const deleted = cancelAllQueuedMessages(db, sessionId)
        expect(deleted).toBe(1)

        const rows = store.messages.getMessages(sessionId)
        expect(rows.find(r => r.localId === 'l-queued')).toBeUndefined()
        expect(rows.find(r => r.localId === 'l-pushed')!.lifecycle).toBe('pushed')
        expect(rows).toHaveLength(2)
    })

    test('MessageStore 包装方法透传（返回删除行数）', () => {
        store.messages.addMessage(sessionId, WEBAPP_USER, 'l-1')
        store.messages.addMessage(sessionId, WEBAPP_USER, 'l-2')
        expect(store.messages.cancelAllQueuedMessages(sessionId)).toBe(2)
        expect(store.messages.getUnsubmittedLocalMessages(sessionId)).toEqual([])
    })

    test('无 queued 行 → 返回 0', () => {
        expect(store.messages.cancelAllQueuedMessages(sessionId)).toBe(0)
    })
})

describe('advanceMessagesLifecycle：withdrawn 防护（模块级直连）', () => {
    test('withdrawn 不被覆盖', () => {
        const db = makeDb()
        addMessage(db, 's1', WEBAPP_USER, 'l1', 'persistent', { nativeId: 'nu-1' })
        db.run(`UPDATE messages SET lifecycle = 'withdrawn', lifecycle_at = 500 WHERE session_id = 's1' AND local_id = 'l1'`)

        expect(advanceMessagesLifecycle(db, 's1', 'nu-1', 'done', 3000)).toEqual([])
        expect(getMessages(db, 's1')[0].lifecycle).toBe('withdrawn')
    })
})
