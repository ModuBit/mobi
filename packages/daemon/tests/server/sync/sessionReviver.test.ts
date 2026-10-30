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

import { SessionReviver, type SessionReviverDeps } from '../../../src/sync/sessionReviver'
import type { LocalExecutor } from '../../../src/executor/localExecutor'
import type { SessionCache } from '../../../src/sync/sessionCache'
import type { Session } from '@mobi/shared/types'

/**
 * 苏醒编排收口（候选④）+ 预算意图单源（候选③）+ 单入口在途闸（2026-10-21 双进程事故）：
 * revive 是唯一入口，activate/prewarm 共用一把闸且用户操作不并入预热；already-running
 * 必须零等待；异常一律结构化为 error result（永不 reject）。
 *
 * 幽灵行善后（ghost recovery，2026-10-29 生产事故）单独一组 describe：dedup 命中
 * 但 CLI 未附着时延迟复查、prewarm 不善后、上限放弃、活跃即停、dispose 清定时器。
 */

function makeSession(overrides: Partial<Session> = {}): Session {
    return {
        id: 's1',
        namespace: 'default',
        seq: 1,
        createdAt: 1,
        updatedAt: 2,
        active: false,
        activeAt: 0,
        metadata: { path: '/tmp/demo', nativeSessionId: 'native-1' },
        metadataVersion: 1,
        agentState: null,
        agentStateVersion: 1,
        running: false,
        runningAt: 0,
        runtimeState: { model: 'model-x', effort: 'high', outputStyle: 'Concise' },
        tag: 'tag',
        workspaceId: null,
        pinned: false,
        endReason: 'pause',
        pauseTrigger: 'idle_timeout',
        endedAt: 3,
        ...overrides,
    } as Session
}

function makeReviver(options: {
    session?: Session | null
    spawnResult?: unknown
    /** 依次消费的 spawn 结果（覆盖 spawnResult），用于 already-running → 退场后再 spawn 类用例 */
    spawnResults?: unknown[]
    waitForActive?: () => Promise<boolean>
    /** 模拟缓存淘汰后回源 DB 抛错 */
    lookupThrows?: Error
    /** CLI socket 附着探针（缺省视为附着 = 旧语义「active 即活着」） */
    isCliAttached?: (sessionId: string) => boolean
    /** spawn 挂起闸：resolve 前 spawnSession 不返回（并发用例控制落定顺序） */
    spawnGate?: Promise<void>
    /** spawnSession 直接抛错（RPC 层异常） */
    spawnThrows?: Error
    /** resolveSessionAccess 拒绝（越权/不存在） */
    accessDenied?: boolean
}) {
    const spawned: Array<{ directory: string; options: Record<string, unknown> }> = []
    const activationErrors: Array<{ code: string; detail?: string }> = []
    const merges: Array<[string, string]> = []
    const redelivered: string[] = []
    let waited = 0
    const reviver = new SessionReviver({
        sessionCache: {
            resolveSessionAccess: () =>
                options.accessDenied
                    ? { ok: false as const, reason: 'access-denied' as const }
                    : options.session
                        ? { ok: true as const, sessionId: options.session.id, session: options.session }
                        : { ok: false as const, reason: 'not-found' as const },
            getSession: () => {
                if (options.lookupThrows) throw options.lookupThrows
                return options.session ?? undefined
            },
            refreshSession: () => {
                if (options.lookupThrows) throw options.lookupThrows
                return options.session ?? null
            },
            mergeSessions: async (oldId: string, newId: string) => { merges.push([oldId, newId]) },
        },
        executor: {
            spawnSession: async (directory, spawnOptions) => {
                if (options.spawnGate) await options.spawnGate
                if (options.spawnThrows) throw options.spawnThrows
                spawned.push({ directory, options: spawnOptions as unknown as Record<string, unknown> })
                const next = options.spawnResults?.shift()
                return (next ?? options.spawnResult ?? { type: 'success', sessionId: 's1' }) as never
            },
        },
        isExecutorReady: () => true,
        markActivationError: (_sessionId, code, detail) => { activationErrors.push({ code, detail }) },
        waitForActive: async () => {
            waited += 1
            return options.waitForActive ? options.waitForActive() : true
        },
        isCliAttached: options.isCliAttached ?? (() => true),
        redeliverQueued: (sessionId: string) => { redelivered.push(sessionId) },
    })
    return { reviver, spawned, activationErrors, merges, redelivered, waited: () => waited }
}

