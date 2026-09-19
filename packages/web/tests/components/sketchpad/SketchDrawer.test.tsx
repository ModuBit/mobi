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

/**
 * SketchDrawer 载体测试：防误关不变量与端形态分流可在 jsdom 断言的部分。
 * SketchCanvas（excalidraw）以桩替换；停靠几何/重挂恢复由 E2E 兜底。
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, cleanup, fireEvent, waitFor } from '@testing-library/react'

const isMobileRef = vi.hoisted(() => ({ value: false }))

vi.mock('@/core/data/hooks/useMediaQuery', () => ({
    // useIsMobile 等媒体查询 hooks 统一从此桩取值（isMobileRef.value 控制端形态）
    useIsMobile: () => isMobileRef.value,
}))

// excalidraw 不可在 jsdom 渲染：SketchCanvas 桩只保留载体契约面——
// onCancel 出口 + exportCurrent 手柄（全屏切换的抢救通道）
vi.mock('@/components/sketchpad/SketchCanvas', () => ({
    SketchCanvas: ({ onCancel, ref }: { onCancel: () => void; ref?: { current: unknown } | null }) => {
        if (ref) ref.current = { exportCurrent: () => Promise.resolve(null) }
        return <button type="button" data-testid="sketch-canvas-stub" onClick={onCancel}>画布桩</button>
    },
}))

import { SketchDrawer } from '@/components/sketchpad/SketchDrawer'

describe('SketchDrawer 防误关不变量', () => {
    beforeEach(() => {
        isMobileRef.value = false
    })

    afterEach(() => cleanup())

    it('mask 点击不关闭（maskClosable=false）', () => {
        const onClose = vi.fn()
        render(<SketchDrawer open onClose={onClose} onComplete={vi.fn()} />)
        const mask = document.querySelector('.ant-drawer-mask') as HTMLElement
        expect(mask).toBeTruthy()
        fireEvent.click(mask)
        expect(onClose).not.toHaveBeenCalled()
    })

    it('ESC 不关闭（keyboard=false）', () => {
        const onClose = vi.fn()
        render(<SketchDrawer open onClose={onClose} onComplete={vi.fn()} />)
        fireEvent.keyDown(document.querySelector('.ant-drawer') as HTMLElement, { key: 'Escape' })
        expect(onClose).not.toHaveBeenCalled()
    })

    it('无右上角 X（closable=false），唯一出口是画布内取消', async () => {
        const onClose = vi.fn()
        render(<SketchDrawer open onClose={onClose} onComplete={vi.fn()} />)
        expect(document.querySelector('.ant-drawer-close')).toBeNull()
        // 画布内取消 → onClose
        fireEvent.click(document.querySelector('[data-testid="sketch-canvas-stub"]') as HTMLElement)
        await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))
    })
})

describe('SketchDrawer 端形态分流', () => {
    beforeEach(() => {
        isMobileRef.value = false
    })

    afterEach(() => cleanup())

    it('PC 停靠：right placement 全宽覆盖容器，提供全屏切换', () => {
        render(<SketchDrawer open onClose={vi.fn()} onComplete={vi.fn()} />)
        const wrapper = document.querySelector('.ant-drawer-content-wrapper') as HTMLElement
        expect(wrapper.style.width).toBe('100%')
        expect(findFullscreenButton()).toBeTruthy()
    })

    it('PC 全屏切换：切到全屏后 placement 转底部全高', async () => {
        render(<SketchDrawer open onClose={vi.fn()} onComplete={vi.fn()} />)
        fireEvent.click(findFullscreenButton() as HTMLElement)
        await waitFor(() => {
            const wrapper = document.querySelector('.ant-drawer-content-wrapper') as HTMLElement
            expect(wrapper.style.height).toBe('100dvh')
        })
    })

    it('移动端：底部全屏（100dvh），不提供全屏切换按钮', () => {
        isMobileRef.value = true
        render(<SketchDrawer open onClose={vi.fn()} onComplete={vi.fn()} />)
        const wrapper = document.querySelector('.ant-drawer-content-wrapper') as HTMLElement
        expect(wrapper.style.height).toBe('100dvh')
        expect(findFullscreenButton()).toBeNull()
    })
})

/** 全屏切换按钮（测试环境 i18n 未初始化时 t() 回退 key，key 与译文一并匹配） */
function findFullscreenButton(): HTMLElement | null {
    return Array.from(document.querySelectorAll('button'))
        .find((b) => /fullscreen/i.test(b.textContent ?? '') || (b.textContent ?? '').includes('全屏')) ?? null
}
