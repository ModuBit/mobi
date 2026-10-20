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

import { describe, expect, it } from 'vitest'
import { LocalExecutor } from '../../src/executor/localExecutor'
import type { ExecutorBridge } from '../../src/executor/lifecycle'

/**
 * 预算闸来源穿透回归（候选③）：LocalExecutor 是 syncEngine → executor 核心之间
 * 唯一一跳，此前解构 options 时漏了 acquireReason——warm-on-open 的内层 yield
 * 实际退化成 user 语义（会逐别人的会话）。spawnSession 核心单测覆盖不到这一跳。
 */

function makeBridge(capture: Array<Record<string, unknown>>): ExecutorBridge {
    return {
        spawnSession: async (options) => {
            capture.push(options as unknown as Record<string, unknown>)
            return { type: 'success', sessionId: 's-resumed' }
        },
        stopSession: () => true,
        registerSessionTracking: () => undefined,
    }
}

describe('LocalExecutor.spawnSession 透传', () => {
    it('acquireReason 原样到达 spawn 请求（warm 语义不被降级为 user）', async () => {
        const capture: Array<Record<string, unknown>> = []
        const executor = new LocalExecutor(() => makeBridge(capture))

        await executor.spawnSession('/tmp/demo', { sessionId: 's1', acquireReason: 'warm' })

        expect(capture).toHaveLength(1)
        expect(capture[0].acquireReason).toBe('warm')
        expect(capture[0].directory).toBe('/tmp/demo')
        expect(capture[0].sessionId).toBe('s1')
    })

    it('未指定 acquireReason 时不臆造字段（核心侧按 user 缺省）', async () => {
        const capture: Array<Record<string, unknown>> = []
        const executor = new LocalExecutor(() => makeBridge(capture))

        await executor.spawnSession('/tmp/demo', {})

        expect(capture[0].acquireReason).toBeUndefined()
    })

    it('bridge 未接线 → 明确错误而非静默等待', async () => {
        const executor = new LocalExecutor(() => null)
        const result = await executor.spawnSession('/tmp/demo')

        expect(result.type).toBe('error')
        expect(result).toMatchObject({ message: 'Executor bridge is not wired' })
    })
})
