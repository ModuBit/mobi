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
import { SessionCache } from '../../../src/sync/sessionCache'
import { Store } from '../../../src/store'
import type { EventPublisher } from '../../../src/sync/eventPublisher'
import type { SDKMetadata } from '@mobi/shared'

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
        totalTokens: 124000, maxTokens: 200000, percentage: 62, costUsd: 0.043,
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

    test('contextUsage 为 null 时清空用量（/clear 后新会话从 0 开始）', () => {
        const session = cache.getOrCreateSession('tag-ctx-clear', { path: '/tmp/p' }, null, 'default')

        // 先有旧读数
        cache.handleContextUsage({ sid: session.id, contextUsage: usage })
        expect(cache.getSession(session.id)?.runtimeState?.contextUsage?.percentage).toBe(62)

        // /clear → 清空
        cache.handleContextUsage({ sid: session.id, contextUsage: null })

        // 内存层清空
        expect(cache.getSession(session.id)?.runtimeState?.contextUsage).toBeUndefined()
        // 落库也清空
        const stored = store.sessions.getSession(session.id)
        expect((stored?.runtimeState as { contextUsage?: unknown }).contextUsage).toBeUndefined()
        // SSE 推送（清空也推，让 web 隐藏用量线）
        const pushed = emits.filter(e => e.type === 'session-updated').pop()
        expect(pushed).toBeTruthy()
    })

    test('新上报成本为 0 且历史非 0 → 续用历史成本（进程重启/流式首轮不把 $ 刷成 0）', () => {
        const session = cache.getOrCreateSession('tag-ctx-cost', { path: '/tmp/p' }, null, 'default')
        cache.handleContextUsage({ sid: session.id, contextUsage: usage })

        // resume 后首个 assistant 的实时上报：CLI 侧累计成本记忆尚未建立
        cache.handleContextUsage({
            sid: session.id,
            contextUsage: { ...usage, totalTokens: 125000, costUsd: 0 },
        })
        expect(cache.getSession(session.id)?.runtimeState?.contextUsage?.costUsd).toBe(0.043)

        // 真实 result 到达 → 正常覆盖
        cache.handleContextUsage({ sid: session.id, contextUsage: { ...usage, costUsd: 0.06 } })
        expect(cache.getSession(session.id)?.runtimeState?.contextUsage?.costUsd).toBe(0.06)
    })

    test('清空后再报 0 成本 → 保持 0（/clear 已先 null，不复活旧成本）', () => {
        const session = cache.getOrCreateSession('tag-ctx-cost-clear', { path: '/tmp/p' }, null, 'default')
        cache.handleContextUsage({ sid: session.id, contextUsage: usage })
        cache.handleContextUsage({ sid: session.id, contextUsage: null })
        cache.handleContextUsage({ sid: session.id, contextUsage: { ...usage, totalTokens: 1000, costUsd: 0 } })
        expect(cache.getSession(session.id)?.runtimeState?.contextUsage?.costUsd).toBe(0)
    })
})

