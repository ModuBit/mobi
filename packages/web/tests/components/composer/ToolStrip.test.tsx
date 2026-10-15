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
 * ToolStrip（composer 参数条）行为契约：
 * ① 条不是滚动容器——平移写在 row 的 transform 上（展开面板因此无需切换 overflow）；
 * ② 溢出态渐隐标记 data-fade 随平移量变化；
 * ③ 拖拽（PC 与触摸统一 pointer 事件）过阈值才平移，且夹在 [-(content-view), 0]；
 * ④ 松手吸附到项边界；⑤ 拖拽收势吞点击；⑥ 展开面板内部按下不触发拖动；
 * ⑦ 焦点进入时自动平移可见。
 * 视觉裁剪与渐隐是纯 CSS（jsdom 无布局）；「展开放开裁剪」只验 data-panel 属性投影
 * （开合信号来自 morph 根元素的 data-open 属性）与逐项修饰的样式结果。
 */

import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import '@testing-library/jest-dom/vitest'
import { render, cleanup, fireEvent, screen, act } from '@testing-library/react'
import { ToolStrip, type ToolStripItem } from '@/features/composer/ToolStrip'

// jsdom 无布局：把 root.clientWidth / row 宽度 / 项 offsetLeft 设成可控值；
// ResizeObserver 桩收集回调供测试手动触发（尺寸设好后重算一次渐隐/夹紧）
const resizeCallbacks: ResizeObserverCallback[] = []
vi.stubGlobal('ResizeObserver', class {
    constructor(cb: ResizeObserverCallback) { resizeCallbacks.push(cb) }
    observe() {}
    unobserve() {}
    disconnect() { resizeCallbacks.pop() }
})

/** 手动触发一次尺寸重算（真实环境由 ResizeObserver 驱动） */
function fireResize() {
    act(() => { resizeCallbacks.forEach((cb) => cb([], undefined as unknown as ResizeObserver)) })
}

const clickedLog: string[] = []
function clicked(key: string) { clickedLog.push(key) }

const ITEMS: ToolStripItem[] = [
    { key: 'a', content: <button onClick={() => clicked('a')}>A</button> },
    { key: 'b', content: <button onClick={() => clicked('b')}>B</button> },
]