describe('SessionReviver — intent 到预算语义的单一映射', () => {
    test('intent=prewarm → acquireReason=warm（到顶 yield，不逐别人）', async () => {
        const { reviver, spawned } = makeReviver({ session: makeSession() })

        const result = await reviver.revive('s1', { namespace: 'default', intent: 'prewarm' })

        expect(result).toEqual({ type: 'success', sessionId: 's1' })
        expect(spawned[0].options.acquireReason).toBe('warm')
    })

    test('intent 缺省 = activate → acquireReason=user（永不拒绝）', async () => {
        const { reviver, spawned } = makeReviver({ session: makeSession() })

        await reviver.revive('s1', { namespace: 'default' })

        expect(spawned[0].options.acquireReason).toBe('user')
    })

    test('resume 参数组装：path/native token/model/effort/outputStyle 从会话行取', async () => {
        const { reviver, spawned } = makeReviver({ session: makeSession() })

        await reviver.revive('s1', { namespace: 'default' })

        expect(spawned[0].directory).toBe('/tmp/demo')
        expect(spawned[0].options).toMatchObject({
            sessionId: 's1',
            resumeSessionId: 'native-1',
            model: 'model-x',
            effort: 'high',
            outputStyle: 'Concise',
        })
    })
})

describe('SessionReviver — 单入口在途闸（手动恢复 / 发消息唤醒 / 预热共用）', () => {
    test('同会话并发两次 revive → 只 spawn 一次（两路共享同一 Promise）', async () => {
        const { reviver, spawned } = makeReviver({ session: makeSession() })

        const [a, b] = await Promise.all([
            reviver.revive('s1', { namespace: 'default' }),
            reviver.revive('s1'),
        ])

        expect(spawned).toHaveLength(1)
        expect(a).toEqual({ type: 'success', sessionId: 's1' })
        expect(b).toEqual(a)
    })

    test('在途 prewarm 时用户 activate 到达 → 另起一次（不继承 governor yield 结果）', async () => {
        let releaseGate: () => void = () => {}
        const gate = new Promise<void>((resolve) => { releaseGate = resolve })
        const { reviver, spawned } = makeReviver({ session: makeSession(), spawnGate: gate })

        const warm = reviver.revive('s1', { namespace: 'default', intent: 'prewarm' })
        const activate = reviver.revive('s1', { namespace: 'default' })

        releaseGate()
        await Promise.all([warm, activate])

        expect(spawned).toHaveLength(2)
        expect(spawned.map((s) => s.options.acquireReason)).toEqual(['warm', 'user'])
    })

    test('在途 activate 时 prewarm 到达 → 复用在途（不重复 spawn）', async () => {
        let releaseGate: () => void = () => {}
        const gate = new Promise<void>((resolve) => { releaseGate = resolve })
        const { reviver, spawned } = makeReviver({ session: makeSession(), spawnGate: gate })

        const activate = reviver.revive('s1', { namespace: 'default' })
        const warm = reviver.revive('s1', { intent: 'prewarm' })

        releaseGate()
        await Promise.all([activate, warm])

        expect(spawned).toHaveLength(1)
        expect(spawned[0].options.acquireReason).toBe('user')
    })

    test('在途落定后可重试（失败不粘住去重）', async () => {
        const { reviver, spawned } = makeReviver({
            session: makeSession(),
            spawnResult: { type: 'error', message: 'boom' },
        })

        await reviver.revive('s1', { namespace: 'default' })
        await reviver.revive('s1', { namespace: 'default' })

        expect(spawned).toHaveLength(2)
    })

    test('并入在途条目也要验归属：无 namespace 的调用在途时，带 namespace 的并入方拿到 access_denied', async () => {
        // 内部唤醒/预热（无 namespace）先发起，reviveInner 不会做归属校验；
        // 随后带 namespace 的 web 请求并入同一 Promise——校验必须由并入方自己补一次
        let releaseGate: () => void = () => {}
        const gate = new Promise<void>((resolve) => { releaseGate = resolve })
        const { reviver, spawned } = makeReviver({
            session: makeSession(),
            spawnGate: gate,
            accessDenied: true,
        })

        const internal = reviver.revive('s1')
        const joined = reviver.revive('s1', { namespace: 'other' })

        await expect(joined).resolves.toEqual({ type: 'error', message: 'Session access denied', code: 'access_denied' })
        releaseGate()
        await expect(internal).resolves.toEqual({ type: 'success', sessionId: 's1' })
        // 在途编排只起一次（并入没有额外 spawn）
        expect(spawned).toHaveLength(1)
    })
})