describe('SessionCache.handleSessionEnd · SessionEndReason 落库（票 1.1）', () => {
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

    test('pause + idle_timeout 落库 end_state 单列，SSE 携带结构化字段', () => {
        const session = cache.getOrCreateSession('tag-end-1', { path: '/tmp/p' }, null, 'default')
        const t = Date.now()
        // 激活在先（未激活会话的 session-end 走早退分支不广播，落库仍生效）
        cache.handleSessionAlive({ sid: session.id, time: t, running: false, mode: 'remote' })

        cache.handleSessionEnd({ sid: session.id, time: t, endReason: 'pause', pauseTrigger: 'idle_timeout' })

        const stored = store.sessions.getSession(session.id)
        expect(stored?.endReason).toBe('pause')
        expect(stored?.pauseTrigger).toBe('idle_timeout')
        expect(stored?.endedAt).toBe(t)

        // DB 形状：终结快照只落 end_state 一列（JSON），旧三列不再存在
        const db = (store as unknown as { db: import('bun:sqlite').Database }).db
        const raw = db.prepare('SELECT end_state FROM sessions WHERE id = ?').get(session.id) as { end_state: string }
        expect(JSON.parse(raw.end_state)).toEqual({ reason: 'pause', trigger: 'idle_timeout', at: t })
        const columns = (db.prepare('PRAGMA table_info(sessions)').all() as Array<{ name: string }>).map(c => c.name)
        expect(columns).not.toContain('end_reason')
        expect(columns).not.toContain('pause_trigger')
        expect(columns).not.toContain('ended_at')

        const pushed = emits.filter(e => e.type === 'session-updated').pop()
        expect((pushed!.data as { endReason: string }).endReason).toBe('pause')
        expect((pushed!.data as { pauseTrigger: string }).pauseTrigger).toBe('idle_timeout')
    })

    test('老 CLI 无载荷 → 按 stop 落库（保守进终结名单）', () => {
        const session = cache.getOrCreateSession('tag-end-2', { path: '/tmp/p' }, null, 'default')

        cache.handleSessionEnd({ sid: session.id, time: Date.now() })

        const stored = store.sessions.getSession(session.id)
        expect(stored?.endReason).toBe('stop')
        expect(stored?.pauseTrigger).toBeNull()
    })

    test('clearSessionEnd 唤醒时清终结字段（pause → 重新活跃）', () => {
        const session = cache.getOrCreateSession('tag-end-3', { path: '/tmp/p' }, null, 'default')

        cache.handleSessionEnd({ sid: session.id, time: Date.now(), endReason: 'pause', pauseTrigger: 'idle_timeout' })
        expect(store.sessions.getSession(session.id)?.endReason).toBe('pause')

        expect(store.sessions.clearSessionEnd(session.id, session.namespace)).toBeTrue()
        const cleared = store.sessions.getSession(session.id)
        expect(cleared?.endReason).toBeNull()
        expect(cleared?.endedAt).toBeNull()
    })

    test('终结字段内存投影：handleSessionEnd 同步内存 Session，refreshSession 从 DB 带回', () => {
        // 回归（warm-on-open 真机 E2E 实锤）：内存 Session 曾不带 endReason，
        // WarmOnOpenCoordinator.getSession() 读 endReason 恒 undefined → pause 判据永不满足
        const session = cache.getOrCreateSession('tag-end-4', { path: '/tmp/p' }, null, 'default')
        cache.handleSessionAlive({ sid: session.id, time: Date.now(), running: false, mode: 'remote' })
        const t = Date.now()

        cache.handleSessionEnd({ sid: session.id, time: t, endReason: 'pause', pauseTrigger: 'governor_evict' })

        // 内存行即时同步（不重读 DB 也要可判 pause 态）
        const inMemory = cache.getSession(session.id)
        expect(inMemory?.endReason).toBe('pause')
        expect(inMemory?.pauseTrigger).toBe('governor_evict')

        // daemon 重启形态：缓存 miss → refreshSession 从 stored 带回
        cache.refreshSession(session.id)
        expect(cache.getSession(session.id)?.endReason).toBe('pause')
    })

    test('session-alive 心跳激活即清终结字段（唤醒收口：DB + 内存同步）', () => {
        // 回归：clearSessionEnd 曾生产零调用——唤醒后 DB 残留 pause，daemon 重启后
        // Web 误显休眠 + warm-on-open 可对已唤醒会话重复触发
        const session = cache.getOrCreateSession('tag-end-5', { path: '/tmp/p' }, null, 'default')
        cache.handleSessionAlive({ sid: session.id, time: Date.now(), running: false, mode: 'remote' })
        cache.handleSessionEnd({ sid: session.id, time: Date.now(), endReason: 'pause', pauseTrigger: 'governor_evict' })
        expect(store.sessions.getSession(session.id)?.endReason).toBe('pause')

        // 唤醒后第一条心跳：终结字段必须清掉（DB 与内存行同步）
        cache.handleSessionAlive({ sid: session.id, time: Date.now(), running: false, mode: 'remote' })
        expect(store.sessions.getSession(session.id)?.endReason).toBeNull()
        expect(cache.getSession(session.id)?.endReason).toBeNull()
        expect(cache.getSession(session.id)?.active).toBeTrue()
    })
})


