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
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useRotation } from '@/components/login/useRotation'

/** 构造可控 matchMedia mock（参考 useBootSequence.test.ts） */
function mockMatchMedia(matches: boolean) {
    return (query: string) => ({
        matches,
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
    })
}

describe('useRotation', () => {
    beforeEach(() => {
        vi.useFakeTimers()
        vi.stubGlobal('matchMedia', mockMatchMedia(false))
    })
    afterEach(() => {
        vi.useRealTimers()
        vi.unstubAllGlobals()
    })

    it('正常：在 values 间循环轮播（到末尾回到首个）', () => {
        const { result } = renderHook(() => useRotation(['a', 'b', 'c'], 100))
        expect(result.current).toBe('a')
        act(() => {
            vi.advanceTimersByTime(100)
        })
        expect(result.current).toBe('b')
        act(() => {
            vi.advanceTimersByTime(200)
        }) // 推进 2 个间隔 → c → a（循环）
        expect(result.current).toBe('a')
    })

    it('prefers-reduced-motion：固定首个，不轮播', () => {
        vi.stubGlobal('matchMedia', mockMatchMedia(true))
        const { result } = renderHook(() => useRotation(['a', 'b', 'c'], 100))
        expect(result.current).toBe('a')
        act(() => {
            vi.advanceTimersByTime(1000)
        })
        expect(result.current).toBe('a')
    })

    it('单值数组：固定首个，不轮播', () => {
        const { result } = renderHook(() => useRotation(['only'], 100))
        expect(result.current).toBe('only')
        act(() => {
            vi.advanceTimersByTime(500)
        })
        expect(result.current).toBe('only')
    })

    it('unmount 后定时器清理，值不再变化', () => {
        const { result, unmount } = renderHook(() =>
            useRotation(['a', 'b', 'c'], 100),
        )
        act(() => {
            vi.advanceTimersByTime(100)
        })
        expect(result.current).toBe('b')
        unmount()
        act(() => {
            vi.advanceTimersByTime(1000)
        })
        expect(result.current).toBe('b')
    })
})
