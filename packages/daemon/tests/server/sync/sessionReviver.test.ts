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
    waitForActive?: () => Promise<boolean>
}) {
    const spawned: Array<{ directory: string; options: Record<string, unknown> }> = []
    const activationErrors: Array<{ code: string; detail?: string }> = []
    let waited = 0
    const reviver = new SessionReviver({
        sessionCache: {
            resolveSessionAccess: () =>
                options.session
                    ? { ok: true as const, sessionId: options.session.id, session: options.session }
                    : { ok: false as const, reason: 'not-found' as const },
            getSession: () => options.session ?? undefined,
            refreshSession: () => options.session ?? null,
            mergeSessions: async () => undefined,
        },
        executor: {
            spawnSession: async (directory, spawnOptions) => {
                spawned.push({ directory, options: spawnOptions as unknown as Record<string, unknown> })
                return (options.spawnResult ?? { type: 'success', sessionId: 's1' }) as never
            },
        },
        isExecutorReady: () => true,
        markActivationError: (_sessionId, code, detail) => { activationErrors.push({ code, detail }) },
        waitForActive: async () => {
            waited += 1
            return options.waitForActive ? options.waitForActive() : true
        },
    })
    return { reviver, spawned, activationErrors, waited: () => waited }
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
})