describe('SessionCache.handleCacheStatus', () => {
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

    const status = { expired: true, contextTokens: 24000, secondsSinceLastResponse: 3720, estimatedCacheWriteUsd: 0.12, observedAt: 1_700_000_000_000 }

    test('落库到 runtimeState.cacheStatus 并 SSE 推送 runtimeState patch', () => {
        const session = cache.getOrCreateSession('tag-cache-1', { path: '/tmp/p' }, null, 'default')

        cache.handleCacheStatus({ sid: session.id, cacheStatus: status })

        // 内存层
        expect(cache.getSession(session.id)?.runtimeState?.cacheStatus).toEqual(status)
        // 落库（直接读 store 绕过内存）
        const stored = store.sessions.getSession(session.id)
        expect((stored?.runtimeState as { cacheStatus?: { expired: boolean } })?.cacheStatus?.expired).toBe(true)
        // SSE 推送
        const pushed = emits.find(e => e.type === 'session-updated')
        expect(pushed).toBeTruthy()
        expect((pushed!.data as { runtimeState: { cacheStatus: { contextTokens: number } } }).runtimeState.cacheStatus.contextTokens).toBe(24000)
    })

    test('不影响 runtimeState 其他字段（与 model/goalStatus 共存）', () => {
        const session = cache.getOrCreateSession(
            'tag-cache-2', { path: '/tmp/p' }, null, 'default', 'remote', { model: 'opus', effort: 'high' }
        )

        cache.handleCacheStatus({ sid: session.id, cacheStatus: status })

        const rs = cache.getSession(session.id)?.runtimeState
        expect(rs?.model).toBe('opus')
        expect(rs?.effort).toBe('high')
        expect(rs?.cacheStatus).toEqual(status)
    })

    test('未知 sid 静默忽略（不抛错）', () => {
        expect(() => cache.handleCacheStatus({ sid: 'no-such-session', cacheStatus: status })).not.toThrow()
        expect(emits).toHaveLength(0)
    })

    test('cacheStatus 为 null 时清空（首个 result 帧 CLI 清除的 hub 侧落地）', () => {
        const session = cache.getOrCreateSession('tag-cache-clear', { path: '/tmp/p' }, null, 'default')

        // 先有旧状态
        cache.handleCacheStatus({ sid: session.id, cacheStatus: status })
        expect(cache.getSession(session.id)?.runtimeState?.cacheStatus).toEqual(status)

        // 清空
        cache.handleCacheStatus({ sid: session.id, cacheStatus: null })

        // 内存层清空
        expect(cache.getSession(session.id)?.runtimeState?.cacheStatus).toBeUndefined()
        // 落库也清空
        const stored = store.sessions.getSession(session.id)
        expect((stored?.runtimeState as { cacheStatus?: unknown }).cacheStatus).toBeUndefined()
        // SSE 推送（清空也推，让 web 隐藏提示 chip）
        const pushed = emits.filter(e => e.type === 'session-updated').pop()
        expect(pushed).toBeTruthy()
    })
})

describe('SessionCache.handleWakeup（wakeup-source spec）', () => {
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

    test('落库到 runtimeState.lastWakeup 并 SSE 推送 runtimeState patch', () => {
        const session = cache.getOrCreateSession('tag-wakeup-1', { path: '/tmp/p' }, null, 'default')

        cache.handleWakeup({ sid: session.id, source: 'loop_wakeup' })

        // 内存层
        const rs = cache.getSession(session.id)?.runtimeState?.lastWakeup
        expect(rs?.source).toBe('loop_wakeup')
        expect(typeof rs?.at).toBe('number')
        // 落库（直接读 store 绕过内存）
        const stored = store.sessions.getSession(session.id)
        expect((stored?.runtimeState as { lastWakeup?: { source: string } })?.lastWakeup?.source).toBe('loop_wakeup')
        // SSE 推送
        const pushed = emits.find(e => e.type === 'session-updated')
        expect(pushed).toBeTruthy()
        expect((pushed!.data as { runtimeState: { lastWakeup: { source: string } } }).runtimeState.lastWakeup.source).toBe('loop_wakeup')
    })

    test('覆盖写：第二次自醒替换第一次（只保留最近一次）', () => {
        const session = cache.getOrCreateSession('tag-wakeup-2', { path: '/tmp/p' }, null, 'default')

        cache.handleWakeup({ sid: session.id, source: 'loop_wakeup' })
        cache.handleWakeup({ sid: session.id, source: 'schedule_wakeup' })

        const rs = cache.getSession(session.id)?.runtimeState?.lastWakeup
        expect(rs?.source).toBe('schedule_wakeup')
        expect(store.sessions.getSession(session.id)?.runtimeState && (store.sessions.getSession(session.id)!.runtimeState as { lastWakeup?: { source: string } }).lastWakeup?.source).toBe('schedule_wakeup')
    })

    test('不影响 runtimeState 其他字段共存', () => {
        const session = cache.getOrCreateSession(
            'tag-wakeup-3', { path: '/tmp/p' }, null, 'default', 'remote', { model: 'opus', effort: 'high' }
        )

        cache.handleWakeup({ sid: session.id, source: 'schedule_wakeup' })

        const rs = cache.getSession(session.id)?.runtimeState
        expect(rs?.model).toBe('opus')
        expect(rs?.effort).toBe('high')
        expect(rs?.lastWakeup?.source).toBe('schedule_wakeup')
    })

    test('未知 sid 静默忽略（不抛错）', () => {
        expect(() => cache.handleWakeup({ sid: 'no-such-session', source: 'loop_wakeup' })).not.toThrow()
        expect(emits).toHaveLength(0)
    })
})

