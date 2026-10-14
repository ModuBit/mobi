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
/** 画布桩的取消确认框开关（测载体的 ESC 让路） */
const confirmOpenRef = vi.hoisted(() => ({ value: false }))
const guardRef = vi.hoisted(() => ({ calls: [] as boolean[] }))
const lockRef = vi.hoisted(() => ({ locks: 0, releases: 0 }))

vi.mock('@/core/data/hooks/useMediaQuery', () => ({
    // useIsMobile 等媒体查询 hooks 统一从此桩取值（isMobileRef.value 控制端形态）
    useIsMobile: () => isMobileRef.value,
}))

// 手势返回哨兵与背景滚动锁是 core / ui 的既测模块，这里只关心「载体接没接、什么档接」
vi.mock('@/core/hooks/useHistoryGuard', () => ({
    useHistoryGuard: (active: boolean) => { guardRef.calls.push(active) },
}))
vi.mock('@/ui/base/interactive/bodyScrollLock', () => ({
    lockBodyScroll: () => { lockRef.locks += 1; return () => { lockRef.releases += 1 } },
}))

// excalidraw 不可在 jsdom 渲染：SketchCanvas 桩——**取消通道经手柄**（载体调
// requestCancel，不是自己渲染一个按钮），桩必须把这条通道接上，否则测不到任何关闭路径
vi.mock('@/features/sketchpad/SketchCanvas', () => ({
    SketchCanvas: ({ onCancel, ref }: {
        onCancel: () => void
        ref?: { current: unknown }
    }) => {
        if (ref) {
            ref.current = {
                requestCancel: onCancel,
                isConfirmOpen: () => confirmOpenRef.value,
                complete: async () => undefined,
            }
        }
        return <button type="button" data-testid="sketch-canvas-stub" onClick={onCancel}>画布桩</button>
    },
}))

import { SketchDrawer } from '@/features/sketchpad/SketchDrawer'
import { __resetOverlayLayerForTest } from '@/ui/base/layout/overlayLayer'
import { sheetClass, sheetSurfaceClass } from '@/ui/base/layout/sheetSurface'

