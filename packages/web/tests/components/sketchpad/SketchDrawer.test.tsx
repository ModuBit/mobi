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
 * SketchDrawer 载体测试：防误关不变量、开合相位机与端形态/几何分流可在 jsdom
 * 断言的部分。SketchCanvas（excalidraw）以桩替换；几何过渡与停靠测量由 E2E 兜底。
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, cleanup, fireEvent, act } from '@testing-library/react'

const isMobileRef = vi.hoisted(() => ({ value: false }))

vi.mock('@/core/data/hooks/useMediaQuery', () => ({
    // useIsMobile 等媒体查询 hooks 统一从此桩取值（isMobileRef.value 控制端形态）
    useIsMobile: () => isMobileRef.value,
}))

// excalidraw 不可在 jsdom 渲染：SketchCanvas 桩只保留载体契约面——onCancel 出口
vi.mock('@/components/sketchpad/SketchCanvas', () => ({
    SketchCanvas: ({ onCancel }: { onCancel: () => void }) => (
        <button type="button" data-testid="sketch-canvas-stub" onClick={onCancel}>画布桩</button>
    ),
}))

import { SketchDrawer } from '@/components/sketchpad/SketchDrawer'

describe('SketchDrawer 防误关不变量', () => {
    beforeEach(() => {
        isMobileRef.value = false
    })

    afterEach(() => cleanup())

    it('mask 不绑定关闭：点击不触发 onClose', () => {
        const onClose = vi.fn()
        render(<SketchDrawer open onClose={onClose} onComplete={vi.fn()} />)
        const mask = document.querySelector('[data-testid="sketch-mask"]') as HTMLElement
        expect(mask).toBeTruthy()
        fireEvent.click(mask)
        expect(onClose).not.toHaveBeenCalled()
    })

    it('唯一出口是画布内取消：点击画布桩 → onClose', () => {
        const onClose = vi.fn()
        render(<SketchDrawer open onClose={onClose} onComplete={vi.fn()} />)
        fireEvent.click(document.querySelector('[data-testid="sketch-canvas-stub"]') as HTMLElement)
        expect(onClose).toHaveBeenCalledTimes(1)
    })

    it('无独立关闭键（X 是取消语义，走二次确认通道而非直接 onClose）', () => {
        const layer = document.createElement('div')
        document.body.appendChild(layer)
        render(
            <SketchDrawer
                open
                onClose={vi.fn()}
                onComplete={vi.fn()}
                layerEl={layer}
                dockMetrics={{ top: 100, bottom: 40, left: 30, right: 30 }}
            />,
        )
        // header 只应存在全屏/取消/完成三个图标按钮（无 antd 自带关闭 X）
        const header = document.querySelector('[data-testid="sketch-header"]') as HTMLElement
        expect(header.querySelectorAll('button')).toHaveLength(3)
        layer.remove()
    })
})

describe('SketchDrawer 开合相位机', () => {
    beforeEach(() => {
        isMobileRef.value = false
    })

    afterEach(() => cleanup())

    it('open=false 时不渲染', () => {
        render(<SketchDrawer open={false} onClose={vi.fn()} onComplete={vi.fn()} />)
        expect(document.querySelector('[data-testid="sketch-sheet"]')).toBeNull()
    })

    it('打开后 enter → open：画布挂载', async () => {
        render(<SketchDrawer open onClose={vi.fn()} onComplete={vi.fn()} />)
        expect(document.querySelector('[data-testid="sketch-canvas-stub"]')).toBeTruthy()
    })

    it('关闭走 exit 动画，动画结束才卸载（先通知后动画）', () => {
        vi.useFakeTimers()
        try {
            const { rerender } = render(<SketchDrawer open onClose={vi.fn()} onComplete={vi.fn()} />)
            rerender(<SketchDrawer open={false} onClose={vi.fn()} onComplete={vi.fn()} />)
            // 动画中仍渲染
            expect(document.querySelector('[data-testid="sketch-sheet"]')).toBeTruthy()
            // 滑出动画时长结束后 → 卸载
            act(() => {
                vi.advanceTimersByTime(300)
            })
            expect(document.querySelector('[data-testid="sketch-sheet"]')).toBeNull()
        } finally {
            vi.useRealTimers()
        }
    })
})

