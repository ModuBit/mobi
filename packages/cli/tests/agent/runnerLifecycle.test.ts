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
import { createRunnerLifecycle } from '@/agent/runnerLifecycle'
import type { ApiSessionClient } from '@/api/apiSession'

/**
 * archiveAndClose 的 session-end 顺序契约（2026-09-30 事故）：sendSessionDeath 改为
 * ack 制后，close 必须等它确认落达（或超时兜底）才执行——裸 emit + 立即 close 会把
 * 事件丢在本地缓冲，hub 收不到 session-end，active 永久悬挂。
 */

function makeFakeApiSession(order: string[], ackDelayMs: number) {
    return {
        updateMetadata: () => {},
        sendSessionDeath: async () => {
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
        const lifecycle = createRunnerLifecycle({
            apiSession: makeFakeApiSession(order, 20),
            logTag: 'test',
        })

        await lifecycle.cleanup()

        expect(order.indexOf('death:acked')).toBeGreaterThanOrEqual(0)
        expect(order.indexOf('close')).toBeGreaterThan(order.indexOf('death:acked'))
    })
})
