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
import { Store } from '../../src/store'

/**
 * getSessionsByGroup 的 total 字段
 * 验证 total 为分组真实总数（不受 limit/cursor 影响），用于前端显示「真实剩余」
 */
describe('Store.getSessionsByGroup total', () => {
    let store: Store

    beforeEach(() => {
        store = new Store(':memory:')
    })

    afterEach(() => {
        store.close()
    })

    test('total 为分组真实总数，不受 limit 影响', () => {
        // 同一 group_key（path 末两段相同 → 'mygrp/session'）下插 7 个 session
        for (let i = 0; i < 7; i++) {
            store.sessions.getOrCreateSession(
                `tag-${i}`,
                { path: '/x/mygrp/session' },
                null,
                'default',
            )
        }

        // limit=5：本页 5 条、hasMore=true，但 total 应为完整 7 条
        const result = store.sessions.getSessionsByGroup('default', 'mygrp/session', null, 5)
        expect(result.sessions).toHaveLength(5)
        expect(result.hasMore).toBe(true)
        expect(result.total).toBe(7)
    })

    test('不同 group_key 与 namespace 的 session 不计入 total', () => {
        for (let i = 0; i < 3; i++) {
            store.sessions.getOrCreateSession(`a-${i}`, { path: '/x/g1/s' }, null, 'default')
        }
        for (let i = 0; i < 5; i++) {
            store.sessions.getOrCreateSession(`b-${i}`, { path: '/x/g2/s' }, null, 'default')
        }
        // 另一 namespace 的同 group_key，不应计入 default 命名空间
        store.sessions.getOrCreateSession('other-ns', { path: '/x/g1/s' }, null, 'other')

        expect(store.sessions.getSessionsByGroup('default', 'g1/s', null, 20).total).toBe(3)
        expect(store.sessions.getSessionsByGroup('default', 'g2/s', null, 20).total).toBe(5)
    })

    test('翻页（带 cursor）时 total 仍为分组全集，不受 cursor 影响', () => {
        // 同分组 7 条，limit=5：第一页拿 5 条 + nextCursor，第二页带 cursor 拿 2 条
        // 第二页的 total 必须仍是 7（cursor 只过滤本页 SELECT，不影响全集计数）
        // 注：插入间隔 1ms 确保 updated_at 不同（同毫秒会让 `< cursor` 过滤掉所有行）
        for (let i = 0; i < 7; i++) {
            store.sessions.getOrCreateSession(`c-${i}`, { path: '/x/g3/s' }, null, 'default')
            Bun.sleepSync(1)
        }

        const first = store.sessions.getSessionsByGroup('default', 'g3/s', null, 5)
        expect(first.sessions).toHaveLength(5)
        expect(first.hasMore).toBe(true)
        expect(first.nextCursor).not.toBeNull()
        expect(first.total).toBe(7)

        // 用第一页返回的 cursor 翻第二页
        const second = store.sessions.getSessionsByGroup('default', 'g3/s', first.nextCursor, 5)
        expect(second.sessions).toHaveLength(2)
        expect(second.hasMore).toBe(false)
        // 关键断言：第二页 total 仍是全集 7，而非 cursor 之后的 2
        expect(second.total).toBe(7)
    })
})
