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
import { renderHook, act } from '@testing-library/react'
import { useWindowControlsOverlay } from '@/components/layout/useWindowControlsOverlay'

interface WcoLike {
    visible: boolean
    addEventListener: ReturnType<typeof vi.fn>
    removeEventListener: ReturnType<typeof vi.fn>
}

function stubWco(wco: WcoLike | undefined) {
    vi.stubGlobal('navigator', { ...navigator, windowControlsOverlay: wco })
}

describe('useWindowControlsOverlay', () => {
    afterEach(() => {
        vi.unstubAllGlobals()
        vi.restoreAllMocks()
    })

    it('windowControlsOverlay 不存在 → false', () => {
        stubWco(undefined)
        const { result } = renderHook(() => useWindowControlsOverlay())
        expect(result.current).toBe(false)
    })

    it('visible: false → false', () => {
        stubWco({
            visible: false,
            addEventListener: vi.fn(),
            removeEventListener: vi.fn(),
        })
        const { result } = renderHook(() => useWindowControlsOverlay())
        expect(result.current).toBe(false)
    })

    it('visible: true → true', () => {
        stubWco({
            visible: true,
            addEventListener: vi.fn(),
            removeEventListener: vi.fn(),
        })
        const { result } = renderHook(() => useWindowControlsOverlay())
        expect(result.current).toBe(true)
    })

    it('geometrychange 触发 → 更新返回值', () => {
        const listeners = new Map<string, () => void>()
        const wco: WcoLike = {
            visible: true,
            addEventListener: vi.fn((type: string, cb: () => void) => listeners.set(type, cb)),
            removeEventListener: vi.fn(),
        }
        stubWco(wco)

        const { result } = renderHook(() => useWindowControlsOverlay())
        expect(result.current).toBe(true)

        // 模拟退出 WCO（如进入全屏）
        ;(wco as { visible: boolean }).visible = false
        act(() => {
            listeners.get('geometrychange')!()
        })
        expect(result.current).toBe(false)
    })

    it('卸载时移除监听', () => {
        const removeEventListener = vi.fn()
        stubWco({
            visible: true,
            addEventListener: vi.fn(),
            removeEventListener,
        })
        const { unmount } = renderHook(() => useWindowControlsOverlay())
        unmount()
        expect(removeEventListener).toHaveBeenCalledWith('geometrychange', expect.any(Function))
    })
})
