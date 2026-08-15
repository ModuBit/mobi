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

import { describe, it, expect, vi, afterEach } from 'vitest'
import { startPpidWatchdog } from '@/supervisor/ppidWatchdog'

describe('PPID 看门狗', () => {
    afterEach(() => {
        vi.useRealTimers()
    })

    it('父进程死亡 → 触发 onOrphaned 且停止轮询', () => {
        vi.useFakeTimers()
        let alive = true
        const onOrphaned = vi.fn()
        startPpidWatchdog({
            parentPid: 4242,
            intervalMs: 5_000,
            isAlive: () => alive,
            onOrphaned,
        })

        vi.advanceTimersByTime(20_000)
        expect(onOrphaned).not.toHaveBeenCalled()

        alive = false
        vi.advanceTimersByTime(5_000)
        expect(onOrphaned).toHaveBeenCalledTimes(1)

        // 停止后不再触发
        vi.advanceTimersByTime(30_000)
        expect(onOrphaned).toHaveBeenCalledTimes(1)
    })

    it('显式 stop 后不再触发', () => {
        vi.useFakeTimers()
        const onOrphaned = vi.fn()
        const stop = startPpidWatchdog({
            parentPid: 4242,
            intervalMs: 5_000,
            isAlive: () => false,
            onOrphaned,
        })
        stop()
        vi.advanceTimersByTime(60_000)
        expect(onOrphaned).not.toHaveBeenCalled()
    })
})
