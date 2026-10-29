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
 * SessionReviver 幽灵行善后（ghost recovery）单测：dedup 命中但 CLI 未附着时，
 * 修复前消息滞留 queued 无人善后（2026-10-29 生产事故——daemon 重启后幽灵表项
 * 阻塞唤醒，用户手动恢复才破局）。验证：延迟复查、prewarm 不善后、上限放弃、
 * 活跃即停、dispose 清定时器。
 */

const DORMANT_SESSION_ID = 'sess-ghost'
const RETRY_DELAY_MS = 10

function makeSession(active = false): Session {
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

type SpawnOutcome = { type: 'already-running' } | { type: 'success'; sessionId: string }

type Harness = {
    reviver: SessionReviver
    /** 每次 executor.spawnSession 的结果序列（dedup 命中记 'dedup'） */
    calls: SpawnOutcome[]
    setAttached: (attached: boolean) => void
    dispose: () => void
}

/**
 * 直接构造 reviver（不经 SyncEngine）。spawn 结果由 makeOutcome 决定：
 * 常规用例以「前 ghostSpawns 次 dedup、其后真 spawn」模拟幽灵行退场。
 */
function makeHarness(opts: {
    ghostSpawns?: number
    outcome?: (callIndex: number) => SpawnOutcome
    attached?: boolean
    maxAttempts?: number
} = {}): Harness {
    const calls: SpawnOutcome[] = []
    let attached = opts.attached ?? false
    const outcome = opts.outcome
        ?? ((i: number) => (i < (opts.ghostSpawns ?? 1) ? { type: 'already-running' } as const : { type: 'success', sessionId: DORMANT_SESSION_ID } as const))

    const deps: SessionReviverDeps = {
        sessionCache: {
            // isLive 先看 active 再看附着：假会话随 attached 翻转，语义与真实行一致
            resolveSessionAccess: (sessionId: string) =>
                sessionId === DORMANT_SESSION_ID
                    ? { ok: true as const, session: makeSession(attached), sessionId }
                    : { ok: false as const, reason: 'session_not_found' as const },
            getSession: () => makeSession(attached),
            refreshSession: () => makeSession(attached),
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
        const h = makeHarness({ ghostSpawns: 2 })
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
        const h = makeHarness({ ghostSpawns: 1 })
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
        const h = makeHarness({ ghostSpawns: 999 }) // 幽灵永不退场
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
        const h = makeHarness({ ghostSpawns: 999 })
        try {
            await h.reviver.revive(DORMANT_SESSION_ID, { intent: 'prewarm' })
            expect(h.calls).toHaveLength(1)
            expect(await waitFor(() => h.calls.length >= 2, 200)).toBe(false)
        } finally {
            h.dispose()
        }
    })

    test('复查次数到上限后放弃，不再无限重试', async () => {
        const h = makeHarness({ ghostSpawns: 999, maxAttempts: 2 })
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
