import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { RuntimeStateStore } from '../../src/sync/runtimeStateStore'
import { SessionCache } from '../../src/sync/sessionCache'
import { Store } from '../../src/store'
import type { Session } from '@mobi/shared/types'
import type { EventPublisher } from '../../src/sync/eventPublisher'

const stubPublisher = { emit: () => {} } as unknown as EventPublisher

/** 装配真 Store（:memory:）+ RuntimeStateStore，经 SessionCache 造一个可用的 session 内存对象 */
function setup() {
    const store = new Store(':memory:')
    const cache = new SessionCache(store, stubPublisher)
    const runtimeStateStore = new RuntimeStateStore(store)
    const session = cache.getOrCreateSession('tag-rss', { path: '/tmp/p' }, null, 'default')
    return { store, runtimeStateStore, session }
}

describe('RuntimeStateStore.merge', () => {
    let store: Store
    let runtimeStateStore: RuntimeStateStore
    let session: Session

    beforeEach(() => {
        ({ store, runtimeStateStore, session } = setup())
    })

    afterEach(() => {
        store.close()
    })

    test('写入路径三合一：落库 + 内存回填 + changed=true', () => {
        const { merged, changed } = runtimeStateStore.merge(session, { model: 'opus' })

        expect(changed).toBe(true)
        // 内存回填
        expect(session.runtimeState?.model).toBe('opus')
        expect(merged.model).toBe('opus')
        // 落库（直接读 store 绕过内存）
        const stored = store.sessions.getSession(session.id)
        expect((stored?.runtimeState as { model?: string })?.model).toBe('opus')
    })

    test('同值重写 → changed=false（DB 层判定：不变时跳过写库）', () => {
        runtimeStateStore.merge(session, { model: 'opus', effort: 'high' })
        const before = store.sessions.getSession(session.id)?.runtimeStateUpdatedAt

        const { changed } = runtimeStateStore.merge(session, { model: 'opus' })

        expect(changed).toBe(false)
        // 不变时 seq 不推进（store 层保证）
        expect(store.sessions.getSession(session.id)?.runtimeStateUpdatedAt).toBe(before)
    })

    test('patch 中未出现的字段保留 DB 现值（字段级合并非全量覆盖，#62 竞态根修）', () => {
        // DB 侧经「消息直写」路径有新 todos，内存 session.runtimeState 是陈旧快照
        store.sessions.mergeRuntimeState(session.id, { todos: [{ content: 't1', status: 'pending', activeForm: 'a' }] }, Date.now(), session.namespace)

        runtimeStateStore.merge(session, { model: 'opus' })

        // 合并结果未被内存陈旧快照抹掉
        expect(session.runtimeState?.todos).toHaveLength(1)
        expect(session.runtimeState?.model).toBe('opus')
    })

    test('patch 值 undefined = 清除该字段（contextUsage/goalStatus 清空语义）', () => {
        runtimeStateStore.merge(session, { contextUsage: { totalTokens: 1, maxTokens: 2, percentage: 50, costUsd: 0 } })

        runtimeStateStore.merge(session, { contextUsage: undefined })

        expect(session.runtimeState?.contextUsage).toBeUndefined()
        const stored = store.sessions.getSession(session.id)
        expect((stored?.runtimeState as { contextUsage?: unknown }).contextUsage).toBeUndefined()
    })

    test('写库失败（会话行消失）→ throw 且内存不脏（写序即实现，88da6179 回归）', () => {
        // 模拟并发删除：DB 行消失 → mergeRuntimeState 返回 null
        expect(store.sessions.deleteSession(session.id, session.namespace)).toBe(true)

        expect(() => runtimeStateStore.merge(session, { model: 'opus' })).toThrow()

        expect(session.runtimeState).toBeUndefined()
    })
})
