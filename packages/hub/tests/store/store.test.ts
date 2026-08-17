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
        // active 状态不再存储在数据库中
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

    test('恢复已有会话时合并 metadata 新字段', () => {
        // 首次创建，无 gitBranch
        const session1 = store.sessions.getOrCreateSession(
            'resume-tag',
            { name: 'resume-test', path: '/home/user/project' },
            null,
            'default'
        )
        expect(session1.metadata).toMatchObject({
            name: 'resume-test',
            path: '/home/user/project'
        })
        expect(session1.metadata).not.toHaveProperty('gitBranch')

        // 恢复（相同 tag），携带新字段 gitBranch
        const session2 = store.sessions.getOrCreateSession(
            'resume-tag',
            { name: 'resume-test', path: '/home/user/project', gitBranch: 'main' },
            null,
            'default'
        )

        // 同一个 session
        expect(session2.id).toBe(session1.id)
        // 新字段被合并，旧字段保留
        expect(session2.metadata).toMatchObject({
            name: 'resume-test',
            path: '/home/user/project',
            gitBranch: 'main'
        })
        // metadata_version 递增
        expect(session2.metadataVersion).toBe(session1.metadataVersion + 1)
    })

    test('metadata 无变化时跳过写入', () => {
        const session1 = store.sessions.getOrCreateSession(
            'skip-tag',
            { name: 'skip-test', path: '/home/user/project' },
            null,
            'default'
        )

        // 恢复时携带完全相同的 metadata
        const session2 = store.sessions.getOrCreateSession(
            'skip-tag',
            { name: 'skip-test', path: '/home/user/project' },
            null,
            'default'
        )

        // 版本未递增，说明跳过了 UPDATE
        expect(session2.metadataVersion).toBe(session1.metadataVersion)
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

    test('通过 nativeSessionId 查找会话', () => {
        // metadata.nativeSessionId 存在时能找到
        const session = store.sessions.getOrCreateSession(
            'tag-with-claude-id',
            { nativeSessionId: 'claude-abc-123', path: '/some/path' },
            null,
            'default'
        )

        const found = store.sessions.getSessionByClaudeSessionId('claude-abc-123', 'default')
        expect(found).not.toBeNull()
        expect(found?.id).toBe(session.id)

        // 不存在时返回 null
        const notFound = store.sessions.getSessionByClaudeSessionId('non-existent', 'default')
        expect(notFound).toBeNull()

        // namespace 隔离：同一 nativeSessionId 在不同 namespace 找不到
        const wrongNs = store.sessions.getSessionByClaudeSessionId('claude-abc-123', 'other-ns')
        expect(wrongNs).toBeNull()
    })

    test('通过 nativeSessionId 查找会话 - 多条记录取 updated_at 最新', () => {
        // 第一条
        store.sessions.getOrCreateSession(
            'tag-old',
            { nativeSessionId: 'claude-dup-456' },
            null,
            'default'
        )
        // 第二条（tag 不同，但 nativeSessionId 相同）
        const newer = store.sessions.getOrCreateSession(
            'tag-new',
            { nativeSessionId: 'claude-dup-456' },
            null,
            'default'
        )

        const found = store.sessions.getSessionByClaudeSessionId('claude-dup-456', 'default')
        // 取 updated_at 最新的一条
        expect(found?.id).toBe(newer.id)
    })

    test('clearRuntimeStateFields 清除指定字段', () => {
        const session = store.sessions.getOrCreateSession(
            'test-tag-clear',
            { name: 'test' },
            null,
            'default'
        )

        // 设置包含多个字段的 runtimeState
        const runtimeState = {
            todos: [{ content: 'test', status: 'completed' }],
            tasks: [{ id: '1', subject: 'test', status: 'completed' }],
            backgroundTasks: [{ taskId: 'bg1', status: 'completed' }],
            model: 'claude-sonnet-4-6',
        }
        // 使用过去的时间戳，确保 clearRuntimeStateFields 的 timestamp guard 生效
        store.sessions.setRuntimeState(session.id, runtimeState, Date.now() - 1, 'default')

        // 清除 todos 和 backgroundTasks
        const result = store.sessions.clearRuntimeStateFields(
            session.id,
            ['todos', 'backgroundTasks'],
            'default'
        )
        expect(result).toBe(true)

        // 验证清理后的状态
        const updated = store.sessions.getSession(session.id)!
        const state = updated.runtimeState as Record<string, unknown>
        expect(state.todos).toBeUndefined()
        expect(state.backgroundTasks).toBeUndefined()
        expect(state.tasks).toBeDefined()
        expect(state.model).toBe('claude-sonnet-4-6')
    })

    test('clearRuntimeStateFields 不存在的 session 返回 false', () => {
        const result = store.sessions.clearRuntimeStateFields(
            'non-existent-id',
            ['todos'],
            'default'
        )
        expect(result).toBe(false)
    })

    test('clearRuntimeStateFields 无 runtimeState 时返回 false', () => {
        const session = store.sessions.getOrCreateSession(
            'test-tag-no-rs',
            { name: 'test' },
            null,
            'default'
        )
        const result = store.sessions.clearRuntimeStateFields(
            session.id,
            ['todos'],
            'default'
        )
        expect(result).toBe(false)
    })
})
