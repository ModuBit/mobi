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
import { isContextBoundaryContent } from '../../src/store/messages'

/** 边界指针字段（会话行 metadata 上的唯一判据来源） */
const BOUNDARY_KEY = 'contextBoundarySeq'

/** 读取会话行 metadata 上的边界指针（断言辅助；缺失返回 undefined） */
function readBoundarySeq(store: Store, sid: string): number | undefined {
    const metadata = store.sessions.getSession(sid)?.metadata
    if (metadata === null || metadata === undefined) return undefined
    return (metadata as Record<string, unknown>)[BOUNDARY_KEY] as number | undefined
}

// ============ 边界消息内容构造器（真实信封形态，见 web turnBoundary / apiSession.sendSessionEvent）============

/** system:compact_boundary 输出信封（subtype 可换成 microcompact_boundary 作反例） */
const compactBoundary = (subtype: string = 'compact_boundary') => ({
    role: 'agent',
    content: { type: 'output', data: { type: 'system', subtype } },
})

/** context-cleared 事件信封（apiSession.sendSessionEvent 的 event 形态） */
const contextCleared = () => ({
    role: 'agent',
    content: { id: 'evt-1', type: 'event', data: { type: 'context-cleared' } },
})

/** 普通 user 信封（webapp 排队轨道来源） */
const userMsg = (text: string) => ({ role: 'user', content: { type: 'text', text }, meta: { sentFrom: 'webapp' } })

/** 普通 assistant 输出信封（非边界） */
const assistantMsg = () => ({
    role: 'agent',
    content: { type: 'output', data: { type: 'assistant', message: { content: [] } } },
})

describe('isContextBoundaryContent：边界消息识别', () => {
    test('system:compact_boundary → true', () => {
        expect(isContextBoundaryContent(compactBoundary())).toBe(true)
    })

    test('context-cleared 事件 → true', () => {
        expect(isContextBoundaryContent(contextCleared())).toBe(true)
    })

    test('microcompact_boundary 不是边界（微压缩不换上下文）', () => {
        expect(isContextBoundaryContent(compactBoundary('microcompact_boundary'))).toBe(false)
    })

    test('普通 user / assistant 信封 → false', () => {
        expect(isContextBoundaryContent(userMsg('hi'))).toBe(false)
        expect(isContextBoundaryContent(assistantMsg())).toBe(false)
    })

    test('裸 string / null / 缺 data 的信封 → false（不抛错）', () => {
        expect(isContextBoundaryContent('plain text')).toBe(false)
        expect(isContextBoundaryContent(null)).toBe(false)
        expect(isContextBoundaryContent({ role: 'agent', content: { type: 'event' } })).toBe(false)
    })
})

describe('contextBoundary advance：两个写入时机共用的单调推进', () => {
    let store: Store
    let sid: string

    beforeEach(() => {
        store = new Store(':memory:')
        sid = store.sessions.getOrCreateSession('boundary-advance-test', { path: '/tmp/x' }, null, 'default').id
    })

    /** 模拟 session-message 落库 + 边界推进（与 handler 内联逻辑同构） */
    function addAndAdvance(content: unknown): number {
        const msg = store.messages.addMessage(sid, content)
        if (isContextBoundaryContent(content)) {
            store.contextBoundary.advance(sid, store.messages.getMaxSeq(sid))
        }
        return msg.seq
    }

    test('compact_boundary 落库 → 指针 = 该行 seq，之后落库的消息 seq > 指针', () => {
        addAndAdvance(userMsg('before'))                    // seq 1
        const boundarySeq = addAndAdvance(compactBoundary()) // seq 2
        expect(boundarySeq).toBe(2)
        expect(readBoundarySeq(store, sid)).toBe(2)

        const after = addAndAdvance(userMsg('after'))        // seq 3
        expect(after).toBeGreaterThan(readBoundarySeq(store, sid)!)
    })

    test('context-cleared 事件 → 指针推进到当前 MAX(seq)，之后落库的消息 seq > 指针', () => {
        addAndAdvance(userMsg('before'))                     // seq 1
        addAndAdvance(contextCleared())                      // seq 2
        expect(readBoundarySeq(store, sid)).toBe(2)

        const after = addAndAdvance(userMsg('after'))        // seq 3
        expect(after).toBeGreaterThan(readBoundarySeq(store, sid)!)
    })

    test('seq 单调：落后的 seq 不回退指针（重复/乱序推进幂等）', () => {
        store.contextBoundary.advance(sid, 5)
        expect(readBoundarySeq(store, sid)).toBe(5)

        store.contextBoundary.advance(sid, 3)
        expect(readBoundarySeq(store, sid)).toBe(5)
        // 相同 seq 重复推进也幂等
        store.contextBoundary.advance(sid, 5)
        expect(readBoundarySeq(store, sid)).toBe(5)
    })

    test('两种边界先后到达：指针取最新边界', () => {
        addAndAdvance(compactBoundary())   // seq 1
        addAndAdvance(contextCleared())    // seq 2
        expect(readBoundarySeq(store, sid)).toBe(2)
    })

    test('指针保留 metadata 其余字段（合并不覆盖）', () => {
        store.sessions.updateSessionMetadata(
            sid, { path: '/tmp/x', nativeSessionId: 'native-1' }, 1, 'default'
        )
        store.contextBoundary.advance(sid, 7)
        const metadata = store.sessions.getSession(sid)!.metadata as Record<string, unknown>
        expect(metadata[BOUNDARY_KEY]).toBe(7)
        expect(metadata.nativeSessionId).toBe('native-1')
        expect(metadata.path).toBe('/tmp/x')
    })

    test('会话不存在 → 不抛错、不写', () => {
        expect(() => store.contextBoundary.advance('no-such-sid', 3)).not.toThrow()
    })
})

describe('contextBoundary resolve：读侧缺失惰性回填（存量会话首次消费）', () => {
    let store: Store
    let sid: string

    beforeEach(() => {
        store = new Store(':memory:')
        sid = store.sessions.getOrCreateSession('boundary-resolve-test', { path: '/tmp/x' }, null, 'default').id
    })

    test('字段已有 → 直接返回，不重算', () => {
        store.contextBoundary.advance(sid, 9)
        expect(store.contextBoundary.resolve(sid)).toBe(9)
    })

    test('存量会话字段缺失 → 向回扫最近一条边界行，写回 metadata', () => {
        store.messages.addMessage(sid, userMsg('a'))          // seq 1
        store.messages.addMessage(sid, compactBoundary())     // seq 2
        store.messages.addMessage(sid, userMsg('b'))          // seq 3

        expect(store.contextBoundary.resolve(sid)).toBe(2)
        expect(readBoundarySeq(store, sid)).toBe(2)
    })

    test('无边界 → 0（并写回，二次消费不再重扫）', () => {
        store.messages.addMessage(sid, userMsg('a'))
        expect(store.contextBoundary.resolve(sid)).toBe(0)
        expect(readBoundarySeq(store, sid)).toBe(0)
    })

    test('软删边界行不计入（软删空洞不影响比较）', () => {
        store.messages.addMessage(sid, compactBoundary())     // seq 1（后被 rewind 软删）
        store.messages.addMessage(sid, userMsg('a'))          // seq 2
        store.messages.addMessage(sid, compactBoundary())     // seq 3
        store.messages.addMessage(sid, userMsg('b'))          // seq 4
        store.messages.softDeleteMessagesFrom(sid, 1, 1)

        expect(store.contextBoundary.resolve(sid)).toBe(3)
    })

    test('会话不存在 → 0', () => {
        expect(store.contextBoundary.resolve('no-such-sid')).toBe(0)
    })
})
