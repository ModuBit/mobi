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

/**
 * 关停闩（架构评审候选⑧票①）的测试面 = 一次性：exited 只兑现一次、
 * cleanup 只挂一次——此前 handle.stop 与 exited.then 双入口各自做
 * if (!shutdownRequest) 幂等守卫，两处漂移即双跑清理。
 */

import { describe, it, expect, vi } from 'vitest'
import { ShutdownLatch } from '@/executor/shutdownLatch'

describe('ShutdownLatch', () => {
    it('首次 shutdown → exited 兑现 + cleanup 跑一次', async () => {
        const cleanup = vi.fn().mockResolvedValue(undefined)
        const latch = new ShutdownLatch<'a' | 'b'>(cleanup)

        await latch.shutdown('a', 'boom')

        expect(await latch.exited).toEqual({ source: 'a', errorMessage: 'boom' })
        expect(cleanup).toHaveBeenCalledTimes(1)
        expect(cleanup).toHaveBeenCalledWith('a', 'boom')
    })

    it('二次 shutdown（另一入口）→ exited 不变、cleanup 不重跑，返回同一 cleanup promise', async () => {
        const cleanup = vi.fn().mockResolvedValue(undefined)
        const latch = new ShutdownLatch(cleanup)

        const first = latch.shutdown('mobi-cli')
        const second = latch.shutdown('os-signal')
        await Promise.all([first, second])

        expect(cleanup).toHaveBeenCalledTimes(1)
        expect(await latch.exited).toEqual({ source: 'mobi-cli' })
    })

    it('cleanup 抛错不炸调用方（catch 吞掉并落日志）', async () => {
        const cleanup = vi.fn().mockRejectedValue(new Error('cleanup boom'))
        const latch = new ShutdownLatch(cleanup)

        await expect(latch.shutdown('exception')).resolves.toBeUndefined()
    })
})
