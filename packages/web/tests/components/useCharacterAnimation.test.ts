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
        // 推进到第一次偷瞄触发（2000ms）
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

    it('卸载后推进定时器不会触发 setState（内层 timer 已清理）', () => {
        // 捕获 React 在卸载后 setState 时打印的告警/错误
        const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
        try {
            const { unmount } = renderHook(
                () => useCharacterAnimation({ peek: true, hasToken: true, typing: true }),
            )
            // 推进到"眨眼中 / 偷瞄中 / 对视中"状态：外层 timer 已 fire、内层 timer pending
            act(() => { vi.advanceTimersByTime(2500) })
            unmount()
            // 卸载后大幅推进时间，让所有 pending 内层 timer 都过触发点
            act(() => { vi.advanceTimersByTime(10000) })

            const offendingCall = errorSpy.mock.calls.find((args) => {
                const msg = String(args[0] ?? '')
                return msg.includes("Can't perform a React state update on an unmounted")
                    || msg.includes('unmounted component')
            })
            expect(offendingCall).toBeUndefined()
        } finally {
            errorSpy.mockRestore()
        }
    })

    it('偷瞄中 peek 关闭立即停止（spec：peek/hasToken 关闭时立即复位）', () => {
        // 固定 Math.random → 偷瞄延时确定为 2000ms
        const spy = vi.spyOn(Math, 'random').mockReturnValue(0)
        try {
            const { rerender, result } = renderHook(
                (props) => useCharacterAnimation(props),
                { initialProps: { peek: true, hasToken: true, typing: false } },
            )
            // 推进到偷瞄激活（紫角色正在偷瞄）
            act(() => { vi.advanceTimersByTime(2000) })
            expect(result.current.isPurplePeeking).toBe(true)

            // peek 关闭 → 立即复位，不应等 800ms 自然结束
            rerender({ peek: false, hasToken: true, typing: false })
            expect(result.current.isPurplePeeking).toBe(false)

            // 推进超过原 800ms 复位点，确认不会被旧的内层 timer 重新触发
            act(() => { vi.advanceTimersByTime(1000) })
            expect(result.current.isPurplePeeking).toBe(false)
        } finally {
            spy.mockRestore()
        }
    })
})
