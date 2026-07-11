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
import { useBootSequence } from '@/components/login/useBootSequence'

/** 构造可控 matchMedia mock（参考 tests/lib/vconsole.test.ts） */
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

describe('useBootSequence', () => {
    beforeEach(() => {
        vi.useFakeTimers()
        vi.stubGlobal('matchMedia', mockMatchMedia(false))
    })
    afterEach(() => {
        vi.useRealTimers()
        vi.unstubAllGlobals()
    })

    it('正常：逐行显示，最终全部显示且 done=true', () => {
        const lines = [
            { id: 'a', node: 'a' },
            { id: 'b', node: 'b' },
            { id: 'c', node: 'c' },
        ]
        const { result } = renderHook(() => useBootSequence(lines, 150))

        expect(result.current.visibleCount).toBe(0)
        expect(result.current.done).toBe(false)

        act(() => { vi.advanceTimersByTime(150) })
        expect(result.current.visibleCount).toBe(1)

        act(() => { vi.advanceTimersByTime(300) }) // 再推进 2 个间隔
        expect(result.current.visibleCount).toBe(3)
        expect(result.current.done).toBe(true)
    })

    it('prefers-reduced-motion：立即全部显示', () => {
        vi.stubGlobal('matchMedia', mockMatchMedia(true))
        const lines = [{ id: 'a', node: 'a' }, { id: 'b', node: 'b' }]
        const { result } = renderHook(() => useBootSequence(lines, 150))

        expect(result.current.visibleCount).toBe(2)
        expect(result.current.done).toBe(true)
    })

    it('空行数组：done=true，visibleCount=0', () => {
        const { result } = renderHook(() => useBootSequence([], 150))
        expect(result.current.visibleCount).toBe(0)
        expect(result.current.done).toBe(true)
    })

    it('unmount 后定时器清理，visibleCount 不再增长', () => {
        const lines = [
            { id: 'a', node: 'a' },
            { id: 'b', node: 'b' },
        ]
        const { result, unmount } = renderHook(() =>
            useBootSequence(lines, 150),
        )
        act(() => { vi.advanceTimersByTime(150) })
        expect(result.current.visibleCount).toBe(1)
        unmount()
        act(() => { vi.advanceTimersByTime(1000) })
        // 清理后不再增长
        expect(result.current.visibleCount).toBe(1)
    })
})
