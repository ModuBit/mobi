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
import { render, fireEvent, cleanup } from '@testing-library/react'

// uiStore mock：只提供 EdgeSwipeBack 用到的 getState（zustand store 形状），
// 避免引入真实 store 连带 i18n 初始化。
// mockState 必须稳定引用（getState 每次返回同一对象），测试内按需改字段值
const setMobileMenuOpen = vi.fn()
const start = vi.fn()
const mockState: {
    setMobileMenuOpen: typeof setMobileMenuOpen
    mobileMenuDragControls: { start: typeof start } | null
} = { setMobileMenuOpen, mobileMenuDragControls: { start } }
vi.mock('@/core/data/stores/uiStore', () => ({
    useUiStore: {
        getState: () => mockState,
    },
}))

import { EdgeSwipeBack } from '@/components/ui/EdgeSwipeBack'

describe('EdgeSwipeBack', () => {
    beforeEach(() => {
        setMobileMenuOpen.mockClear()
        start.mockClear()
        mockState.mobileMenuDragControls = { start }
    })

    // vitest 未开 globals，渲染型测试须显式 cleanup
    afterEach(() => cleanup())

    it('渲染热区 div：fixed 定位、宽 20px、贴左缘、zIndex 4', () => {
        render(<EdgeSwipeBack />)
        const hotzone = document.querySelector('[data-testid="edge-swipe-hotzone"]') as HTMLElement
        expect(hotzone).toBeTruthy()
        expect(hotzone.getAttribute('aria-hidden')).toBe('true')
        expect(hotzone.style.position).toBe('fixed')
        expect(hotzone.style.width).toBe('20px')
        expect(hotzone.style.left).toBe('0px')
        expect(hotzone.style.top).toBe('0px')
        expect(hotzone.style.bottom).toBe('0px')
        expect(hotzone.style.zIndex).toBe('4')
        // 禁浏览器默认触摸行为，手势由 pointer 事件接管
        expect(hotzone.style.touchAction).toBe('none')
    })

    it('热区点按不动（未过迟滞）不触发：不打开菜单、不 start drag', () => {
        render(<EdgeSwipeBack />)
        const hotzone = document.querySelector('[data-testid="edge-swipe-hotzone"]')!

        // pointerdown 后直接抬起，无位移
        fireEvent.pointerDown(hotzone, { clientX: 5 })
        fireEvent.pointerUp(window)

        expect(setMobileMenuOpen).not.toHaveBeenCalled()
        expect(start).not.toHaveBeenCalled()
    })

    it('位移越过迟滞 → setMobileMenuOpen(true) 且 dragControls.start 被调用（远程拖拽路径）', () => {
        render(<EdgeSwipeBack />)
        const hotzone = document.querySelector('[data-testid="edge-swipe-hotzone"]')!

        // 热区内起手（x=5 < EDGE_WIDTH）右滑 35px（> HYSTERESIS 10px）
        fireEvent.pointerDown(hotzone, { clientX: 5 })
        fireEvent.pointerMove(window, { clientX: 40 })

        expect(setMobileMenuOpen).toHaveBeenCalledWith(true)
        expect(start).toHaveBeenCalledTimes(1)
    })

    it('controls 未注册（菜单未挂载）→ 仍 setMobileMenuOpen(true)，start 不被调（spring 弹入 fallback）', () => {
        mockState.mobileMenuDragControls = null
        render(<EdgeSwipeBack />)
        const hotzone = document.querySelector('[data-testid="edge-swipe-hotzone"]')!

        fireEvent.pointerDown(hotzone, { clientX: 5 })
        fireEvent.pointerMove(window, { clientX: 40 })

        expect(setMobileMenuOpen).toHaveBeenCalledWith(true)
        expect(start).not.toHaveBeenCalled()
    })

    it('组件 unmount 后 window pointermove 监听被清理：滑动不再触发 open/start', () => {
        const { unmount } = render(<EdgeSwipeBack />)
        const hotzone = document.querySelector('[data-testid="edge-swipe-hotzone"]')!

        // 起手但未过迟滞（挂上 window 监听），随后卸载组件
        fireEvent.pointerDown(hotzone, { clientX: 5 })
        unmount()

        // 卸载后再滑动：若监听未清理，此处会触发 setMobileMenuOpen / start
        fireEvent.pointerMove(window, { clientX: 40 })

        expect(setMobileMenuOpen).not.toHaveBeenCalled()
        expect(start).not.toHaveBeenCalled()
    })
})
