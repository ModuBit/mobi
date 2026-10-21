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
import { SessionReviver } from '../../../src/sync/sessionReviver'
import type { Session } from '@mobi/shared/types'

/**
 * 苏醒编排收口（候选④）+ 预算意图单源（候选③）：revive 的 intent 决定 acquireReason，
 * 映射只此一处；already-running 必须零等待；失败路径落 fork 错误档。
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
}) {
    const spawned: Array<{ directory: string; options: Record<string, unknown> }> = []
    const activationErrors: Array<{ code: string; detail?: string }> = []
    const detached: string[] = []
    let waited = 0
    const reviver = new SessionReviver({
        sessionCache: {
            resolveSessionAccess: () =>
                options.session
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
            mergeSessions: async () => undefined,
        },
        executor: {
            spawnSession: async (directory, spawnOptions) => {
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
        // 生产实现是 SessionCache.markDetached：内存行同步翻 inactive，这里照做的同时记账
        markDetached: (sessionId: string) => {
            detached.push(sessionId)
            if (options.session?.id === sessionId) options.session.active = false
        },
    })
    return { reviver, spawned, activationErrors, detached, waited: () => waited }
}

describe('SessionReviver — intent 到预算语义的单一映射', () => {
    test('intent=prewarm → acquireReason=warm（到顶 yield，不逐别人）', async () => {
        const { reviver, spawned } = makeReviver({ session: makeSession() })

        const result = await reviver.revive('s1', 'default', { intent: 'prewarm' })

        expect(result).toEqual({ type: 'success', sessionId: 's1' })
        expect(spawned[0].options.acquireReason).toBe('warm')
    })

    test('intent 缺省 = activate → acquireReason=user（永不拒绝）', async () => {
        const { reviver, spawned } = makeReviver({ session: makeSession() })

        await reviver.revive('s1', 'default')

        expect(spawned[0].options.acquireReason).toBe('user')
    })

    test('resume 参数组装：path/native token/model/effort/outputStyle 从会话行取', async () => {
        const { reviver, spawned } = makeReviver({ session: makeSession() })

        await reviver.revive('s1', 'default')

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

describe('SessionReviver — active 是心跳推断，连接事实优先', () => {
    test('active 但 CLI 未附着（强杀窗口）→ 就地纠正并照常唤醒', async () => {
        const { reviver, spawned, detached } = makeReviver({
            session: makeSession({ active: true }),
            isCliAttached: () => false,
        })

        const result = await reviver.wake('s1')

        expect(detached).toEqual(['s1'])
        expect(spawned).toHaveLength(1)
        expect(result).toEqual({ type: 'success', sessionId: 's1' })
    })

    test('active 且附着 → 不擦除激活态、不重复 spawn', async () => {
        const { reviver, spawned, detached } = makeReviver({
            session: makeSession({ active: true }),
            isCliAttached: () => true,
        })

        await reviver.wake('s1')

        expect(spawned).toHaveLength(0)
        expect(detached).toEqual([])
    })

    test('手动 revive 同判据：未附着的 active 会话也能被拉起', async () => {
        const { reviver, spawned } = makeReviver({
            session: makeSession({ active: true }),
            isCliAttached: () => false,
        })

        const result = await reviver.revive('s1', 'default')

        expect(result).toEqual({ type: 'success', sessionId: 's1' })
        expect(spawned).toHaveLength(1)
    })

    test('未注入探针（测试/直跑形态）→ 沿用旧语义：active 即视为活着', async () => {
        const { reviver, spawned, detached } = makeReviver({ session: makeSession({ active: true }) })

        await reviver.wake('s1')

        expect(spawned).toHaveLength(0)
        expect(detached).toEqual([])
    })
})

describe('SessionReviver — 结果语义', () => {
    test('already-running → 零等待 success（不得落 waitForActive）', async () => {
        const { reviver, waited } = makeReviver({
            session: makeSession(),
            spawnResult: { type: 'already-running' },
        })

        const result = await reviver.revive('s1', 'default')

        expect(result).toEqual({ type: 'success', sessionId: 's1' })
        expect(waited()).toBe(0)
    })

    test('spawn 失败 → resume_failed 且落激活错误档', async () => {
        const { reviver, activationErrors } = makeReviver({
            session: makeSession(),
            spawnResult: { type: 'error', message: 'boom' },
        })

        const result = await reviver.revive('s1', 'default')

        expect(result).toEqual({ type: 'error', message: 'boom', code: 'resume_failed' })
        expect(activationErrors).toEqual([{ code: 'activation-failed', detail: 'boom' }])
    })

    test('会话不存在 → session_not_found（不触达 spawn）', async () => {
        const { reviver, spawned } = makeReviver({ session: null })

        const result = await reviver.revive('missing', 'default')

        expect(result).toEqual({ type: 'error', message: 'Session not found', code: 'session_not_found' })
        expect(spawned).toHaveLength(0)
    })

    test('已 active → 直接 success（不重复 spawn）', async () => {
        const { reviver, spawned } = makeReviver({ session: makeSession({ active: true }) })

        const result = await reviver.revive('s1', 'default')

        expect(result).toEqual({ type: 'success', sessionId: 's1' })
        expect(spawned).toHaveLength(0)
    })
})

describe('SessionReviver.wake — 去重与容错', () => {
    test('同会话在途只触发一次 revive', async () => {
        const { reviver, spawned } = makeReviver({ session: makeSession() })

        reviver.wake('s1')
        reviver.wake('s1')
        await new Promise((resolve) => setTimeout(resolve, 10))

        expect(spawned).toHaveLength(1)
    })

    test('在途落定后可重试（失败不粘住去重）', async () => {
        const { reviver, spawned } = makeReviver({
            session: makeSession(),
            spawnResult: { type: 'error', message: 'boom' },
        })

        reviver.wake('s1')
        await new Promise((resolve) => setTimeout(resolve, 10))
        reviver.wake('s1')
        await new Promise((resolve) => setTimeout(resolve, 10))

        expect(spawned).toHaveLength(2)
    })

    test('会话查找抛错（缓存淘汰回源 DB 失败）→ 返回 error，wake 不 reject', async () => {
        const { reviver } = makeReviver({ lookupThrows: new Error('db locked') })

        await expect(reviver.wake('s1')).resolves.toEqual({
            type: 'error', message: 'db locked', code: 'resume_failed',
        })
    })

    test('archived（正在终结）的 already-running → 等进程退场后重新 spawn', async () => {
        const { reviver, spawned } = makeReviver({
            session: makeSession({ active: false, metadata: { path: '/tmp/demo', nativeSessionId: 'native-1', lifecycleState: 'archived' } as never }),
            spawnResults: [{ type: 'already-running' }, { type: 'success', sessionId: 's1' }],
        })

        const result = await reviver.wake('s1')

        expect(result).toEqual({ type: 'success', sessionId: 's1' })
        expect(spawned).toHaveLength(2)
    })
})