describe('SessionReviver — active 是心跳推断，连接事实优先', () => {
    test('active 但 CLI 未附着（强杀窗口）→ 照常唤醒；读路径不改缓存（可能只是瞬时断线）', async () => {
        const session = makeSession({ active: true })
        const { reviver, spawned } = makeReviver({
            session,
            isCliAttached: () => false,
        })

        const result = await reviver.revive('s1')

        expect(spawned).toHaveLength(1)
        expect(session.active).toBe(true)   // 死亡由心跳过期收口，读路径只读不写
        expect(result).toEqual({ type: 'success', sessionId: 's1' })
    })

    test('active 且附着 → 不擦除激活态、不重复 spawn', async () => {
        const { reviver, spawned } = makeReviver({
            session: makeSession({ active: true }),
            isCliAttached: () => true,
        })

        await reviver.revive('s1')

        expect(spawned).toHaveLength(0)
    })

    test('缺省探针视为附着 → 沿用旧语义：active 即视为活着', async () => {
        const { reviver, spawned } = makeReviver({ session: makeSession({ active: true }) })

        await reviver.revive('s1')

        expect(spawned).toHaveLength(0)
    })
})

describe('SessionReviver — 会话 id 归并后的补投', () => {
    test('resume 以新 id 上线 → 归并后补投新 id（附着补投先于归并，搬过来的 queued 消息需再触发）', async () => {
        const { reviver, merges, redelivered } = makeReviver({
            session: makeSession(),
            spawnResult: { type: 'success', sessionId: 's2' },
        })

        await reviver.revive('s1', { namespace: 'default' })

        expect(merges).toEqual([['s1', 's2']])
        expect(redelivered).toEqual(['s2'])
    })

    test('id 未变（无需归并）→ 不重复补投（附着回调已负责）', async () => {
        const { reviver, merges, redelivered } = makeReviver({ session: makeSession() })

        await reviver.revive('s1', { namespace: 'default' })

        expect(merges).toEqual([])
        expect(redelivered).toEqual([])
    })
})

describe('SessionReviver — 结果语义', () => {
    test('already-running → 零等待 success（不得落 waitForActive）', async () => {
        const { reviver, waited } = makeReviver({
            session: makeSession(),
            spawnResult: { type: 'already-running' },
        })

        try {
            const result = await reviver.revive('s1', { namespace: 'default' })

            expect(result).toEqual({ type: 'success', sessionId: 's1' })
            expect(waited()).toBe(0)
        } finally {
            // dedup 分支会安排 ghost 复查 timer，断言后清掉不留悬挂回调
            reviver.dispose()
        }
    })

    test('spawn 失败 → resume_failed 且落激活错误档', async () => {
        const { reviver, activationErrors } = makeReviver({
            session: makeSession(),
            spawnResult: { type: 'error', message: 'boom' },
        })

        const result = await reviver.revive('s1', { namespace: 'default' })

        expect(result).toEqual({ type: 'error', message: 'boom', code: 'resume_failed' })
        expect(activationErrors).toEqual([{ code: 'activation-failed', detail: 'boom' }])
    })

    test('会话不存在 → session_not_found（不触达 spawn）', async () => {
        const { reviver, spawned } = makeReviver({ session: null })

        const result = await reviver.revive('missing', { namespace: 'default' })

        expect(result).toEqual({ type: 'error', message: 'Session not found', code: 'session_not_found' })
        expect(spawned).toHaveLength(0)
    })

    test('namespace 校验失败 → access_denied（web 路由语义）', async () => {
        const { reviver, spawned } = makeReviver({ session: makeSession(), accessDenied: true })

        const result = await reviver.revive('s1', { namespace: 'other' })

        expect(result).toEqual({ type: 'error', message: 'Session access denied', code: 'access_denied' })
        expect(spawned).toHaveLength(0)
    })

    test('已 active → 直接 success（不重复 spawn）', async () => {
        const { reviver, spawned } = makeReviver({ session: makeSession({ active: true }) })

        const result = await reviver.revive('s1', { namespace: 'default' })

        expect(result).toEqual({ type: 'success', sessionId: 's1' })
        expect(spawned).toHaveLength(0)
    })
})

