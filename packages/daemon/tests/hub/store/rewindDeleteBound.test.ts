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

import { Store } from '../../src/store'
import { RewindDeleteBoundTracker } from '../../src/sync/rewindDeleteBoundTracker'

/**
 * rewind 软删除上界（M3 防御）：迟到截断回报不得吞掉受理后新发的消息。
 * @see packages/hub/src/store/messages.ts softDeleteMessagesFrom(maxSeq)
 * @see packages/hub/src/sync/rewindDeleteBoundTracker.ts
 */
describe('rewind 软删除上界', () => {
    let store: Store
    let sessionId: string

    beforeEach(() => {
        store = new Store(':memory:')
        sessionId = store.sessions.getOrCreateSession('rewind-bound-test', null, null, 'default').id
    })

    /** 造 seq 1..n 的消息行（seq 由调用方显式给定，模拟受理时点前后交错） */
    function seedMessages(seqs: number[]): void {
        for (const seq of seqs) {
            const msg = store.messages.addMessage(sessionId, { role: 'user', content: { text: `m${seq}` } })
            // addMessage 自增 seq，显式改写以构造任意 seq 布局
            // （测试捷径：直接用 SQL 改 seq，绕过业务写入路径）
            ;(store as unknown as { db: import('bun:sqlite').Database }).db
                .prepare('UPDATE messages SET seq = ? WHERE id = ?')
                .run(seq, msg.id)
        }
    }

    test('getMaxSeq 返回会话最大 seq（无消息返回 0）', () => {
        expect(store.messages.getMaxSeq(sessionId)).toBe(0)
        seedMessages([1, 2, 5])
        expect(store.messages.getMaxSeq(sessionId)).toBe(5)
        // 会话间隔离
        expect(store.messages.getMaxSeq('other-session')).toBe(0)
    })

    test('带上界软删除：上界之外的行（受理后新消息）保留', () => {
        seedMessages([1, 2, 3, 4, 5])
        // 受理时最大 seq = 3；迟到回报 deleteFromSeq = 2 → 只删 2..3，4..5（新消息）保留
        const deleted = store.messages.softDeleteMessagesFrom(sessionId, 2, 3)
        expect(deleted).toBe(2)
        const remaining = store.messages.getMessages(sessionId, 100).map(m => m.seq)
        expect(remaining).toEqual([1, 4, 5])
    })

    test('无上界（旧行为 / hub 重启丢内存回退）：删到尾', () => {
        seedMessages([1, 2, 3, 4, 5])
        const deleted = store.messages.softDeleteMessagesFrom(sessionId, 2)
        expect(deleted).toBe(4)
        expect(store.messages.getMessages(sessionId, 100).map(m => m.seq)).toEqual([1])
    })

    test('幂等：已删行不计入二次删除', () => {
        seedMessages([1, 2, 3])
        expect(store.messages.softDeleteMessagesFrom(sessionId, 1, 3)).toBe(3)
        expect(store.messages.softDeleteMessagesFrom(sessionId, 1, 3)).toBe(0)
    })
})

describe('RewindDeleteBoundTracker', () => {
    test('markAccepted 后 consume 一次性返回并清除（防陈旧上界波及后续 rewind）', () => {
        const tracker = new RewindDeleteBoundTracker()
        tracker.markAccepted('s1', 42)
        expect(tracker.consume('s1')).toBe(42)
        expect(tracker.consume('s1')).toBeNull()
    })

    test('无记录 consume 返回 null（hub 重启回退无上界）', () => {
        const tracker = new RewindDeleteBoundTracker()
        expect(tracker.consume('ghost')).toBeNull()
    })

    test('会话间隔离 + 后一次受理覆盖前一次', () => {
        const tracker = new RewindDeleteBoundTracker()
        tracker.markAccepted('s1', 10)
        tracker.markAccepted('s2', 20)
        tracker.markAccepted('s1', 30)
        expect(tracker.consume('s1')).toBe(30)
        expect(tracker.consume('s2')).toBe(20)
    })

    test('isDuplicateTruncated：首见记录返回 false，同键重放返回 true，不同键各自首见', () => {
        const tracker = new RewindDeleteBoundTracker()
        expect(tracker.isDuplicateTruncated('s1', 'u1', 3)).toBe(false)
        expect(tracker.isDuplicateTruncated('s1', 'u1', 3)).toBe(true)
        // 不同 deleteFromSeq / nativeId = 不同键
        expect(tracker.isDuplicateTruncated('s1', 'u1', 4)).toBe(false)
        expect(tracker.isDuplicateTruncated('s1', 'u2', 3)).toBe(false)
        // 会话间隔离
        expect(tracker.isDuplicateTruncated('s2', 'u1', 3)).toBe(false)
    })

    test('isDuplicateTruncated：A 的重放被 B 的回报插队（单槽覆盖）后仍正确去重', () => {
        const tracker = new RewindDeleteBoundTracker()
        // rewind A 的 truncated 已处理
        expect(tracker.isDuplicateTruncated('s1', 'uA', 2)).toBe(false)
        // rewind B 的 truncated 先于 A 的重放到达
        expect(tracker.isDuplicateTruncated('s1', 'uB', 1)).toBe(false)
        // A 的重放到达：键不与当前相邻（曾被 B 插队）但仍在保留集合内 → 去重
        expect(tracker.isDuplicateTruncated('s1', 'uA', 2)).toBe(true)
    })

    test('isDuplicateTruncated：保留键有界——超出上限淘汰最旧，被淘汰键重见视为首见', () => {
        const tracker = new RewindDeleteBoundTracker()
        for (let i = 0; i < 8; i++) {
            expect(tracker.isDuplicateTruncated('s1', `u${i}`, i)).toBe(false)
        }
        // 第 9 个键淘汰最旧的 u0 → u0 重见如首见（8 个之外的重放窗口早已超过 CLI 重试上限）
        expect(tracker.isDuplicateTruncated('s1', 'u8', 8)).toBe(false)
        expect(tracker.isDuplicateTruncated('s1', 'u0', 0)).toBe(false)
        // 未被淘汰的 u7 仍去重
        expect(tracker.isDuplicateTruncated('s1', 'u7', 7)).toBe(true)
    })
})