describe('SketchDrawer 关闭通道（下拉 / ESC / 遮罩 / 手势返回 → 同一条取消入口）', () => {
    beforeEach(() => {
        isMobileRef.value = false
        confirmOpenRef.value = false
        guardRef.calls = []
        lockRef.locks = 0
        lockRef.releases = 0
    })

    afterEach(() => cleanup())

    it('点遮罩：移动端走取消（脏数据由画布内的二次确认兜底）', () => {
        isMobileRef.value = true
        const onClose = vi.fn()
        render(<SketchDrawer open onClose={onClose} onComplete={vi.fn()} />)
        fireEvent.click(document.querySelector('[data-testid="sketch-mask"]') as HTMLElement)
        expect(onClose).toHaveBeenCalledTimes(1)
    })

    it('点遮罩：PC 不接——停靠态遮罩只挡交互，点它关闭会误伤', () => {
        const onClose = vi.fn()
        render(<SketchDrawer open onClose={onClose} onComplete={vi.fn()} />)
        fireEvent.click(document.querySelector('[data-testid="sketch-mask"]') as HTMLElement)
        expect(onClose).not.toHaveBeenCalled()
    })

    it('ESC：走同一条取消', () => {
        const onClose = vi.fn()
        render(<SketchDrawer open onClose={onClose} onComplete={vi.fn()} />)
        fireEvent.keyDown(document, { key: 'Escape' })
        expect(onClose).toHaveBeenCalledTimes(1)
    })

    it('ESC：取消确认框开着时让路（否则 ESC 关掉确认框后又被重新弹出）', () => {
        confirmOpenRef.value = true
        const onClose = vi.fn()
        render(<SketchDrawer open onClose={onClose} onComplete={vi.fn()} />)
        fireEvent.keyDown(document, { key: 'Escape' })
        expect(onClose).not.toHaveBeenCalled()
    })

    /** 画布自己的 ESC 语义（取消当前图形 / 取消选择 / 退出文本编辑）优先级更高 */
    it('ESC：已被内层消费（defaultPrevented）时不动', () => {
        const onClose = vi.fn()
        render(<SketchDrawer open onClose={onClose} onComplete={vi.fn()} />)
        const event = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
        event.preventDefault()
        document.dispatchEvent(event)
        expect(onClose).not.toHaveBeenCalled()
    })

    /**
     * 本层消费掉的 ESC 必须**截住不上浮**。取消确认框是同步弹出的（本处理器在 document 冒泡相，
     * requestCancel 里 modal.confirm 当拍渲染），而 rc 系弹层的全局 ESC 监听挂在 **window**
     * 上（`@rc-component/portal/useEscKeyDown`）——window 是冒泡路径的最后一站，不截住就会在
     * 确认框挂载后收到**同一记**按键把它当场关掉：弹出与关闭发生在同一帧，真机表现是
     * 「按 ESC 什么都没发生」（实测 modal root 出现后 60ms 开始退场）。
     */
    it('ESC：本层消费后不再上浮到 window（弹层的全局 ESC 收不到同一记按键）', () => {
        const onClose = vi.fn()
        render(<SketchDrawer open onClose={onClose} onComplete={vi.fn()} />)
        const atWindow = vi.fn()
        window.addEventListener('keydown', atWindow)
        try {
            fireEvent.keyDown(document, { key: 'Escape', bubbles: true })
        } finally {
            window.removeEventListener('keydown', atWindow)
        }
        expect(onClose).toHaveBeenCalledTimes(1)
        expect(atWindow).not.toHaveBeenCalled()
    })

    /** 上一条的另一半：确认框在上时这一记 ESC 属于它，不截——弹层的全局监听正是它关自己的通道 */
    it('ESC：确认框开着时让路且不截（那一记交给确认框自己收）', () => {
        confirmOpenRef.value = true
        const onClose = vi.fn()
        render(<SketchDrawer open onClose={onClose} onComplete={vi.fn()} />)
        const atWindow = vi.fn()
        window.addEventListener('keydown', atWindow)
        try {
            fireEvent.keyDown(document, { key: 'Escape', bubbles: true })
        } finally {
            window.removeEventListener('keydown', atWindow)
        }
        expect(onClose).not.toHaveBeenCalled()
        expect(atWindow).toHaveBeenCalled()
    })

    it('手势返回哨兵：移动端推、PC 不推', () => {
        isMobileRef.value = true
        const view = render(<SketchDrawer open onClose={vi.fn()} onComplete={vi.fn()} />)
        expect(guardRef.calls.at(-1)).toBe(true)
        view.unmount()

        isMobileRef.value = false
        render(<SketchDrawer open onClose={vi.fn()} onComplete={vi.fn()} />)
        expect(guardRef.calls.at(-1)).toBe(false)
    })

    it('打开期间锁背景滚动，卸载时释放', () => {
        const view = render(<SketchDrawer open onClose={vi.fn()} onComplete={vi.fn()} />)
        expect(lockRef.locks).toBe(1)
        view.unmount()
        expect(lockRef.releases).toBe(1)
    })

    it('唯一出口仍是画布内的取消：点击画布桩 → onClose', () => {
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

describe('SketchDrawer 头部下拉关闭（移动端）', () => {
    /** 面高 600 → 位置阈值 200（resolveDragDisposition 取 1/3） */
    function stubSheetHeight(): HTMLElement {
        const sheet = document.querySelector('[data-testid="sketch-sheet"]') as HTMLElement
        sheet.getBoundingClientRect = () => ({ height: 600, top: 0, bottom: 600, left: 0, right: 400, width: 400, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect
        return sheet
    }

    function header(): HTMLElement {
        return document.querySelector('[data-testid="sketch-header"]') as HTMLElement
    }

    /**
     * 指针事件必须**自带时间戳**：jsdom 里三个事件几乎是同一时刻产生的，真实速度算出来是
     * 天文数字（位移 ÷ 0.01ms），判定分支就永远落在「速度」那条上，位置阈值根本测不到。
     * 把 down / up 拉开 200ms、中途只有一次 move，最近 80ms 窗口里就只剩一个采样点
     * （dragVelocity 判为 0），判定交回位置阈值——正是下面几条要测的。
     * `isPrimary` 要显式给真（jsdom 默认 false，而钩子按主指针判）
     */
    function pointer(el: HTMLElement, type: 'pointerdown' | 'pointermove' | 'pointerup', y: number, t: number, init?: { pointerId?: number; isPrimary?: boolean }): void {
        const event = new PointerEvent(type, {
            bubbles: true, cancelable: true, pointerId: init?.pointerId ?? 1, pointerType: 'touch', clientY: y,
            isPrimary: init?.isPrimary ?? true,
        })
        Object.defineProperty(event, 'timeStamp', { value: t })
        // 手工派发不在 testing-library 的 act 里，状态更新不会当拍 flush（断言会读到上一帧）
        act(() => { el.dispatchEvent(event) })
    }

    function drag(el: HTMLElement, fromY: number, toY: number): void {
        pointer(el, 'pointerdown', fromY, 1000)
        pointer(el, 'pointermove', toY, 1200)
        pointer(el, 'pointerup', toY, 1200)
    }

    beforeEach(() => {
        isMobileRef.value = true
        confirmOpenRef.value = false
        guardRef.calls = []
    })

    afterEach(() => cleanup())

    it('跟手位移写进 --sheet-drag-y，拖拽期标 data-dragging', () => {
        render(<SketchDrawer open onClose={vi.fn()} onComplete={vi.fn()} />)
        const sheet = stubSheetHeight()
        const el = header()
        pointer(el, 'pointerdown', 100, 1000)
        pointer(el, 'pointermove', 260, 1010)
        expect(sheet.style.getPropertyValue('--sheet-drag-y')).toBe('160px')
        expect(sheet.hasAttribute('data-dragging')).toBe(true)
    })

    it('过阈值松手 → 走取消；位移留着给退场从当前位置继续', () => {
        const onClose = vi.fn()
        render(<SketchDrawer open onClose={onClose} onComplete={vi.fn()} />)
        stubSheetHeight()
        drag(header(), 100, 500)
        expect(onClose).toHaveBeenCalledTimes(1)
        expect((document.querySelector('[data-testid="sketch-sheet"]') as HTMLElement).style.getPropertyValue('--sheet-drag-y')).toBe('400px')
    })

    it('未过阈值松手 → 不关闭，位移回零', () => {
        const onClose = vi.fn()
        render(<SketchDrawer open onClose={onClose} onComplete={vi.fn()} />)
        const sheet = stubSheetHeight()
        drag(header(), 100, 200)
        expect(onClose).not.toHaveBeenCalled()
        expect(sheet.style.getPropertyValue('--sheet-drag-y')).toBe('0px')
        expect(sheet.hasAttribute('data-dragging')).toBe(false)
    })

    /** 关闭被否决（画布脏 → 弹确认）：浮层得沉降回原位，不能悬在手指停下的地方 */
    it('关闭被否决 → 两拍后沉降回原位', () => {
        vi.useFakeTimers()
        try {
            // onClose 不翻转 open = 否决（画布内的确认框拦下）
            render(<SketchDrawer open onClose={vi.fn()} onComplete={vi.fn()} />)
            const sheet = stubSheetHeight()
            drag(header(), 100, 500)
            expect(sheet.style.getPropertyValue('--sheet-drag-y')).toBe('400px')
            act(() => { vi.advanceTimersByTime(200) })
            expect(sheet.style.getPropertyValue('--sheet-drag-y')).toBe('0px')
        } finally {
            vi.useRealTimers()
        }
    })

    /** 甩动可能在同一帧里按下即抬起（一条 move 都没有）：位移必须按**抬起坐标**算 */
    it('无 pointermove 的甩动也按抬起位置判去向', () => {
        const onClose = vi.fn()
        render(<SketchDrawer open onClose={onClose} onComplete={vi.fn()} />)
        stubSheetHeight()
        const el = header()
        pointer(el, 'pointerdown', 100, 1000)
        pointer(el, 'pointerup', 500, 1200)
        expect(onClose).toHaveBeenCalledTimes(1)
    })

    /** 多指：主指针在画布上作画，第二根手指落到头部不该把浮层拖走 */
    it('非主指针不起手', () => {
        render(<SketchDrawer open onClose={vi.fn()} onComplete={vi.fn()} />)
        const sheet = stubSheetHeight()
        const el = header()
        const second = { pointerId: 2, isPrimary: false }
        pointer(el, 'pointerdown', 100, 1000, second)
        pointer(el, 'pointermove', 400, 1010, second)
        expect(sheet.style.getPropertyValue('--sheet-drag-y')).toBe('0px')
        expect(sheet.hasAttribute('data-dragging')).toBe(false)
    })

    /**
     * 退场动画没放完就被重开：`mounted` 全程为真 → `enabled` 认不出重开，
     * 上一次下拉刻意留着的位移会残留（浮层整块停在下沉位置）
     */
    it('关后立刻重开 → 位移复位，不残留上一次下拉的位置', () => {
        vi.useFakeTimers()
        try {
            const { rerender } = render(<SketchDrawer open onClose={vi.fn()} onComplete={vi.fn()} />)
            const sheet = stubSheetHeight()
            drag(header(), 100, 500)
            expect(sheet.style.getPropertyValue('--sheet-drag-y')).toBe('400px')
            // 关（进 exit，卸载定时器还没到）→ 又开
            act(() => { rerender(<SketchDrawer open={false} onClose={vi.fn()} onComplete={vi.fn()} />) })
            act(() => { rerender(<SketchDrawer open onClose={vi.fn()} onComplete={vi.fn()} />) })
            expect(sheet.style.getPropertyValue('--sheet-drag-y')).toBe('0px')
        } finally {
            vi.useRealTimers()
        }
    })

    it('PC 不接：头部无可拖标记，也不接手势处理器', () => {
        isMobileRef.value = false
        render(<SketchDrawer open onClose={vi.fn()} onComplete={vi.fn()} />)
        expect(header().hasAttribute('data-draggable')).toBe(false)
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
            // 滑出动画时长（300ms）+ 卸载定时余量 40ms 结束后 → 卸载
            act(() => {
                vi.advanceTimersByTime(340)
            })
            expect(document.querySelector('[data-testid="sketch-sheet"]')).toBeNull()
        } finally {
            vi.useRealTimers()
        }
    })

    /** 离场那一段遮罩还在屏上：壳按 data-state 放行指针，不写就整段动画吞掉下层点按 */
    it('离场期间遮罩标 closed', () => {
        const { rerender } = render(<SketchDrawer open onClose={vi.fn()} onComplete={vi.fn()} />)
        const mask = () => document.querySelector('[data-testid="sketch-mask"]') as HTMLElement
        expect(mask().getAttribute('data-state')).toBe('open')
        act(() => { rerender(<SketchDrawer open={false} onClose={vi.fn()} onComplete={vi.fn()} />) })
        expect(mask().getAttribute('data-state')).toBe('closed')
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

    it('移动端即使传入挂载层与停靠几何：仍 fixed 贴底 sheet（顶留一缝 + 底部安全区内衬），无全屏切换', () => {
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
        // 与其它移动浮层同一形状语言：左右与底贴屏（上半圆角由壳给），顶边留一缝
        expect(sheet.style.top).toBe('max(8px, env(safe-area-inset-top))')
        expect(sheet.style.left).toBe('0px')
        expect(sheet.style.right).toBe('0px')
        expect(sheet.style.bottom).toBe('0px')
        // 贴底后底边没有缝隙兜底：home indicator 让给内衬，画布不吃那一条
        expect(sheet.style.paddingBottom).toBe('max(8px, env(safe-area-inset-bottom))')
        // 暗化遮罩（底色来自壳，档位与其它 sheet 一致），PC 那档才注入透明
        const mask = document.querySelector('[data-testid="sketch-mask"]') as HTMLElement
        expect(mask.style.getPropertyValue('--sheet-mask-bg')).toBe('')
        expect(findFullscreenButton()).toBeNull()
        layer.remove()
    })
})

describe('SketchDrawer 形态 → z 档矩阵（跨文件契约，回归锁）', () => {
    beforeEach(() => {
        isMobileRef.value = false
    })

    afterEach(() => cleanup())

    /** stacking 阶梯（sketchLayout）：mask(100) < 停靠(101) < composer(102) < 全屏(103)。
     *  「盖过 composer」= 全屏档——包括移动端恒全屏（fullscreen state 只有 PC 能置位，
     *  漏掉 isMobile 会让移动端画纸被 composer 压住，2026-09-21 实踩） */
    function sheetZIndex(): number {
        const sheet = document.querySelector('[data-testid="sketch-sheet"]') as HTMLElement
        return Number(getComputedStyle(sheet).zIndex)
    }

    it('PC 停靠：z 101（composer 之下，浮层是临时层）', () => {
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
        expect(sheetZIndex()).toBe(101)
        layer.remove()
    })

    it('PC 全屏：z 103（盖过 composer 102）', async () => {
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
        expect(sheetZIndex()).toBe(103)
        layer.remove()
    })

    it('移动端恒全屏：与其它移动浮层同序——领浮层号（面压在遮罩上），不再走 100–103 阶梯', () => {
        __resetOverlayLayerForTest()
        isMobileRef.value = true
        render(<SketchDrawer open onClose={vi.fn()} onComplete={vi.fn()} />)
        const maskZ = Number(getComputedStyle(document.querySelector('[data-testid="sketch-mask"]') as HTMLElement).zIndex)
        expect(sheetZIndex()).toBe(maskZ + 1)
        // 浮层号基线（--mobi-z-overlay 1080）：领号意味着盖过一切页内层（含 composer），
        // 这是「移动端画板与其它 sheet 同序」的判据；PC 那三档另测
        expect(sheetZIndex()).toBeGreaterThanOrEqual(1080)
    })

    it('PC 未挂层 fixed 兜底：几何即全屏，z 103（盖过 composer）', () => {
        render(<SketchDrawer open onClose={vi.fn()} onComplete={vi.fn()} />)
        expect(sheetZIndex()).toBe(103)
    })
})

describe('画板 × 共享壳（视觉统一的接缝锁）', () => {
    beforeEach(() => {
        isMobileRef.value = false
    })

    afterEach(() => cleanup())

    it('移动端：面走壳的贴底档，头部走壳（取消 = 壳的描边图标钮，移动端取触达档）', () => {
        isMobileRef.value = true
        render(<SketchDrawer open onClose={vi.fn()} onComplete={vi.fn()} />)
        const sheet = document.querySelector('[data-testid="sketch-sheet"]') as HTMLElement
        expect(sheet.className).toContain(sheetSurfaceClass('bottom'))
        expect(sheet.className).not.toContain(sheetSurfaceClass('floating'))
        const mask = document.querySelector('[data-testid="sketch-mask"]') as HTMLElement
        expect(mask.className).toContain(sheetClass.mask)
        // 取消走文字档（旁路动作，DESIGN「Buttons」：不给 primary，也不是工具条图标动作），
        // 与右端「完成」成对；移动端取触达档高度
        const cancel = document.querySelector('[data-testid="sketch-header"] button') as HTMLElement
        expect(cancel.textContent).toBe('common.cancel')
        expect(cancel.className).toContain('ant-btn')
        expect(cancel.style.minHeight).toBe('40px')
    })

    it('PC：面走壳的悬浮档（四角），全屏钮是无描边档、遮罩注入透明', () => {
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
        expect(sheet.className).toContain(sheetSurfaceClass('floating'))
        expect(sheet.className).not.toContain(sheetSurfaceClass('bottom'))
        // PC 头部无抓手（无下拉语义），取消钮取紧凑档
        const header = document.querySelector('[data-testid="sketch-header"]') as HTMLElement
        expect(header.querySelector(`.${sheetClass.grabber}`)).toBeNull()
        const cancel = header.querySelector('button') as HTMLElement
        expect(cancel.textContent).toBe('common.cancel')
        expect(cancel.style.minHeight).toBe('32px')
        // 画布不滚 → 头部标记常驻发丝线（壳的 data-scrolled 规则在这永不触发）
        expect(header.hasAttribute('data-bordered')).toBe(true)
        // 全屏钮：同一个壳的图标钮，但无描边（工具动作，不是破坏性出口）
        const fullscreen = findFullscreenButton() as HTMLElement
        expect(fullscreen.className).toContain(sheetClass.iconBtn)
        expect(fullscreen.className).not.toContain(sheetClass.iconBtnBordered)
        // PC 遮罩只挡交互不改视觉：壳的默认档被就地换成透明
        const mask = document.querySelector('[data-testid="sketch-mask"]') as HTMLElement
        expect(mask.className).toContain(sheetClass.mask)
        expect(mask.style.getPropertyValue('--sheet-mask-bg')).toBe('transparent')
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
