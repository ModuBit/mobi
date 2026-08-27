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

const navigateMock = vi.hoisted(() => vi.fn())

vi.mock('@tanstack/react-router', () => ({
    useNavigate: () => navigateMock,
}))

import { useMenuNavigate } from '@/components/layout/useMenuNavigate'
import { useUiStore } from '@/core/data/stores/uiStore'

describe('useMenuNavigate（抽屉滑出起步后再导航）', () => {
    beforeEach(() => {
        vi.useFakeTimers()
        navigateMock.mockClear()
        useUiStore.setState({ mobileMenuOpen: true })
    })

    afterEach(() => {
        vi.useRealTimers()
        useUiStore.setState({ mobileMenuOpen: false })
        cleanup()
    })

    it('调用后立即关闭菜单，但不立刻导航', () => {
        const { result } = renderHook(() => useMenuNavigate())

        result.current({ to: '/sessions/$sessionId', params: { sessionId: 's1' } })

        expect(useUiStore.getState().mobileMenuOpen).toBe(false)
        expect(navigateMock).not.toHaveBeenCalled()
    })

    it('延迟起步窗口后导航，参数原样透传', () => {
        const { result } = renderHook(() => useMenuNavigate())

        result.current({ to: '/sessions/$sessionId', params: { sessionId: 's1' } })
        vi.advanceTimersByTime(99)
        expect(navigateMock).not.toHaveBeenCalled()

        vi.advanceTimersByTime(1)
        expect(navigateMock).toHaveBeenCalledTimes(1)
        expect(navigateMock).toHaveBeenCalledWith({ to: '/sessions/$sessionId', params: { sessionId: 's1' } })
    })

    it('hook 卸载时取消尚未触发的导航', () => {
        const { result, unmount } = renderHook(() => useMenuNavigate())

        result.current({ to: '/sessions' })
        unmount()
        vi.advanceTimersByTime(500)

        expect(navigateMock).not.toHaveBeenCalled()
    })
})
