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

import { describe, it, expect } from 'vitest'
import { createSessionLifecycle } from '@/agent/sessionLifecycle'
import type { ApiSessionClient } from '@/api/apiSession'
import type { SessionEndReason, SessionPauseTrigger } from '@mobi/shared'

/**
 * archiveAndClose 的 session-end 顺序契约（2026-09-30 事故）：sendSessionDeath 改为
 * ack 制后，close 必须等它确认落达（或超时兜底）才执行——裸 emit + 立即 close 会把
 * 事件丢在本地缓冲，hub 收不到 session-end，active 永久悬挂。
 *
 * SessionEndReason 契约（票 1.1）：endReason 随 metadata 归档与 session-end 载荷
 * 双通道上报——结构化字段（daemon 落库 sessions.end_reason）与自由文本 archiveReason
 * （人读细节）并存，互不替代。
 */

type DeathPayload = { endReason: SessionEndReason; pauseTrigger?: SessionPauseTrigger }

function makeFakeApiSession(order: string[], ackDelayMs: number, captures: {
    metadata?: Array<Record<string, unknown>>
    death?: Array<DeathPayload | undefined>
} = {}) {
    return {
        updateMetadata: (handler: (m: Record<string, unknown>) => Record<string, unknown>) => {
            captures.metadata?.push(handler({}))
        },
        sendSessionDeath: async (payload?: DeathPayload) => {
            captures.death?.push(payload)
            order.push('death:start')
            await new Promise((resolve) => setTimeout(resolve, ackDelayMs))
            order.push('death:acked')
        },
        flush: async () => { order.push('flush') },
        close: async () => { order.push('close') },
    } as unknown as ApiSessionClient
}

describe('runnerLifecycle cleanup 的 session-end 顺序', () => {
    it('close 必须等 sendSessionDeath 落达之后', async () => {
        const order: string[] = []
        const lifecycle = createSessionLifecycle({
            apiSession: makeFakeApiSession(order, 20),
            logTag: 'test',
        })

        await lifecycle.cleanup()

        expect(order.indexOf('death:acked')).toBeGreaterThanOrEqual(0)
        expect(order.indexOf('close')).toBeGreaterThan(order.indexOf('death:acked'))
    })
})

describe('SessionEndReason 单出口（票 1.1）', () => {
    it('默认退出 endReason=stop，随 metadata 与 session-end 双通道上报', async () => {
        const captures: { metadata: Array<Record<string, unknown>>; death: Array<DeathPayload | undefined> } = { metadata: [], death: [] }
        const lifecycle = createSessionLifecycle({
            apiSession: makeFakeApiSession([], 0, captures),
            logTag: 'test',
        })

        await lifecycle.cleanup()

        expect(captures.death[0]).toEqual({ endReason: 'stop', pauseTrigger: undefined })
        const archived = captures.metadata.at(-1)!
        expect(archived.endReason).toBe('stop')
        expect(archived.lifecycleState).toBe('archived')
    })

    it('setEndReason(pause, idle_timeout) → 双通道携带结构化字段，archiveReason 文本不丢', async () => {
        const captures: { metadata: Array<Record<string, unknown>>; death: Array<DeathPayload | undefined> } = { metadata: [], death: [] }
        const lifecycle = createSessionLifecycle({
            apiSession: makeFakeApiSession([], 0, captures),
            logTag: 'test',
        })

        lifecycle.setArchiveReason('Idle timeout')
        lifecycle.setEndReason('pause', 'idle_timeout')
        await lifecycle.cleanup()

        expect(captures.death[0]).toEqual({ endReason: 'pause', pauseTrigger: 'idle_timeout' })
        const archived = captures.metadata.at(-1)!
        expect(archived.endReason).toBe('pause')
        expect(archived.pauseTrigger).toBe('idle_timeout')
        expect(archived.archiveReason).toBe('Idle timeout')
    })

    it('markCrash → endReason=crash', async () => {
        const captures: { metadata: Array<Record<string, unknown>>; death: Array<DeathPayload | undefined> } = { metadata: [], death: [] }
        const lifecycle = createSessionLifecycle({
            apiSession: makeFakeApiSession([], 0, captures),
            logTag: 'test',
        })

        lifecycle.markCrash(new Error('boom'))
        await lifecycle.cleanup()

        expect(captures.death[0]).toEqual({ endReason: 'crash', pauseTrigger: undefined })
        expect(captures.metadata.at(-1)!.endReason).toBe('crash')
    })
})
