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

import { useMenuNavigate } from '@/features/layout/useMenuNavigate'
import { useUiStore } from '@/core/data/stores/uiStore'

/** 取走方（MobileMenuDrawer 的 onExited）在抽屉离场后做的事 */
const flush = () => {
    const go = useUiStore.getState().takeMenuNavigation()
    go?.()
    return go
}

describe('useMenuNavigate（抽屉离场后再导航）', () => {
    beforeEach(() => {
        useUiStore.setState({ mobileMenuOpen: true, pendingMenuNavigation: null })
    })

    afterEach(() => {
        useUiStore.setState({ mobileMenuOpen: false, pendingMenuNavigation: null })
        cleanup()
    })

    it('调用后立即关闭菜单并登记导航，但不立刻执行', () => {
        const { result } = renderHook(() => useMenuNavigate())
        const go = vi.fn()

        result.current(go)

        expect(useUiStore.getState().mobileMenuOpen).toBe(false)
        expect(useUiStore.getState().pendingMenuNavigation).toBe(go)
        expect(go).not.toHaveBeenCalled()
    })

    it('抽屉离场后取走执行；取走即清空，重复取走为 null', () => {
        const { result } = renderHook(() => useMenuNavigate())
        const go = vi.fn()

        result.current(go)
        expect(flush()).toBe(go)
        expect(go).toHaveBeenCalledTimes(1)
        expect(flush()).toBeNull()
        expect(go).toHaveBeenCalledTimes(1)
    })

    it('连续调用为覆盖语义：只执行最后一次的闭包', () => {
        const { result } = renderHook(() => useMenuNavigate())
        const first = vi.fn()
        const second = vi.fn()

        result.current(first)
        result.current(second)
        flush()

        expect(first).not.toHaveBeenCalled()
        expect(second).toHaveBeenCalledTimes(1)
    })

    it('发起组件先卸载也不丢导航（闭包存在 store 里，抽屉离场后才取走）', () => {
        const { result, unmount } = renderHook(() => useMenuNavigate())
        const go = vi.fn()

        result.current(go)
        unmount()

        expect(flush()).toBe(go)
        expect(go).toHaveBeenCalledTimes(1)
    })

    it('离场途中重新打开菜单：未执行的导航作废（不留给下一次关闭）', () => {
        const { result } = renderHook(() => useMenuNavigate())
        const go = vi.fn()

        result.current(go)
        useUiStore.getState().setMobileMenuOpen(true)

        expect(useUiStore.getState().pendingMenuNavigation).toBeNull()
        expect(flush()).toBeNull()
        expect(go).not.toHaveBeenCalled()
    })
})
