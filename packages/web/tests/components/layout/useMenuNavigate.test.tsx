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
import { renderHook, cleanup } from '@testing-library/react'

import { useMenuNavigate } from '@/components/layout/useMenuNavigate'
import { useUiStore } from '@/core/data/stores/uiStore'

describe('useMenuNavigate（抽屉滑出起步后再导航）', () => {
    beforeEach(() => {
        vi.useFakeTimers()
        useUiStore.setState({ mobileMenuOpen: true })
    })

    afterEach(() => {
        vi.useRealTimers()
        useUiStore.setState({ mobileMenuOpen: false })
        cleanup()
    })

    it('调用后立即关闭菜单，但不立刻执行导航闭包', () => {
        const { result } = renderHook(() => useMenuNavigate())
        const go = vi.fn()

        result.current(go)

        expect(useUiStore.getState().mobileMenuOpen).toBe(false)
        expect(go).not.toHaveBeenCalled()
    })

    it('延迟起步窗口后执行导航闭包', () => {
        const { result } = renderHook(() => useMenuNavigate())
        const go = vi.fn()

        result.current(go)
        vi.advanceTimersByTime(99)
        expect(go).not.toHaveBeenCalled()

        vi.advanceTimersByTime(1)
        expect(go).toHaveBeenCalledTimes(1)
    })

    it('连续调用为单链重启：只执行最后一次的闭包', () => {
        const { result } = renderHook(() => useMenuNavigate())
        const first = vi.fn()
        const second = vi.fn()

        result.current(first)
        vi.advanceTimersByTime(60)
        result.current(second)
        vi.advanceTimersByTime(40)
        // 第一条的 100ms 到点：已被第二条覆盖，不执行
        expect(first).not.toHaveBeenCalled()
        expect(second).not.toHaveBeenCalled()

        vi.advanceTimersByTime(60)
        expect(first).not.toHaveBeenCalled()
        expect(second).toHaveBeenCalledTimes(1)
    })

    it('hook 卸载时取消尚未触发的导航', () => {
        const { result, unmount } = renderHook(() => useMenuNavigate())
        const go = vi.fn()

        result.current(go)
        unmount()
        vi.advanceTimersByTime(500)

        expect(go).not.toHaveBeenCalled()
    })
})
