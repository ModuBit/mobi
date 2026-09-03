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
})

describe('SessionCache.handleGoalStatus', () => {
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

    const goal = { met: false, condition: '所有测试通过' }

    test('落库到 runtimeState.goalStatus 并 SSE 推送 runtimeState patch', () => {
        const session = cache.getOrCreateSession('tag-goal-1', { path: '/tmp/p' }, null, 'default')

        cache.handleGoalStatus({ sid: session.id, goalStatus: goal })

        // 内存层
        expect(cache.getSession(session.id)?.runtimeState?.goalStatus).toEqual(goal)
        // 落库（直接读 store 绕过内存）
        const stored = store.sessions.getSession(session.id)
        expect((stored?.runtimeState as { goalStatus?: { met: boolean; condition: string } })?.goalStatus).toEqual(goal)
        // SSE 推送
        const pushed = emits.find(e => e.type === 'session-updated')
        expect(pushed).toBeTruthy()
        expect((pushed!.data as { runtimeState: { goalStatus: { met: boolean } } }).runtimeState.goalStatus.met).toBe(false)
    })

    test('不影响 runtimeState 其他字段（与 contextUsage/model 共存）', () => {
        const session = cache.getOrCreateSession(
            'tag-goal-2', { path: '/tmp/p' }, null, 'default', 'remote', { model: 'opus', effort: 'high' }
        )

        cache.handleGoalStatus({ sid: session.id, goalStatus: goal })

        const rs = cache.getSession(session.id)?.runtimeState
        expect(rs?.model).toBe('opus')
        expect(rs?.effort).toBe('high')
        expect(rs?.goalStatus).toEqual(goal)
    })

    test('未知 sid 静默忽略（不抛错）', () => {
        expect(() => cache.handleGoalStatus({ sid: 'no-such-session', goalStatus: goal })).not.toThrow()
        expect(emits).toHaveLength(0)
    })

    test('goalStatus 为 null 时清空（达成后/手动清理后从吊顶消失）', () => {
        const session = cache.getOrCreateSession('tag-goal-clear', { path: '/tmp/p' }, null, 'default')

        // 先有旧状态
        cache.handleGoalStatus({ sid: session.id, goalStatus: goal })
        expect(cache.getSession(session.id)?.runtimeState?.goalStatus).toEqual(goal)

        // 清空
        cache.handleGoalStatus({ sid: session.id, goalStatus: null })

        // 内存层清空
        expect(cache.getSession(session.id)?.runtimeState?.goalStatus).toBeUndefined()
        // 落库也清空
        const stored = store.sessions.getSession(session.id)
        expect((stored?.runtimeState as { goalStatus?: unknown }).goalStatus).toBeUndefined()
        // SSE 推送（清空也推，让 web 隐藏 goal 吊顶）
        const pushed = emits.filter(e => e.type === 'session-updated').pop()
        expect(pushed).toBeTruthy()
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

        cache.handleSessionAlive({ sid: session.id, time: Date.now(), running: false, outputStyle: 'concise' })

        // 内存层
        expect(cache.getSession(session.id)?.runtimeState?.outputStyle).toBe('concise')
        // 落库（直接读 store 绕过内存）——进程重启后 resume 链路从这里回放
        const stored = store.sessions.getSession(session.id)
        expect((stored?.runtimeState as { outputStyle?: string })?.outputStyle).toBe('concise')
    })

    test('不带 outputStyle 的 keep-alive 不覆盖已有值（undefined 语义 = 未变化）', () => {
        const session = cache.getOrCreateSession(
            'tag-style-2', { path: '/tmp/p' }, null, 'default', 'remote', { outputStyle: 'concise' }
        )

        cache.handleSessionAlive({ sid: session.id, time: Date.now(), running: true })

        expect(cache.getSession(session.id)?.runtimeState?.outputStyle).toBe('concise')
    })
})
