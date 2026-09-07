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

import { describe, test, expect } from 'bun:test'
import type { Database } from 'bun:sqlite'

import { Store } from '../../src/store'
import { migrateLegacyRefMessages } from '../../src/store/legacyRefMigration'

/** Store.db 为 private，测试经类型断言触达（messages-native-id.test.ts 同例） */
function getDb(store: Store): Database {
    return (store as unknown as { db: Database }).db
}

/** 直插 legacy ref 溯源消息（ADR 0003 退场前的形态） */
function seedLegacyProvenance(store: Store, sessionId: string, parentSessionId: string): void {
    getDb(store).prepare(
        `INSERT INTO messages (id, session_id, content, created_at, seq, local_id, metadata, is_sidechain, parent_tool_use_id, category, lifecycle, lifecycle_at, position_at)
         VALUES (?, ?, ?, ?, 1, NULL, NULL, 0, NULL, 'persistent', NULL, NULL, ?)`
    ).run(
        `msg-${Math.random().toString(36).slice(2)}`,
        sessionId,
        JSON.stringify({
            role: 'custom',
            content: [
                { type: 'text', text: 'fork 自会话 ' },
                { type: 'ref', targetType: 'session', id: parentSessionId },
            ],
        }),
        Date.now(),
        Date.now(),
    )
}

function makeStore() {
    return new Store(':memory:')
}

/** 建带 name/path 的会话行 */
function makeSession(store: Store, id: string, metadata: Record<string, unknown>): string {
    getDb(store).prepare(
        `INSERT INTO sessions (id, tag, namespace, created_at, updated_at, metadata, metadata_version, agent_state, agent_state_version, seq)
         VALUES (?, 'tag-1', 'default', ?, ?, ?, 1, NULL, 1, 0)`
    ).run(id, Date.now(), Date.now(), JSON.stringify(metadata))
    return id
}

describe('migrateLegacyRefMessages：ref 溯源消息 → 动作链接（ADR 0003）', () => {
    test('text+ref 合并为单 text block，标题取 parent name', () => {
        const store = makeStore()
        makeSession(store, 'p-1', { name: '我的项目', path: '/tmp/proj' })
        makeSession(store, 'fork-1', { forkedFrom: { sessionId: 'p-root' } })
        seedLegacyProvenance(store, 'fork-1', 'p-1')

        const result = migrateLegacyRefMessages(getDb(store))
        expect(result).toEqual({ scanned: 1, rewritten: 1 })

        const row = getDb(store).prepare('SELECT content FROM messages WHERE session_id = ?').get('fork-1') as { content: string }
        const content = JSON.parse(row.content)
        expect(content.content).toEqual([
            { type: 'text', text: 'fork 自会话 [我的项目](mobi://session/open?id=p-1)' },
        ])
    })

    test('幂等：二次运行 rewritten=0（改写后行不再命中 LIKE）', () => {
        const store = makeStore()
        makeSession(store, 'p-1', { name: 'x' })
        makeSession(store, 'fork-1', { forkedFrom: { sessionId: 'p-root' } })
        seedLegacyProvenance(store, 'fork-1', 'p-1')

        migrateLegacyRefMessages(getDb(store))
        expect(migrateLegacyRefMessages(getDb(store))).toEqual({ scanned: 0, rewritten: 0 })
    })

    test('parent 已删 → 冻结降级文案「已删除的会话」', () => {
        const store = makeStore()
        makeSession(store, 'fork-1', { forkedFrom: { sessionId: 'p-root' } })
        seedLegacyProvenance(store, 'fork-1', 'p-gone')

        migrateLegacyRefMessages(getDb(store))
        const row = getDb(store).prepare('SELECT content FROM messages WHERE session_id = ?').get('fork-1') as { content: string }
        expect(row.content).toContain('已删除的会话')
        expect(row.content).toContain('mobi://session/open?id=p-gone')
    })

    test('无 name 时标题取 path 基名', () => {
        const store = makeStore()
        makeSession(store, 'p-1', { path: '/home/u/my-proj' })
        makeSession(store, 'fork-1', { forkedFrom: { sessionId: 'p-root' } })
        seedLegacyProvenance(store, 'fork-1', 'p-1')

        migrateLegacyRefMessages(getDb(store))
        const row = getDb(store).prepare('SELECT content FROM messages WHERE session_id = ?').get('fork-1') as { content: string }
        expect(row.content).toContain('[my-proj](mobi://session/open?id=p-1)')
    })

    test('范围守卫：agent 消息含 ref 字面量不改写；custom 无 ref 不改写；未注册 targetType 整行保守跳过', () => {
        const store = makeStore()
        makeSession(store, 's-1', { name: 'x', forkedFrom: { sessionId: 'p-root' } })

        // agent 信封透传（tool 输出文本碰巧含字面量）
        store.messages.addMessage('s-1', {
            role: 'agent',
            content: { type: 'output', data: { type: 'text', text: 'see "type":"ref" literal' } },
        })
        // custom 但无 ref
        getDb(store).prepare(
            `INSERT INTO messages (id, session_id, content, created_at, seq, local_id, metadata, is_sidechain, parent_tool_use_id, category, lifecycle, lifecycle_at, position_at)
             VALUES ('m2', 's-1', ?, ?, 2, NULL, NULL, 0, NULL, 'persistent', NULL, NULL, ?)`
        ).run(JSON.stringify({ role: 'custom', content: [{ type: 'text', text: 'plain' }] }), Date.now(), Date.now())
        // custom 含未注册 targetType
        getDb(store).prepare(
            `INSERT INTO messages (id, session_id, content, created_at, seq, local_id, metadata, is_sidechain, parent_tool_use_id, category, lifecycle, lifecycle_at, position_at)
             VALUES ('m3', 's-1', ?, ?, 3, NULL, NULL, 0, NULL, 'persistent', NULL, NULL, ?)`
        ).run(JSON.stringify({ role: 'custom', content: [{ type: 'ref', targetType: 'unknown-kind', id: 'x' }] }), Date.now(), Date.now())

        const before = getDb(store).prepare('SELECT id, content FROM messages WHERE session_id = ? ORDER BY seq').all('s-1') as Array<{ id: string; content: string }>

        migrateLegacyRefMessages(getDb(store))

        const after = getDb(store).prepare('SELECT id, content FROM messages WHERE session_id = ? ORDER BY seq').all('s-1') as Array<{ id: string; content: string }>
        // m1（agent）、m2（无 ref）、m3（未注册 targetType）全部原样——保守跳过保留原始数据
        expect(after[0].content).toBe(before[0].content)
        expect(after[1].content).toBe(before[1].content)
        expect(after[2].content).toBe(before[2].content)
    })
})