describe('SessionReviver — 容错（永不 reject）', () => {
    test('会话查找抛错（缓存淘汰回源 DB 失败）→ 返回 error，不 reject', async () => {
        const { reviver } = makeReviver({ lookupThrows: new Error('db locked') })

        await expect(reviver.revive('s1')).resolves.toEqual({
            type: 'error', message: 'db locked', code: 'resume_failed',
        })
    })

    test('executor.spawnSession 抛错 → 结构化为 resume_failed，不 reject', async () => {
        const { reviver } = makeReviver({ session: makeSession(), spawnThrows: new Error('rpc down') })

        await expect(reviver.revive('s1', { namespace: 'default' })).resolves.toEqual({
            type: 'error', message: 'rpc down', code: 'resume_failed',
        })
    })

    test('archived（正在终结）的 already-running → 等进程退场后重新 spawn', async () => {
        const { reviver, spawned } = makeReviver({
            session: makeSession({ active: false, metadata: { path: '/tmp/demo', nativeSessionId: 'native-1', lifecycleState: 'archived' } as never }),
            spawnResults: [{ type: 'already-running' }, { type: 'success', sessionId: 's1' }],
        })

        const result = await reviver.revive('s1', { namespace: 'default' })

        expect(result).toEqual({ type: 'success', sessionId: 's1' })
        expect(spawned).toHaveLength(2)
    })
})

// ==================== 幽灵行善后（ghost recovery，2026-10-29 生产事故） ====================

const DORMANT_SESSION_ID = 'sess-ghost'
const RETRY_DELAY_MS = 10

function makeGhostSession(active = false): Session {
    return {
        id: DORMANT_SESSION_ID,
        namespace: 'default',
        active,
        endReason: 'pause',
        metadata: { path: '/tmp/proj', nativeSessionId: 'native-1', lifecycleState: 'running' },
        updatedAt: Date.now(),
        createdAt: Date.now(),
    } as unknown as Session
}

type GhostSpawnOutcome = { type: 'already-running' } | { type: 'success'; sessionId: string }

type GhostHarness = {
    reviver: SessionReviver
    /** 每次 executor.spawnSession 的结果序列（dedup 命中记 'dedup'） */
    calls: GhostSpawnOutcome[]
    setAttached: (attached: boolean) => void
    dispose: () => void
}

/**
 * 直接构造 reviver（不经 SyncEngine）。spawn 结果由 makeOutcome 决定：
 * 常规用例以「前 ghostSpawns 次 dedup、其后真 spawn」模拟幽灵行退场。
 */