describe('SketchDrawer 端形态与几何分流', () => {
    beforeEach(() => {
        isMobileRef.value = false
    })

    afterEach(() => cleanup())

    it('PC 停靠：portal 进挂载层、几何取 dockMetrics（四边像素），提供全屏切换', () => {
        const layer = document.createElement('div')
        document.body.appendChild(layer)
        render(
            <SketchDrawer
                open
                onClose={vi.fn()}
                onComplete={vi.fn()}
                layerEl={layer}
                dockMetrics={{ top: 100, bottom: 40, left: 30, right: 30 }}
            />,
        )
        const sheet = document.querySelector('[data-testid="sketch-sheet"]') as HTMLElement
        // position 由 styled 类提供（absolute 相对挂载层），几何为 inline
        expect(layer.contains(sheet)).toBe(true)
        expect(sheet.style.top).toBe('100px')
        expect(sheet.style.bottom).toBe('40px')
        expect(sheet.style.left).toBe('30px')
        expect(sheet.style.right).toBe('30px')
        expect(findFullscreenButton()).toBeTruthy()
        layer.remove()
    })

    it('PC 全屏切换：撑满挂载层四边留白', async () => {
        const layer = document.createElement('div')
        document.body.appendChild(layer)
        render(
            <SketchDrawer
                open
                onClose={vi.fn()}
                onComplete={vi.fn()}
                layerEl={layer}
                dockMetrics={{ top: 100, bottom: 40, left: 30, right: 30 }}
            />,
        )
        fireEvent.click(findFullscreenButton() as HTMLElement)
        await act(async () => {})
        const sheet = document.querySelector('[data-testid="sketch-sheet"]') as HTMLElement
        expect(sheet.style.top).toBe('8px')
        expect(sheet.style.bottom).toBe('8px')
        layer.remove()
    })

    it('PC 未传挂载层：fixed 全屏兜底，不注入停靠几何', () => {
        render(<SketchDrawer open onClose={vi.fn()} onComplete={vi.fn()} />)
        const sheet = document.querySelector('[data-testid="sketch-sheet"]') as HTMLElement
        expect(sheet.style.position).toBe('fixed')
        expect(findFullscreenButton()).toBeNull()
    })

    it('移动端：fixed 全屏，不提供全屏切换按钮', () => {
        isMobileRef.value = true
        render(<SketchDrawer open onClose={vi.fn()} onComplete={vi.fn()} />)
        const sheet = document.querySelector('[data-testid="sketch-sheet"]') as HTMLElement
        expect(sheet.style.position).toBe('fixed')
        expect(findFullscreenButton()).toBeNull()
    })

    it('移动端即使传入挂载层与停靠几何：仍 fixed 浮起画纸（safe-area 缝隙），无全屏切换', () => {
        isMobileRef.value = true
        const layer = document.createElement('div')
        document.body.appendChild(layer)
        render(
            <SketchDrawer
                open
                onClose={vi.fn()}
                onComplete={vi.fn()}
                layerEl={layer}
                dockMetrics={{ top: 100, bottom: 40, left: 30, right: 30 }}
            />,
        )
        const sheet = document.querySelector('[data-testid="sketch-sheet"]') as HTMLElement
        expect(sheet.style.position).toBe('fixed')
        // safe-area 优先的四边缝隙（浮起画纸卡片，非硬切盖板）
        expect(sheet.style.top).toBe('max(8px, env(safe-area-inset-top))')
        expect(sheet.style.bottom).toBe('max(8px, env(safe-area-inset-bottom))')
        // 背景暗化遮罩
        const mask = document.querySelector('[data-testid="sketch-mask"]') as HTMLElement
        expect(getComputedStyle(mask).backgroundColor).toBe('rgba(0, 0, 0, 0.45)')
        expect(findFullscreenButton()).toBeNull()
        layer.remove()
    })
})

/** 全屏切换按钮（header 为 lucide icon 按钮，靠 aria-label 定位；
 *  测试环境 i18n 未初始化时 t() 回退 key，key 与译文一并匹配） */
function findFullscreenButton(): HTMLElement | null {
    return Array.from(document.querySelectorAll('button'))
        .find((b) => {
            const label = `${b.getAttribute('aria-label') ?? ''}${b.textContent ?? ''}`
            return /fullscreen/i.test(label) || label.includes('全屏')
        }) ?? null
}
