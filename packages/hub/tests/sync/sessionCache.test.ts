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
import { SessionCache } from '../../src/sync/sessionCache'
import { Store } from '../../src/store'
import type { EventPublisher } from '../../src/sync/eventPublisher'

// SessionCache 仅依赖 publisher.emit（rename 路径对已存在 session 不广播），
// 用最小 stub 即可，无需拉起 SSE/namespace 解析
const stubPublisher = { emit: () => {} } as unknown as EventPublisher

describe('SessionCache.renameSession', () => {
    let store: Store
    let cache: SessionCache

    beforeEach(() => {
        store = new Store(':memory:')
        cache = new SessionCache(store, stubPublisher)
    })

    afterEach(() => {
        store.close()
    })

    test('重命名后清除自动摘要 summary，避免 summary.text 盖住用户命名', async () => {
        // 模拟 CLI summary 事件落库后的状态：name 与 summary.text 同源（均来自 Claude 自动摘要）
        const session = cache.getOrCreateSession(
            'tag-rename-1',
            {
                path: '/tmp/proj',
                host: 'host-1',
                name: '自动摘要',
                summary: { text: '自动摘要', updatedAt: 123 },
            },
            null,
            'default'
        )

        await cache.renameSession(session.id, '我的重命名')

        const after = cache.getSession(session.id)
        expect(after?.metadata?.name).toBe('我的重命名')
        // summary 必须被清除：web 端 getSessionDisplayName 优先级是 summary.text > name，
        // 若不清，旧摘要会盖住用户命名，表现为"提示成功但没生效"
        expect(after?.metadata?.summary).toBeUndefined()
    })

    test('重命名保留 metadata 其它字段（path/host/flavor）', async () => {
        const session = cache.getOrCreateSession(
            'tag-rename-2',
            {
                path: '/tmp/proj',
                host: 'host-2',
                flavor: 'claude',
                name: '旧名',
                summary: { text: '旧名', updatedAt: 1 },
            },
            null,
            'default'
        )

        await cache.renameSession(session.id, '新名')

        const after = cache.getSession(session.id)
        expect(after?.metadata).toMatchObject({
            path: '/tmp/proj',
            host: 'host-2',
            flavor: 'claude',
            name: '新名',
        })
        expect(after?.metadata?.summary).toBeUndefined()
    })

    test('对无 summary 的 session 重命名无副作用', async () => {
        const session = cache.getOrCreateSession(
            'tag-rename-3',
            { path: '/tmp/proj', host: 'host-3', name: '原名' },
            null,
            'default'
        )

        await cache.renameSession(session.id, '改名后')

        const after = cache.getSession(session.id)
        expect(after?.metadata?.name).toBe('改名后')
        expect(after?.metadata?.summary).toBeUndefined()
    })

    test('重命名后从数据库重新加载仍保持（持久化）', async () => {
        const session = cache.getOrCreateSession(
            'tag-rename-4',
            {
                path: '/tmp/proj',
                host: 'host-4',
                name: '自动',
                summary: { text: '自动', updatedAt: 1 },
            },
            null,
            'default'
        )

        await cache.renameSession(session.id, '持久化名')

        // 清掉内存缓存，强制从 DB 重新加载，验证 summary 清除已落库
        cache.getSessions() // 触发缓存存在
        // 直接从 store 读，绕过内存缓存
        const stored = store.sessions.getSession(session.id)
        const metadata = stored?.metadata as { name?: string; summary?: { text: string } } | null
        expect(metadata?.name).toBe('持久化名')
        expect(metadata?.summary).toBeUndefined()
    })
})

