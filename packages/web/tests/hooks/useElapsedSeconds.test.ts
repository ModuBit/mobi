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
 * distributed under the License is distributed on an "AS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { act, renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { useElapsedSeconds } from '@/components/chat/useElapsedSeconds'

describe('useElapsedSeconds', () => {
    it('初始值为 0（startedAt = now）', () => {
        const now = Date.now()
        const { result } = renderHook(() => useElapsedSeconds(now))
        expect(result.current).toBe(0)
    })

    it('初始值正确计算已流逝的秒数', () => {
        const startedAt = Date.now() - 5000
        const { result } = renderHook(() => useElapsedSeconds(startedAt))
        expect(result.current).toBeGreaterThanOrEqual(5)
    })

    it('每秒触发刷新', () => {
        vi.useFakeTimers()
        vi.setSystemTime(new Date('2026-01-01T00:00:00Z'))
        const startedAt = Date.now()

        const { result } = renderHook(() => useElapsedSeconds(startedAt))

        expect(result.current).toBe(0)
        act(() => { vi.advanceTimersByTime(1000) })
        expect(result.current).toBe(1)
        act(() => { vi.advanceTimersByTime(2000) })
        expect(result.current).toBe(3)

        vi.useRealTimers()
    })

    it('startedAt 变化时立即同步更新，不等待 interval tick', () => {
        vi.useFakeTimers()
        vi.setSystemTime(new Date('2026-01-01T00:00:00Z'))
        const oldStartedAt = Date.now() - 10_000

        const { result, rerender } = renderHook(({ startedAt }) => useElapsedSeconds(startedAt), {
            initialProps: { startedAt: oldStartedAt },
        })
        expect(result.current).toBe(10)

        // startedAt 变为更早的时间 → elapsed 应立即增大
        const newStartedAt = Date.now() - 30_000
        act(() => { rerender({ startedAt: newStartedAt }) })
        expect(result.current).toBe(30)

        vi.useRealTimers()
    })
})