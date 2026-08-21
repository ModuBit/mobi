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
import { render, cleanup } from '@testing-library/react'

// uiStore mock：只提供 EdgeSwipeBack 用到的 getState（zustand store 形状），
// 避免引入真实 store 连带 i18n 初始化。
// mockState 必须稳定引用（getState 每次返回同一对象），测试内按需改字段值
const setMobileMenuOpen = vi.fn()
const mockState = { setMobileMenuOpen }
vi.mock('@/core/data/stores/uiStore', () => ({
    useUiStore: {
        getState: () => mockState,
    },
}))

import { EdgeSwipeBack } from '@/components/ui/EdgeSwipeBack'

/** 在 document 上派发合成 PointerEvent（jsdom 30 原生支持 pointerId/clientX init） */
const dispatchPointer = (
    type: 'pointerdown' | 'pointermove' | 'pointerup' | 'pointercancel',
    init: { pointerId: number; clientX: number; clientY: number },
) => {
    document.dispatchEvent(
        new PointerEvent(type, {
            bubbles: true,
            cancelable: true,
            pointerId: init.pointerId,
            clientX: init.clientX,
            clientY: init.clientY,
        }),
    )
}

describe('EdgeSwipeBack（无浮层 document 捕获 + 方向锁）', () => {
    beforeEach(() => {
        setMobileMenuOpen.mockClear()
    })

    // vitest 未开 globals，渲染型测试须显式 cleanup
    afterEach(() => cleanup())

    it('不渲染任何 DOM（无浮层，不拦截滚动/点击）', () => {
        const { container } = render(<EdgeSwipeBack />)
        expect(container.childElementCount).toBe(0)
    })

    it('热区内起手 + 水平位移胜出 → setMobileMenuOpen(true)', () => {
        render(<EdgeSwipeBack />)

        // 热区内起手（x=10 <= EDGE_WIDTH 20），右滑 dx=25、dy=0 → horizontal
        dispatchPointer('pointerdown', { pointerId: 1, clientX: 10, clientY: 100 })
        dispatchPointer('pointermove', { pointerId: 1, clientX: 35, clientY: 100 })

        expect(setMobileMenuOpen).toHaveBeenCalledTimes(1)
        expect(setMobileMenuOpen).toHaveBeenCalledWith(true)
    })

    it('未过迟滞的位移不触发；越过后才触发', () => {
        render(<EdgeSwipeBack />)

        dispatchPointer('pointerdown', { pointerId: 1, clientX: 10, clientY: 100 })
        // dx=5 未过迟滞（10px）→ pending
        dispatchPointer('pointermove', { pointerId: 1, clientX: 15, clientY: 100 })
        expect(setMobileMenuOpen).not.toHaveBeenCalled()

        // 越过迟滞 → horizontal
        dispatchPointer('pointermove', { pointerId: 1, clientX: 25, clientY: 100 })
        expect(setMobileMenuOpen).toHaveBeenCalledWith(true)
    })

    it('一次手势只触发一次：确认后后续 move 不再重复 setMobileMenuOpen', () => {
        render(<EdgeSwipeBack />)

        dispatchPointer('pointerdown', { pointerId: 1, clientX: 10, clientY: 100 })
        dispatchPointer('pointermove', { pointerId: 1, clientX: 35, clientY: 100 })
        dispatchPointer('pointermove', { pointerId: 1, clientX: 60, clientY: 100 })

        expect(setMobileMenuOpen).toHaveBeenCalledTimes(1)
    })

    it('竖向位移胜出 → 不开菜单，且放弃跟踪（后续水平位移也不认）', () => {
        render(<EdgeSwipeBack />)

        dispatchPointer('pointerdown', { pointerId: 1, clientX: 10, clientY: 100 })
        // dy=40 胜出 dx=5 → vertical，浏览器接管滚动
        dispatchPointer('pointermove', { pointerId: 1, clientX: 15, clientY: 140 })
        expect(setMobileMenuOpen).not.toHaveBeenCalled()

        // 跟踪已清除，同一手势内再水平移动也不触发
        dispatchPointer('pointermove', { pointerId: 1, clientX: 60, clientY: 140 })
        expect(setMobileMenuOpen).not.toHaveBeenCalled()
    })

    it('热区外起手（clientX=80 > EDGE_WIDTH）→ 不跟踪、不开菜单', () => {
        render(<EdgeSwipeBack />)

        dispatchPointer('pointerdown', { pointerId: 1, clientX: 80, clientY: 100 })
        dispatchPointer('pointermove', { pointerId: 1, clientX: 140, clientY: 100 })

        expect(setMobileMenuOpen).not.toHaveBeenCalled()
    })

    it('多指：跟踪中另一指针 pointerup 不打断手势（后续仍能触发）', () => {
        render(<EdgeSwipeBack />)

        // 指针 1 热区内起手，位移未过迟滞（pending）
        dispatchPointer('pointerdown', { pointerId: 1, clientX: 10, clientY: 100 })
        dispatchPointer('pointermove', { pointerId: 1, clientX: 14, clientY: 100 })

        // 另一根手指（指针 2）抬起——不是被跟踪指针，不得清理跟踪
        dispatchPointer('pointerup', { pointerId: 2, clientX: 50, clientY: 50 })

        // 指针 1 继续右滑越过迟滞 → 仍应触发
        dispatchPointer('pointermove', { pointerId: 1, clientX: 35, clientY: 100 })
        expect(setMobileMenuOpen).toHaveBeenCalledWith(true)
    })

    it('被跟踪指针自身 pointerup 结束手势，抬起后 move 不再触发', () => {
        render(<EdgeSwipeBack />)

        dispatchPointer('pointerdown', { pointerId: 1, clientX: 10, clientY: 100 })
        dispatchPointer('pointerup', { pointerId: 1, clientX: 12, clientY: 100 })
        dispatchPointer('pointermove', { pointerId: 1, clientX: 60, clientY: 100 })

        expect(setMobileMenuOpen).not.toHaveBeenCalled()
    })

    it('pointercancel（浏览器接管滚动）同样清理跟踪', () => {
        render(<EdgeSwipeBack />)

        dispatchPointer('pointerdown', { pointerId: 1, clientX: 10, clientY: 100 })
        dispatchPointer('pointercancel', { pointerId: 1, clientX: 12, clientY: 100 })
        dispatchPointer('pointermove', { pointerId: 1, clientX: 60, clientY: 100 })

        expect(setMobileMenuOpen).not.toHaveBeenCalled()
    })

    it('unmount 后不再响应：派发事件无异常且不开菜单', () => {
        const { unmount } = render(<EdgeSwipeBack />)

        dispatchPointer('pointerdown', { pointerId: 1, clientX: 10, clientY: 100 })
        unmount()

        // 卸载后滑动：若监听未清理，此处会触发 setMobileMenuOpen
        expect(() => {
            dispatchPointer('pointermove', { pointerId: 1, clientX: 60, clientY: 100 })
            dispatchPointer('pointerup', { pointerId: 1, clientX: 60, clientY: 100 })
        }).not.toThrow()
        expect(setMobileMenuOpen).not.toHaveBeenCalled()
    })
})