describe('SessionCache.handleFastModeState', () => {
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

    test('落库到 runtimeState.fastModeState / fastModeDisabledReason 并 SSE 推送', () => {
        const session = cache.getOrCreateSession('tag-fm-1', { path: '/tmp/p' }, null, 'default')

        cache.handleFastModeState({ sid: session.id, fastModeState: 'cooldown', fastModeDisabledReason: 'extra_usage_disabled' })

        const rs = cache.getSession(session.id)?.runtimeState
        expect(rs?.fastModeState).toBe('cooldown')
        expect(rs?.fastModeDisabledReason).toBe('extra_usage_disabled')
        const stored = store.sessions.getSession(session.id)?.runtimeState as { fastModeState?: string } | undefined
        expect(stored?.fastModeState).toBe('cooldown')
        expect(emits.find(e => e.type === 'session-updated')).toBeTruthy()
    })

    test('不影响同名的用户意图字段 fastMode 与其他 runtimeState', () => {
        const session = cache.getOrCreateSession(
            'tag-fm-2', { path: '/tmp/p' }, null, 'default', 'remote', { model: 'opus', fastMode: true }
        )

        cache.handleFastModeState({ sid: session.id, fastModeState: 'on' })

        const rs = cache.getSession(session.id)?.runtimeState
        expect(rs?.fastMode).toBeTrue()
        expect(rs?.fastModeState).toBe('on')
        expect(rs?.model).toBe('opus')
    })

    test('state 为 null 时连同原因一起清空（恢复 on 后不残留旧原因）', () => {
        const session = cache.getOrCreateSession('tag-fm-3', { path: '/tmp/p' }, null, 'default')

        cache.handleFastModeState({ sid: session.id, fastModeState: 'off', fastModeDisabledReason: 'free' })
        cache.handleFastModeState({ sid: session.id, fastModeState: null })

        const rs = cache.getSession(session.id)?.runtimeState
        expect(rs?.fastModeState).toBeUndefined()
        expect(rs?.fastModeDisabledReason).toBeUndefined()
    })

    test('state 为 on 时丢弃陈旧 reason（不写入）', () => {
        const session = cache.getOrCreateSession('tag-fm-4', { path: '/tmp/p' }, null, 'default')

        cache.handleFastModeState({ sid: session.id, fastModeState: 'on', fastModeDisabledReason: 'pending' })

        expect(cache.getSession(session.id)?.runtimeState?.fastModeDisabledReason).toBeUndefined()
    })

    test('未知 sid 静默忽略（不抛错、不推送）', () => {
        expect(() => cache.handleFastModeState({ sid: 'no-such-session', fastModeState: 'on' })).not.toThrow()
        expect(emits).toHaveLength(0)
    })
})

