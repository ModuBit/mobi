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

import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { Store } from './index'

describe('Store', () => {
    let store: Store

    beforeEach(() => {
        store = new Store(':memory:')
    })

    afterEach(() => {
        store.close()
    })

    test('创建会话', () => {
        const session = store.sessions.getOrCreateSession(
            'test-tag-1',
            { name: 'test' },
            null,
            'default'
        )
        expect(session.id).toBeTruthy()
        expect(session.tag).toBe('test-tag-1')
        expect(session.namespace).toBe('default')
        expect(session.active).toBe(false)
    })

    test('获取已存在的会话（幂等）', () => {
        const session1 = store.sessions.getOrCreateSession(
            'test-tag-2',
            { name: 'test' },
            null,
            'default'
        )
        const session2 = store.sessions.getOrCreateSession(
            'test-tag-2',
            { name: 'test' },
            null,
            'default'
        )
        // 第二次调用应返回同一个会话
        expect(session2.id).toBe(session1.id)
    })

    test('通过 ID 获取会话', () => {
        const created = store.sessions.getOrCreateSession(
            'test-tag-3',
            null,
            null,
            'default'
        )
        const fetched = store.sessions.getSession(created.id)
        expect(fetched).not.toBeNull()
        expect(fetched?.id).toBe(created.id)
        expect(fetched?.tag).toBe('test-tag-3')
    })

    test('获取不存在的会话返回 null', () => {
        const result = store.sessions.getSession('non-existent-id')
        expect(result).toBeNull()
    })

    test('创建消息', () => {
        const session = store.sessions.getOrCreateSession(
            'test-tag-4',
            null,
            null,
            'default'
        )
        const msg = store.messages.addMessage(session.id, { text: 'hello' })
        expect(msg.id).toBeTruthy()
        expect(msg.sessionId).toBe(session.id)
        expect(msg.seq).toBe(1)
    })

    test('版本化更新机制 - 成功', () => {
        const session = store.sessions.getOrCreateSession(
            'test-tag-5',
            { key: 'old' },
            null,
            'default'
        )
        // 初始 metadataVersion = 1，传入 expectedVersion = 1 → 成功
        const result = store.sessions.updateSessionMetadata(
            session.id,
            { key: 'value' },
            1,
            'default'
        )
        expect(result.result).toBe('success')
    })

    test('版本化更新机制 - 版本不匹配', () => {
        const session = store.sessions.getOrCreateSession(
            'test-tag-6',
            { key: 'old' },
            null,
            'default'
        )
        // 传入错误版本号 → 版本不匹配
        const result = store.sessions.updateSessionMetadata(
            session.id,
            { key: 'value' },
            999,
            'default'
        )
        expect(result.result).toBe('version-mismatch')
    })

    test('获取所有会话', () => {
        store.sessions.getOrCreateSession('tag-a', null, null, 'default')
        store.sessions.getOrCreateSession('tag-b', null, null, 'default')
        const sessions = store.sessions.getSessions()
        expect(sessions.length).toBe(2)
    })

    test('按命名空间获取会话', () => {
        store.sessions.getOrCreateSession('ns-tag-1', null, null, 'ns-test')
        store.sessions.getOrCreateSession('ns-tag-2', null, null, 'ns-test')
        store.sessions.getOrCreateSession('other-tag', null, null, 'other-ns')
        const nsSessions = store.sessions.getSessionsByNamespace('ns-test')
        expect(nsSessions.length).toBe(2)
        expect(nsSessions.every((s) => s.namespace === 'ns-test')).toBe(true)
    })

    test('删除会话', () => {
        const session = store.sessions.getOrCreateSession(
            'test-tag-del',
            null,
            null,
            'default'
        )
        const deleted = store.sessions.deleteSession(session.id, 'default')
        expect(deleted).toBe(true)
        expect(store.sessions.getSession(session.id)).toBeNull()
    })

    test('消息按 seq 排序', () => {
        const session = store.sessions.getOrCreateSession(
            'test-tag-seq',
            null,
            null,
            'default'
        )
        store.messages.addMessage(session.id, { text: 'first' })
        store.messages.addMessage(session.id, { text: 'second' })
        store.messages.addMessage(session.id, { text: 'third' })

        const messages = store.messages.getMessages(session.id)
        expect(messages.length).toBe(3)
        // getMessages 返回按 seq 升序排列的消息
        expect(messages[0].seq).toBeLessThan(messages[1].seq)
        expect(messages[1].seq).toBeLessThan(messages[2].seq)
    })
})