function makeGhostHarness(opts: {
    ghostSpawns?: number
    outcome?: (callIndex: number) => GhostSpawnOutcome
    attached?: boolean
    maxAttempts?: number
} = {}): GhostHarness {
    const calls: GhostSpawnOutcome[] = []
    let attached = opts.attached ?? false
    const outcome = opts.outcome
        ?? ((i: number) => (i < (opts.ghostSpawns ?? 1) ? { type: 'already-running' } as const : { type: 'success', sessionId: DORMANT_SESSION_ID } as const))

    const deps: SessionReviverDeps = {
        sessionCache: {
            // isLive 先看 active 再看附着：假会话随 attached 翻转，语义与真实行一致
            resolveSessionAccess: (sessionId: string) =>
                sessionId === DORMANT_SESSION_ID
                    ? { ok: true as const, session: makeGhostSession(attached), sessionId }
                    : { ok: false as const, reason: 'session_not_found' as const },
            getSession: () => makeGhostSession(attached),
            refreshSession: () => makeGhostSession(attached),
            mergeSessions: async () => {},
        } as unknown as Pick<SessionCache, 'resolveSessionAccess' | 'getSession' | 'refreshSession' | 'mergeSessions'>,
        executor: {
            spawnSession: async () => {
                const result = outcome(calls.length)
                calls.push(result)
                return result as never
            },
        } as unknown as Pick<LocalExecutor, 'spawnSession'>,
        isExecutorReady: () => true,
        markActivationError: () => {},
        waitForActive: async () => true,
        isCliAttached: () => attached,
        redeliverQueued: () => {},
    }

    const reviver = new SessionReviver(deps, { ghostRetryDelayMs: RETRY_DELAY_MS, ghostRetryMaxAttempts: opts.maxAttempts })
    return { reviver, calls, setAttached: (v: boolean) => { attached = v }, dispose: () => reviver.dispose() }
}

/** 轮询直到条件成立（ghost recovery 由定时器驱动，测试用短间隔轮询等待） */
async function waitFor(cond: () => boolean, timeoutMs = 2_000): Promise<boolean> {
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
        if (cond()) return true
        await new Promise((resolve) => setTimeout(resolve, 10))
    }
    return false
}

describe('SessionReviver ghost recovery（dedup 命中未附着的善后）', () => {
    test('dedup 命中 → 延迟复查再 spawn，幽灵退场后恢复成功', async () => {
        // 前 2 次报 already-running（幽灵存活），第 3 次放行（幽灵退场）
        const h = makeGhostHarness({ ghostSpawns: 2 })
        try {
            const result = await h.reviver.revive(DORMANT_SESSION_ID)
            expect(result.type).toBe('success') // 首次 dedup 仍按既有语义返回 success
            expect(h.calls).toHaveLength(1)

            // 善后复查自动推进：幽灵退场后真 spawn 发生
            expect(await waitFor(() => h.calls.length >= 3)).toBe(true)
        } finally {
            h.dispose()
        }
    })

    test('恢复成功后停止复查（不再产生新 spawn）', async () => {
        const h = makeGhostHarness({ ghostSpawns: 1 })
        try {
            await h.reviver.revive(DORMANT_SESSION_ID)
            expect(await waitFor(() => h.calls.length >= 2)).toBe(true)
            const settled = h.calls.length
            await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS * 5))
            expect(h.calls.length).toBe(settled)
        } finally {
            h.dispose()
        }
    })

    test('会话重新附着后复查直接 no-op，不再 spawn', async () => {
        const h = makeGhostHarness({ ghostSpawns: 999 }) // 幽灵永不退场
        try {
            await h.reviver.revive(DORMANT_SESSION_ID)
            expect(h.calls).toHaveLength(1)
            // CLI 附着到位（旧进程重连成功）→ 复查在 isLive 处 no-op
            h.setAttached(true)
            expect(await waitFor(() => h.calls.length >= 2, 500)).toBe(false)
            expect(h.calls).toHaveLength(1)
        } finally {
            h.dispose()
        }
    })

    test('prewarm dedup 不安排善后（预热不是承诺，放弃即止）', async () => {
        const h = makeGhostHarness({ ghostSpawns: 999 })
        try {
            await h.reviver.revive(DORMANT_SESSION_ID, { intent: 'prewarm' })
            expect(h.calls).toHaveLength(1)
            expect(await waitFor(() => h.calls.length >= 2, 200)).toBe(false)
        } finally {
            h.dispose()
        }
    })

    test('复查次数到上限后放弃，不再无限重试', async () => {
        const h = makeGhostHarness({ ghostSpawns: 999, maxAttempts: 2 })
        try {
            await h.reviver.revive(DORMANT_SESSION_ID)
            // 首次 dedup + 2 次复查 = 3 次调用，随后放弃不再增长
            expect(await waitFor(() => h.calls.length >= 3)).toBe(true)
            const settled = h.calls.length
            await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS * 10))
            expect(h.calls.length).toBe(settled)
        } finally {
            h.dispose()
        }
    })
})