describe('SessionCache.handleContextUsage', () => {
    let store: Store
    let emits: { type: string; sessionId: string; data: unknown }[]
    let cache: SessionCache

    beforeEach(() => {
        store = new Store(':memory:')
        emits = []
        const rec = { emit: (e: { type: string; sessionId: string; data: unknown }) => emits.push(e) }
        cache = new SessionCache(store, rec as unknown as EventPublisher)
    })

    afterEach(() => {
        store.close()
    })

    const usage = {
        totalTokens: 124000, maxTokens: 200000, percentage: 62,
        autoCompactThreshold: 78, isAutoCompactEnabled: true,
        categories: [{ name: 'messages', tokens: 62000 }],
        apiUsage: null, costUsd: 0.043,
    }

    test('落库到 runtimeState.contextUsage 并 SSE 推送 runtimeState patch', () => {
        const session = cache.getOrCreateSession('tag-ctx-1', { path: '/tmp/p' }, null, 'default')

        cache.handleContextUsage({ sid: session.id, contextUsage: usage })

        // 内存层
        expect(cache.getSession(session.id)?.runtimeState?.contextUsage?.percentage).toBe(62)
        // 落库（直接读 store 绕过内存）
        const stored = store.sessions.getSession(session.id)
        expect((stored?.runtimeState as { contextUsage?: { percentage: number } })?.contextUsage?.percentage).toBe(62)
        // SSE 推送
        const pushed = emits.find(e => e.type === 'session-updated')
        expect(pushed).toBeTruthy()
        expect((pushed!.data as { runtimeState: { contextUsage: { percentage: number } } }).runtimeState.contextUsage.percentage).toBe(62)
    })

    test('不影响 runtimeState 其他字段（与 model 共存）', () => {
        const session = cache.getOrCreateSession('tag-ctx-2', { path: '/tmp/p' }, null, 'default', 'remote', { model: 'opus', effort: 'high' })

        cache.handleContextUsage({ sid: session.id, contextUsage: usage })

        const rs = cache.getSession(session.id)?.runtimeState
        expect(rs?.model).toBe('opus')
        expect(rs?.effort).toBe('high')
        expect(rs?.contextUsage?.percentage).toBe(62)
    })

    test('未知 sid 静默忽略（不抛错）', () => {
        expect(() => cache.handleContextUsage({ sid: 'no-such-session', contextUsage: usage })).not.toThrow()
        expect(emits).toHaveLength(0)
    })
})

describe('SessionCache.applyRefreshedSDKMetadata', () => {
    let store: Store
    let emits: { type: string; sessionId: string }[]
    let cache: SessionCache

    beforeEach(() => {
        store = new Store(':memory:')
        emits = []
        const rec = { emit: (e: { type: string; sessionId: string }) => emits.push(e) }
        cache = new SessionCache(store, rec as unknown as EventPublisher)
    })

    afterEach(() => {
        store.close()
    })

    const m1 = { commands: [{ name: 'a', description: 'da', argumentHint: '' }, { name: 'b', description: 'db', argumentHint: '' }] }
    // 与 m1 内容相同，但 commands 顺序颠倒——顺序无关应判等
    const m1Shuffled = { commands: [{ name: 'b', description: 'db', argumentHint: '' }, { name: 'a', description: 'da', argumentHint: '' }] }
    const m2 = { commands: [{ name: 'a', description: 'da', argumentHint: '' }, { name: 'b', description: 'db', argumentHint: '' }, { name: 'c', description: 'dc', argumentHint: '' }] }

    test('首次写入（无缓存）→ 写库 + 发 SSE，返回 true', () => {
        const session = cache.getOrCreateSession('tag-meta-1', { path: '/tmp/p' }, null, 'default')

        const changed = cache.applyRefreshedSDKMetadata(session.id, m1)

        expect(changed).toBe(true)
        expect(cache.getSession(session.id)?.metadata?.sdkMetadata).toEqual(m1)
        expect(emits.filter(e => e.type === 'sdk-metadata-refreshed')).toHaveLength(1)
    })

    test('内容相同（仅数组顺序不同）→ 不写不发，返回 false（打破 refetch↔SSE 循环）', () => {
        const session = cache.getOrCreateSession('tag-meta-2', { path: '/tmp/p' }, null, 'default')
        cache.applyRefreshedSDKMetadata(session.id, m1)
        emits.length = 0

        const changed = cache.applyRefreshedSDKMetadata(session.id, m1Shuffled)

        expect(changed).toBe(false)
        expect(emits).toHaveLength(0)
    })

    test('内容实际变化（新增命令）→ 写库 + 发 SSE，返回 true', () => {
        const session = cache.getOrCreateSession('tag-meta-3', { path: '/tmp/p' }, null, 'default')
        cache.applyRefreshedSDKMetadata(session.id, m1)
        emits.length = 0

        const changed = cache.applyRefreshedSDKMetadata(session.id, m2)

        expect(changed).toBe(true)
        expect(cache.getSession(session.id)?.metadata?.sdkMetadata).toEqual(m2)
        expect(emits.filter(e => e.type === 'sdk-metadata-refreshed')).toHaveLength(1)
    })
})