describe('SessionCache.handleRunStarted（docs/pending.md #55 方案 1）', () => {
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

    test('落库到 runtimeState.runStartedAt 并 SSE 推送 runtimeState patch', () => {
        const session = cache.getOrCreateSession('tag-run-1', { path: '/tmp/p' }, null, 'default')

        cache.handleRunStarted({ sid: session.id, runStartedAt: 1755800000000 })

        // 内存层
        expect(cache.getSession(session.id)?.runtimeState?.runStartedAt).toBe(1755800000000)
        // 落库（直接读 store 绕过内存）
        const stored = store.sessions.getSession(session.id)
        expect((stored?.runtimeState as { runStartedAt?: number })?.runStartedAt).toBe(1755800000000)
        // SSE 推送
        const pushed = emits.find(e => e.type === 'session-updated')
        expect(pushed).toBeTruthy()
        expect((pushed!.data as { runtimeState: { runStartedAt: number } }).runtimeState.runStartedAt).toBe(1755800000000)
    })

    test('不影响 runtimeState 其他字段（与 contextUsage/model 共存）', () => {
        const session = cache.getOrCreateSession(
            'tag-run-2', { path: '/tmp/p' }, null, 'default', 'remote', { model: 'opus', effort: 'high' }
        )

        cache.handleRunStarted({ sid: session.id, runStartedAt: 1755800000000 })

        const rs = cache.getSession(session.id)?.runtimeState
        expect(rs?.model).toBe('opus')
        expect(rs?.effort).toBe('high')
        expect(rs?.runStartedAt).toBe(1755800000000)
    })

    test('running 在途时重报旧值（CLI 重连重投递等）→ 静默忽略，不落库不推送（防计时起点回跳）', () => {
        const session = cache.getOrCreateSession('tag-run-3', { path: '/tmp/p' }, null, 'default')
        // 上一轮仍在跑（keepAlive running=true）——此时旧值重报只可能是陈旧重投递
        cache.handleSessionAlive({ sid: session.id, time: Date.now(), running: true })

        cache.handleRunStarted({ sid: session.id, runStartedAt: 1755800000200 })
        cache.handleRunStarted({ sid: session.id, runStartedAt: 1755800000100 })

        expect(cache.getSession(session.id)?.runtimeState?.runStartedAt).toBe(1755800000200)
        // 只数 runStarted 推送的 runtimeState patch（handleSessionAlive 的 alive 广播不计入）
        const runStartedPushes = emits.filter(e =>
            e.type === 'session-updated' && (e.data as { runtimeState?: unknown }).runtimeState !== undefined)
        expect(runStartedPushes).toHaveLength(1)
    })

    test('轮次结束后新上报早于存量值（时钟偏慢的机器接管）→ 接受（防计时起点永久陈旧）', () => {
        const session = cache.getOrCreateSession('tag-run-4', { path: '/tmp/p' }, null, 'default')
        cache.handleSessionAlive({ sid: session.id, time: Date.now(), running: true })
        cache.handleRunStarted({ sid: session.id, runStartedAt: 1755800000200 })
        // 上一轮结束（keepAlive running=false），新轮次起点上报——CLI 只在翻转 false→true
        // 时上报，这必是新轮次；Date.now() 取自 CLI 机器，时钟偏差/NTP 回拨可能早于存量值
        cache.handleSessionAlive({ sid: session.id, time: Date.now(), running: false })
        cache.handleRunStarted({ sid: session.id, runStartedAt: 1755800000100 })

        expect(cache.getSession(session.id)?.runtimeState?.runStartedAt).toBe(1755800000100)
        const runStartedPushes = emits.filter(e =>
            e.type === 'session-updated' && (e.data as { runtimeState?: unknown }).runtimeState !== undefined)
        expect(runStartedPushes).toHaveLength(2)
    })

    test('未知 sid 静默忽略（不抛错）', () => {
        expect(() => cache.handleRunStarted({ sid: 'no-such-session', runStartedAt: 1755800000000 })).not.toThrow()
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

    test('expectedVersion 与当前 metadataVersion 不匹配 → 放弃写（防 stale RPC 覆盖并发写入）', () => {
        const session = cache.getOrCreateSession('tag-meta-4', { path: '/tmp/p' }, null, 'default')
        cache.applyRefreshedSDKMetadata(session.id, m1) // 首次写：metadataVersion +1
        emits.length = 0

        // 模拟后台 RPC 发起后、apply 前别处写入：当前 version 已 > 发起时快照
        const staleVersion = cache.getSession(session.id)!.metadataVersion - 1
        const changed = cache.applyRefreshedSDKMetadata(session.id, m2, staleVersion)

        expect(changed).toBe(false)
        // m2 是 stale 结果，不应覆盖 m1
        expect(cache.getSession(session.id)?.metadata?.sdkMetadata).toEqual(m1)
        expect(emits).toHaveLength(0)
    })

    test('SDK model 含 ModelInfoSchema 未声明字段（resolvedModel/supportsEffort 等）→ 内容相同应判等（打破 strip 致 refetch↔SSE 死循环）', () => {
        // 复现真实 bug：SDK initializationResult 返回的 model 有 9 个字段，但
        // ModelInfoSchema 只声明 value/displayName/description，refreshSession 的
        // MetadataSchema.safeParse（Zod 默认 strip）裁掉其余 6 个，内存 cachedSdk
        // 永远 ≠ RPC newSdk，相等闸永不闭合 → 死循环。
        const mWithFullModel = {
            models: [{
                value: 'opus',
                displayName: 'Opus',
                description: 'd',
                resolvedModel: 'claude-opus-4-8',
                supportsEffort: true,
                supportedEffortLevels: ['low', 'medium', 'high', 'xhigh', 'max'],
                supportsAdaptiveThinking: true,
                supportsFastMode: true,
                supportsAutoMode: true,
            }],
        } as unknown as SDKMetadata

        const session = cache.getOrCreateSession('tag-meta-model', { path: '/tmp/p' }, null, 'default')
        cache.applyRefreshedSDKMetadata(session.id, mWithFullModel)
        emits.length = 0

        // 同一内容再 apply：应判等，不写不发
        const changed = cache.applyRefreshedSDKMetadata(session.id, mWithFullModel)

        expect(changed).toBe(false)
        expect(emits).toHaveLength(0)
    })

    test('SDK 含 Schema 完全未声明的未来字段 → raw stored 比较，仍判等（免疫 SDK 升级新增字段）', () => {
        // 防御：即便 SDKMetadataSchema 补全了已知字段，SDK 升级仍可能新增 Schema 未声明的字段。
        // apply 必须用 raw stored.metadata.sdkMetadata 比较，而非 MetadataSchema strip 后的内存值，
        // 否则相等闸再次失真、死循环重演。
        const mWithFutureField = {
            commands: [{ name: 'x', description: 'dx', argumentHint: '' }],
            futureUnknownField: { anyShape: [1, 2, 3] },
        } as unknown as SDKMetadata

        const session = cache.getOrCreateSession('tag-meta-future', { path: '/tmp/p' }, null, 'default')
        cache.applyRefreshedSDKMetadata(session.id, mWithFutureField)
        emits.length = 0

        const changed = cache.applyRefreshedSDKMetadata(session.id, mWithFutureField)

        expect(changed).toBe(false)
        expect(emits).toHaveLength(0)
    })
})

describe('SessionCache.refreshSession 携带 pinned', () => {
    let store: Store
    let cache: SessionCache

    beforeEach(() => {
        store = new Store(':memory:')
        cache = new SessionCache(store, stubPublisher)
    })

    afterEach(() => {
        store.close()
    })

    test('内存 Session 带 pinned（默认 false），DB 置顶后 refreshSession 反映 true', () => {
        // 回归：refreshSession 曾漏填 pinned，导致 GET /sessions 与 SSE session-updated 载荷的
        // toSessionSummary 读 session.pinned 恒 undefined → 全局缓存反复抹掉 pinned
        const session = cache.getOrCreateSession('tag-pin', { path: '/tmp/p' }, null, 'default')
        expect(cache.getSession(session.id)?.pinned).toBe(false)

        // DB 层置顶（与 syncEngine.setSessionPinned 同路径：store → refreshSession → 广播）
        expect(store.sessions.setSessionPinned(session.id, true, 'default')).toBe('changed')

        // refreshSession 必须把 stored.pinned 带回内存 Session
        const refreshed = cache.refreshSession(session.id)
        expect(refreshed?.pinned).toBe(true)
        expect(cache.getSession(session.id)?.pinned).toBe(true)
    })
})

describe('SessionCache.handleSessionAlive outputStyle 落库', () => {
    let store: Store
    let cache: SessionCache

    beforeEach(() => {
        store = new Store(':memory:')
        cache = new SessionCache(store, stubPublisher)
    })

    afterEach(() => {
        store.close()
    })

    test('keep-alive 携带 outputStyle 时落 runtimeState（resume 回放的数据源）', () => {
        const session = cache.getOrCreateSession('tag-style-1', { path: '/tmp/p' }, null, 'default')

        cache.handleSessionAlive({ sid: session.id, time: Date.now(), running: false, outputStyle: 'Concise' })

        // 内存层
        expect(cache.getSession(session.id)?.runtimeState?.outputStyle).toBe('Concise')
        // 落库（直接读 store 绕过内存）——进程重启后 resume 链路从这里回放
        const stored = store.sessions.getSession(session.id)
        expect((stored?.runtimeState as { outputStyle?: string })?.outputStyle).toBe('Concise')
    })

    test('不带 outputStyle 的 keep-alive 不覆盖已有值（undefined 语义 = 未变化）', () => {
        const session = cache.getOrCreateSession(
            'tag-style-2', { path: '/tmp/p' }, null, 'default', 'remote', { outputStyle: 'Concise' }
        )

        cache.handleSessionAlive({ sid: session.id, time: Date.now(), running: true })

        expect(cache.getSession(session.id)?.runtimeState?.outputStyle).toBe('Concise')
    })
})

describe('SessionCache.handleSessionAlive permissionMode 落库', () => {
    let store: Store
    let cache: SessionCache

    beforeEach(() => {
        store = new Store(':memory:')
        cache = new SessionCache(store, stubPublisher)
    })

    afterEach(() => {
        store.close()
    })

    test('keep-alive 携带 permissionMode 时落 runtimeState（resume 回放的数据源）', () => {
        const session = cache.getOrCreateSession('tag-perm-1', { path: '/tmp/p' }, null, 'default')

        cache.handleSessionAlive({ sid: session.id, time: Date.now(), running: false, permissionMode: 'acceptEdits' })

        // 内存层（顶层快照 + runtimeState 双写）
        expect(cache.getSession(session.id)?.permissionMode).toBe('acceptEdits')
        expect(cache.getSession(session.id)?.runtimeState?.permissionMode).toBe('acceptEdits')
        // 落库（直接读 store 绕过内存）——hub 重启后 resume 链路从这里回放
        const stored = store.sessions.getSession(session.id)
        expect((stored?.runtimeState as { permissionMode?: string })?.permissionMode).toBe('acceptEdits')
    })

    test('hub 重启后 refreshSession 从 runtimeState.permissionMode 恢复顶层快照', () => {
        const session = cache.getOrCreateSession('tag-perm-2', { path: '/tmp/p' }, null, 'default')

        cache.handleSessionAlive({ sid: session.id, time: Date.now(), running: false, permissionMode: 'plan' })

        // 模拟 hub 重启：新 cache 实例（内存全空），从同一 DB warmup
        const revivedCache = new SessionCache(store, stubPublisher)
        revivedCache.warmupCache()

        expect(revivedCache.getSession(session.id)?.permissionMode).toBe('plan')
    })

    test('不带 permissionMode 的 keep-alive 不覆盖已有值（undefined 语义 = 未变化）', () => {
        const session = cache.getOrCreateSession(
            'tag-perm-3', { path: '/tmp/p' }, null, 'default', 'remote', { permissionMode: 'plan' }
        )

        cache.handleSessionAlive({ sid: session.id, time: Date.now(), running: true })

        expect(cache.getSession(session.id)?.runtimeState?.permissionMode).toBe('plan')
    })
})

describe('permissionMode 持久化 — code-review 收口', () => {
    let store: Store
    let cache: SessionCache

    beforeEach(() => {
        store = new Store(':memory:')
        cache = new SessionCache(store, stubPublisher)
    })

    afterEach(() => {
        store.close()
    })

    test('applySessionConfig 切换 permissionMode 同样双写落库（对齐 model/effort 路径）', () => {
        // code-review：web 侧切换只写内存顶层快照、依赖 keep-alive 回流落库——CLI 掉线期间 hub
        // 重启则丢。同函数内 model/effort 都走 updateRuntimeStateField，permissionMode 不该例外
        const session = cache.getOrCreateSession('tag-perm-4', { path: '/tmp/p' }, null, 'default')

        cache.applySessionConfig(session.id, { permissionMode: 'plan' })

        expect(cache.getSession(session.id)?.permissionMode).toBe('plan')
        const stored = store.sessions.getSession(session.id)
        expect((stored?.runtimeState as { permissionMode?: string })?.permissionMode).toBe('plan')
    })

    test('handleSessionAlive 落库失败时顶层快照不脏写（内存与 DB 不分叉）', () => {
        // code-review：先写 session.permissionMode 再 updateRuntimeStateField（内部 setRuntimeState
        // 未命中即 throw），异常路径下内存已是新值而 DB 留旧值。顺序应与 model/effort 一致：落库成功后才写内存
        const session = cache.getOrCreateSession('tag-perm-5', { path: '/tmp/p' }, null, 'default')
        // 模拟并发删除：DB 行消失 → setRuntimeState UPDATE 未命中 → throw
        expect(store.sessions.deleteSession(session.id, 'default')).toBe(true)

        expect(() => cache.handleSessionAlive({
            sid: session.id, time: Date.now(), running: false, permissionMode: 'plan',
        })).toThrow()

        expect(cache.getSession(session.id)?.permissionMode).toBeUndefined()
        expect(cache.getSession(session.id)?.runtimeState?.permissionMode).toBeUndefined()
    })
})

describe('SessionCache.deleteSession fork 守卫（isSessionRowDeletable，fork-session spec §4.3）', () => {
    let store: Store
    let cache: SessionCache

    beforeEach(() => {
        store = new Store(':memory:')
        cache = new SessionCache(store, stubPublisher)
    })

    afterEach(() => {
        store.close()
    })

    test('active 的待激活 fork 行（forkFrom 在场、非 running）可删——fork 行未激活不算 active', async () => {
        const session = cache.getOrCreateSession('tag-fork-del-1', {
            path: '/tmp/p',
            host: 'h',
            forkFrom: { parentSessionId: 'parent-1', parentNativeId: 'pn-1', anchorNativeId: 'an-1' },
            forkedFrom: { sessionId: 'parent-1' },
        }, null, 'default')

        // keep-alive 置 active（首条消息触发 spawn 的中间态），未 running
        cache.handleSessionAlive({ sid: session.id, time: Date.now(), running: false })
        expect(cache.getSession(session.id)?.active).toBe(true)

        await expect(cache.deleteSession(session.id)).resolves.toBeUndefined()
    })

    test('running 中的 fork 行不可删（spawn 进行中，防孤儿 CLI 进程）', async () => {
        const session = cache.getOrCreateSession('tag-fork-del-2', {
            path: '/tmp/p',
            host: 'h',
            forkFrom: { parentSessionId: 'parent-1', parentNativeId: 'pn-1', anchorNativeId: 'an-1' },
        }, null, 'default')

        cache.handleSessionAlive({ sid: session.id, time: Date.now(), running: true })

        await expect(cache.deleteSession(session.id)).rejects.toThrow('Cannot delete active session')
    })

    test('active 的常规会话（无 forkFrom）仍不可删（既有守卫不变）', async () => {
        const session = cache.getOrCreateSession('tag-fork-del-3', { path: '/tmp/p', host: 'h' }, null, 'default')
        cache.handleSessionAlive({ sid: session.id, time: Date.now(), running: false })

        await expect(cache.deleteSession(session.id)).rejects.toThrow('Cannot delete active session')
    })
})

describe('SessionCache.getSessionByNamespace 缓存 miss 回落数据库', () => {
    let store: Store
    let cache: SessionCache

    beforeEach(() => {
        store = new Store(':memory:')
        cache = new SessionCache(store, stubPublisher)
    })

    afterEach(() => {
        store.close()
    })

    test('被驱逐后仍查得到——「有，但它没在跑」不能说成「没有这个会话」', () => {
        const session = cache.getOrCreateSession('tag-evicted-1', { path: '/tmp/p', host: 'h1' }, null, 'default')

        // 推进 2 小时：先翻 inactive，再被驱逐（行仍在 DB）
        cache.expireInactive(Date.now() + 2 * 3_600_000)
        expect(cache.getSession(session.id)).toBeUndefined()

        // 列表侧（getSessionsByNamespace）按 DB 列得出来，单个查询侧口径必须一致——
        // 不一致时调用方会同时收到「没有这个会话」和列表里明摆着的那一条，只会加固错误结论
        const found = cache.getSessionByNamespace(session.id, 'default')
        expect(found?.id).toBe(session.id)
        expect(found?.active).toBe(false)
    })

    test('namespace 不匹配仍然查不到（回落不放松鉴权）', () => {
        const session = cache.getOrCreateSession('tag-evicted-2', { path: '/tmp/p', host: 'h1' }, null, 'ns-a')
        cache.expireInactive(Date.now() + 2 * 3_600_000)

        expect(cache.getSessionByNamespace(session.id, 'ns-b')).toBeUndefined()
    })
})

describe('SessionCache.markDetached — 心跳过期纠正陈旧 active', () => {
    function makeCache() {
        const store = new Store(':memory:')
        const emitted: Array<{ type: string; sessionId?: string; data?: unknown }> = []
        const cache = new SessionCache(store, {
            emit: (event: { type: string; sessionId?: string; data?: unknown }) => { emitted.push(event) },
        } as unknown as EventPublisher)
        return { store, cache, emitted }
    }

    test('active 会话被就地判死：active/running 清零并广播 active:false', () => {
        const { store, cache, emitted } = makeCache()
        const session = cache.getOrCreateSession('tag-detach-1', { path: '/tmp/p' }, null, 'default')
        cache.handleSessionAlive({ sid: session.id, time: Date.now(), running: true, mode: 'remote' })
        emitted.length = 0

        cache.markDetached(session.id)

        expect(cache.getSession(session.id)?.active).toBe(false)
        expect(cache.getSession(session.id)?.running).toBe(false)
        expect(emitted).toEqual([
            { type: 'session-updated', sessionId: session.id, data: { active: false } },
        ])
        store.close()
    })

    test('幂等：已 inactive 的会话不重复广播', () => {
        const { store, cache, emitted } = makeCache()
        const session = cache.getOrCreateSession('tag-detach-2', { path: '/tmp/p' }, null, 'default')
        emitted.length = 0

        cache.markDetached(session.id)

        expect(emitted).toEqual([])
        store.close()
    })

    test('expireInactive 仍按心跳过期翻 inactive（共用同一纠正路径）', () => {
        const { store, cache } = makeCache()
        const session = cache.getOrCreateSession('tag-detach-3', { path: '/tmp/p' }, null, 'default')
        cache.handleSessionAlive({ sid: session.id, time: Date.now(), running: true, mode: 'remote' })

        const gone = cache.expireInactive(Date.now() + 31_000)

        expect(gone).toContain(session.id)
        expect(cache.getSession(session.id)?.active).toBe(false)
        store.close()
    })
})

describe('SessionCache.applySessionConfig 广播载荷形状', () => {
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

    test('只推 runtimeState，不发完整 session（完整对象是「分组归属变更」的信号）', () => {
        // 载荷形状即语义：web 收到带 id 的完整 session 会连带重拉工作区/最近/置顶/各工作区间
        // 会话分组——2026-10-28 实测一次档位切换 1 POST + 10 GET
        const session = cache.getOrCreateSession('tag-cfg-payload-1', { path: '/tmp/p' }, null, 'default')
        emits.length = 0

        cache.applySessionConfig(session.id, { effort: 'high' })

        const pushed = emits.find(e => e.type === 'session-updated')
        expect(pushed).toBeTruthy()
        expect(Object.keys(pushed!.data as Record<string, unknown>)).toEqual(['runtimeState'])
        expect((pushed!.data as { runtimeState: Record<string, unknown> }).runtimeState.effort).toBe('high')
    })

    test('休眠会话配置暂存同样只推 runtimeState', () => {
        const session = cache.getOrCreateSession('tag-cfg-payload-2', { path: '/tmp/p' }, null, 'default')
        emits.length = 0

        cache.applyDormantConfig(session.id, { model: 'opus' })

        const pushed = emits.find(e => e.type === 'session-updated')
        expect(pushed).toBeTruthy()
        expect(Object.keys(pushed!.data as Record<string, unknown>)).toEqual(['runtimeState'])
    })
})
