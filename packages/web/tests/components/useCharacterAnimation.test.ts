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
import { useCharacterAnimation } from '@/components/login/useCharacterAnimation'

describe('useCharacterAnimation', () => {
    beforeEach(() => vi.useFakeTimers())
    afterEach(() => vi.useRealTimers())

    it('typing=true 时进入对视，800ms 后退出', () => {
        const { rerender, result } = renderHook(
            (props) => useCharacterAnimation(props),
            { initialProps: { peek: false, hasToken: false, typing: false } },
        )
        expect(result.current.isLookingAtEachOther).toBe(false)

        rerender({ peek: false, hasToken: false, typing: true })
        expect(result.current.isLookingAtEachOther).toBe(true)

        act(() => { vi.advanceTimersByTime(800) })
        expect(result.current.isLookingAtEachOther).toBe(false)
    })

    it('peek && hasToken 时触发偷瞄周期', () => {
        // 固定 Math.random → 偷瞄延时确定为 2000ms（2000 + 0*3000）
        const spy = vi.spyOn(Math, 'random').mockReturnValue(0)
        const { rerender, result } = renderHook(
            (props) => useCharacterAnimation(props),
            { initialProps: { peek: false, hasToken: true, typing: false } },
        )
        expect(result.current.isPurplePeeking).toBe(false)

        rerender({ peek: true, hasToken: true, typing: false })
        // 推进到第一次偷瞄触发时刻（2000ms 处于激活区间 [2000, 2800)）
        act(() => { vi.advanceTimersByTime(2000) })
        expect(result.current.isPurplePeeking).toBe(true)
        // 800ms 后复位
        act(() => { vi.advanceTimersByTime(800) })
        expect(result.current.isPurplePeeking).toBe(false)
        spy.mockRestore()
    })

    it('hasToken 为空时不偷瞄，即使 peek=true', () => {
        const { result } = renderHook(
            () => useCharacterAnimation({ peek: true, hasToken: false, typing: false }),
        )
        act(() => { vi.advanceTimersByTime(6000) })
        expect(result.current.isPurplePeeking).toBe(false)
    })
})