/** 造出「内容 400 / 视口 200」的布局：两个项各 200 宽，项起点 0 与 200 */
function strip(items: ToolStripItem[] = ITEMS) {
    const utils = render(<ToolStrip items={items} />)
    const root = utils.container.firstElementChild as HTMLElement
    const row = root.firstElementChild as HTMLElement
    Object.defineProperty(root, 'clientWidth', { configurable: true, value: 200 })
    row.getBoundingClientRect = () => ({ width: 400, height: 36, top: 0, left: 0, right: 400, bottom: 36, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect
    const spans = Array.from(row.children) as HTMLElement[]
    spans.forEach((span, i) => {
        Object.defineProperty(span, 'offsetLeft', { configurable: true, value: i * 200 })
        Object.defineProperty(span, 'offsetWidth', { configurable: true, value: 200 })
    })
    fireResize()
    return { root, row, spans }
}

function rowTransform(row: HTMLElement): string {
    return row.style.transform
}

/** 一次「从 fromX 按下并拖到 toX」的指针序列（是否跨越 slop 阈值由移动距离决定） */
function dragTo(el: HTMLElement, root: HTMLElement, toX: number,
    { fromX = 100, pointerId = 1, pointerType = 'mouse' } = {}) {
    fireEvent.pointerDown(el, { pointerType, clientX: fromX, pointerId })
    fireEvent.pointerMove(root, { pointerType, clientX: toX, pointerId })
}

beforeEach(() => { clickedLog.length = 0 })
afterEach(cleanup)

describe('平移与渐隐', () => {
    it('初始不位移；拖动后 transform 跟手、渐隐从 end 转 both、夹到右端转 start', () => {
        const { root, row } = strip()
        expect(rowTransform(row)).toBe('translateX(0px)')
        expect(root).toHaveAttribute('data-fade', 'end')

        dragTo(screen.getByText('A'), root, 40)
        expect(rowTransform(row)).toBe('translateX(-60px)')
        expect(root).toHaveAttribute('data-fade', 'both')

        // 越过右端被夹在 -(400-200)
        fireEvent.pointerMove(root, { pointerType: 'mouse', clientX: -400, pointerId: 1 })
        expect(rowTransform(row)).toBe('translateX(-200px)')
        expect(root).toHaveAttribute('data-fade', 'start')
    })

    it('不溢出时不位移、无渐隐', () => {
        const { root, row } = strip()
        row.getBoundingClientRect = () => ({ width: 200 }) as DOMRect
        fireResize()
        dragTo(screen.getByText('A'), root, 0)
        expect(rowTransform(row)).toBe('translateX(0px)')
        expect(root).toHaveAttribute('data-fade', 'none')
    })
})

describe('拖拽判据', () => {
    it('触摸端同样可拖（pointer 事件统一处理）', () => {
        const { root, row } = strip()
        dragTo(screen.getByText('A'), root, 60, { pointerType: 'touch' })
        expect(rowTransform(row)).toBe('translateX(-40px)')
    })

    it('阈值内视为点击，不平移', () => {
        const { root, row } = strip()
        dragTo(screen.getByText('A'), root, 97)
        expect(rowTransform(row)).toBe('translateX(0px)')
    })

    it('展开面板内部（listbox/input）按下不触发拖动', () => {
        const { root, row } = strip([{ key: 'p', content: <div role="listbox"><span>opt</span></div> }])
        dragTo(screen.getByText('opt'), root, 40)
        expect(rowTransform(row)).toBe('translateX(0px)')
    })

    it('拖拽收势吞点击；纯点击照常进子控件', () => {
        const { root } = strip()
        fireEvent.pointerDown(screen.getByText('A'), { pointerType: 'mouse', clientX: 100, pointerId: 1 })
        fireEvent.pointerUp(root, { pointerType: 'mouse', pointerId: 1 })
        fireEvent.click(screen.getByText('A'))
        expect(clickedLog).toEqual(['a'])

        dragTo(screen.getByText('B'), root, 60, { pointerId: 2 })
        fireEvent.pointerUp(root, { pointerType: 'mouse', pointerId: 2 })
        fireEvent.click(screen.getByText('B'))
        expect(clickedLog).toEqual(['a'])
    })
})

describe('松手吸附', () => {
    it('吸附到最近的项边界 / 两端（-60 → 0；-140 距 -200 更近 → -200）', () => {
        const { root, row } = strip()
        dragTo(screen.getByText('A'), root, 40)
        fireEvent.pointerUp(root, { pointerType: 'mouse', pointerId: 1 })
        expect(rowTransform(row)).toBe('translateX(0px)')

        dragTo(screen.getByText('A'), root, 160, { fromX: 300, pointerId: 2 })
        fireEvent.pointerUp(root, { pointerType: 'mouse', pointerId: 2 })
        expect(rowTransform(row)).toBe('translateX(-200px)')
    })
})

describe('焦点可见（仅键盘）', () => {
    it('键盘交互后焦点落到滚动外的项时自动平移进视野', async () => {
        const { root, row } = strip()
        const itemB = screen.getByText('B').closest('[data-strip-item]') as HTMLElement
        await act(async () => {
            fireEvent.keyDown(document, { key: 'Tab' })
            itemB.querySelector('button')!.focus()
            await new Promise((resolve) => window.requestAnimationFrame(() => resolve(null)))
        })
        // B 在 [200,400]，视口 [0,200] → 平移到 -200 使其右缘齐视口
        expect(rowTransform(row)).toBe('translateX(-200px)')
        expect(root).toHaveAttribute('data-fade', 'start')
    })

    it('指针交互后焦点不再平移（展开 pill 时 morph 会把焦点设到 trigger，平移会把内容顶走）', async () => {
        const { root, row } = strip()
        const itemB = screen.getByText('B').closest('[data-strip-item]') as HTMLElement
        await act(async () => {
            fireEvent.pointerDown(screen.getByText('A'), { pointerType: 'mouse', clientX: 100, pointerId: 1 })
            itemB.querySelector('button')!.focus()
            await new Promise((resolve) => window.requestAnimationFrame(() => resolve(null)))
        })
        expect(rowTransform(row)).toBe('translateX(0px)')
        expect(root).toHaveAttribute('data-fade', 'end')
    })
})

describe('展开期间撤视觉裁剪（交互契约）', () => {
    it('面板展开（morph 根元素带 data-open）→ data-panel=open；收起后延时恢复（保住 morph 退场动画）', async () => {
        const { root } = strip([{ key: 'p', content: <button>P</button> }])
        const trigger = screen.getByText('P')
        expect(root).not.toHaveAttribute('data-panel')

        await act(async () => {
            trigger.setAttribute('data-open', '')
            await Promise.resolve()
        })
        expect(root).toHaveAttribute('data-panel', 'open')

        await act(async () => {
            trigger.removeAttribute('data-open')
            await Promise.resolve()
        })
        // 退场窗口内仍不裁剪；且必须活过 morph 收起动画全程（~300ms）——
        // 定时器若中途到期，仍宽于 pill 的 shape 会被突然截断（回归判据）
        await act(async () => { await new Promise((resolve) => setTimeout(resolve, 320)) })
        expect(root).toHaveAttribute('data-panel', 'open')

        await act(async () => { await new Promise((resolve) => setTimeout(resolve, 160)) })
        expect(root).not.toHaveAttribute('data-panel')
    })

    it('展开时逐项窗口修饰：越界项裁到窗口 + 按条渐隐曲线投影 mask；展开项两者都不加', async () => {
        const { root, spans } = strip([
            { key: 'a', content: <button>A</button> },
            { key: 'b', content: <button>B</button> },
        ])
        const triggerA = screen.getByText('A')
        // 项 B 跨窗口右缘（视口 200）：[150, 250] → 项内 50px 起是窗口外
        Object.defineProperty(spans[1], 'offsetLeft', { configurable: true, value: 150 })
        Object.defineProperty(spans[1], 'offsetWidth', { configurable: true, value: 100 })
        await act(async () => {
            triggerA.setAttribute('data-open', '')
            await Promise.resolve()
        })
        fireResize()

        expect(spans[0].style.clipPath).toBe('')          // 展开项：面板要越出条边界
        expect(spans[0].style.maskImage).toBe('')          // 展开项：渐隐也不能加（会裁面板）
        expect(spans[1].style.clipPath).toBe('inset(0px 50.0px 0px 0.0px)') // 越界项：右缘裁到窗口
        // 跨边界项带完整渐隐段：窗口内 alpha 1 → 窗口外 alpha 0
        expect(spans[1].style.maskImage).toContain('linear-gradient')
        expect(spans[1].style.maskImage).toMatch(/rgb\(0, 0, 0\) 0\.0px/)       // 窗口内 alpha 1
        expect(spans[1].style.maskImage).toMatch(/rgba\(0, 0, 0, 0\) 50\.0px/)  // 窗口外 alpha 0

        await act(async () => {
            triggerA.removeAttribute('data-open')
            await new Promise((resolve) => setTimeout(resolve, 460))
        })
        expect(spans[1].style.clipPath).toBe('')
        expect(spans[1].style.maskImage).toBe('')
        expect(root).not.toHaveAttribute('data-panel')
    })
})
