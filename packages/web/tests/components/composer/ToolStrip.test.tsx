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
 * ① 溢出态渐隐标记 data-fade（ResizeObserver/滚动驱动的投影，jsdom 断属性而非像素）；
 * ② PC 指针拖拽滚动（move 过阈值才写 scrollLeft），触摸端不接管（原生滚动）；
 * ③ 拖拽收势吞点击——拖过的那次 click 不落到子控件；
 * ④ 展开面板内部（listbox/input）的按下不触发拖拽。
 * 渐隐 mask 与「展开放开裁剪」的 `:has()` 是纯 CSS（jsdom 无布局），只验属性投影。
 */

import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import '@testing-library/jest-dom/vitest'
import { render, cleanup, fireEvent, screen, act } from '@testing-library/react'
import { ToolStrip, type ToolStripItem } from '@/features/composer/ToolStrip'

// jsdom 无 ResizeObserver：可控行为桩——实例注册进回调表，测试手动触发
const { observers, fireResize, setScrollBox } = vi.hoisted(() => {
    const observers: { cb: ResizeObserverCallback }[] = []
    return {
        observers,
        // cb 驱动的是 React 状态更新，须在 act 内调用才会冲刷
        fireResize: () => act(() => { observers.forEach(({ cb }) => cb([], undefined as unknown as ResizeObserver)) }),
        // scrollWidth/clientWidth 可控（jsdom 布局恒 0）
        setScrollBox: (el: Element, scrollWidth: number, clientWidth: number, scrollLeft = 0) => {
            Object.defineProperty(el, 'scrollWidth', { configurable: true, value: scrollWidth })
            Object.defineProperty(el, 'clientWidth', { configurable: true, value: clientWidth })
            Object.defineProperty(el, 'scrollLeft', { configurable: true, value: scrollLeft, writable: true })
        },
    }
})

vi.stubGlobal('ResizeObserver', class {
    constructor(cb: ResizeObserverCallback) { observers.push({ cb }) }
    observe() {} unobserve() {} disconnect() { observers.length = 0 }
})

const ITEMS: ToolStripItem[] = [
    { key: 'a', render: () => <button onClick={() => clicked('a')}>A</button> },
    { key: 'b', render: () => <button onClick={() => clicked('b')}>B</button> },
]
const clickedLog: string[] = []
function clicked(key: string) { clickedLog.push(key) }

function strip() {
    return render(<ToolStrip items={ITEMS} />)
}

function rootEl() {
    return screen.getByText('A').closest('div')!.parentElement!
}

beforeEach(() => { clickedLog.length = 0 })
afterEach(cleanup)

describe('渐隐标记 data-fade', () => {
    it('不溢出 → none；右侧溢出 → end；滚动到中段 → both；滚到头 → start', () => {
        const { container } = strip()
        const root = container.firstElementChild as HTMLElement
        setScrollBox(root, 200, 200)
        fireResize()
        expect(root).toHaveAttribute('data-fade', 'none')

        setScrollBox(root, 400, 200)
        fireResize()
        expect(root).toHaveAttribute('data-fade', 'end')

        setScrollBox(root, 400, 200, 50)
        fireEvent.scroll(root)
        expect(root).toHaveAttribute('data-fade', 'both')

        setScrollBox(root, 400, 200, 200)
        fireEvent.scroll(root)
        expect(root).toHaveAttribute('data-fade', 'start')
    })
})

describe('PC 拖拽滚动', () => {
    it('指针横移过阈值后驱动 scrollLeft，未过阈值不动', () => {
        const { container } = strip()
        const root = container.firstElementChild as HTMLElement
        setScrollBox(root, 400, 200)
        root.scrollLeft = 100

        fireEvent.pointerDown(screen.getByText('A'), { pointerType: 'mouse', clientX: 100, pointerId: 1 })
        // 2px 内：判点击，不滚
        fireEvent.pointerMove(root, { pointerType: 'mouse', clientX: 98, pointerId: 1 })
        expect(root.scrollLeft).toBe(100)
        // 8px：判拖拽，scrollLeft = 起始 - 位移
        fireEvent.pointerMove(root, { pointerType: 'mouse', clientX: 92, pointerId: 1 })
        expect(root.scrollLeft).toBe(108)
    })

    it('触摸端不接管——指针事件不驱动 scrollLeft（原生滚动负责）', () => {
        const { container } = strip()
        const root = container.firstElementChild as HTMLElement
        setScrollBox(root, 400, 200)
        root.scrollLeft = 100

        fireEvent.pointerDown(screen.getByText('A'), { pointerType: 'touch', clientX: 100, pointerId: 1 })
        fireEvent.pointerMove(root, { pointerType: 'touch', clientX: 50, pointerId: 1 })
        expect(root.scrollLeft).toBe(100)
    })

    it('展开面板内部（listbox/input）按下不触发拖拽', () => {
        render(
            <ToolStrip items={[{ key: 'p', render: () => <div role="listbox"><span>opt</span></div> }]} />,
        )
        const root = document.querySelector('[data-fade]') as HTMLElement
        setScrollBox(root, 400, 200)
        root.scrollLeft = 100

        fireEvent.pointerDown(screen.getByText('opt'), { pointerType: 'mouse', clientX: 100, pointerId: 1 })
        fireEvent.pointerMove(root, { pointerType: 'mouse', clientX: 50, pointerId: 1 })
        expect(root.scrollLeft).toBe(100)
    })
})

describe('拖拽收势吞点击', () => {
    it('拖过之后落点的 click 不进子控件；纯点击照常进', () => {
        const { container } = strip()
        const root = container.firstElementChild as HTMLElement
        setScrollBox(root, 400, 200)

        // 纯点击：进子控件
        fireEvent.pointerDown(screen.getByText('A'), { pointerType: 'mouse', clientX: 100, pointerId: 1 })
        fireEvent.pointerUp(root, { pointerType: 'mouse', pointerId: 1 })
        fireEvent.click(screen.getByText('A'))
        expect(clickedLog).toEqual(['a'])

        // 拖拽收势：click 被吞
        fireEvent.pointerDown(screen.getByText('B'), { pointerType: 'mouse', clientX: 100, pointerId: 2 })
        fireEvent.pointerMove(root, { pointerType: 'mouse', clientX: 90, pointerId: 2 })
        fireEvent.pointerUp(root, { pointerType: 'mouse', pointerId: 2 })
        fireEvent.click(screen.getByText('B'))
        expect(clickedLog).toEqual(['a'])
    })
})

describe('展开补偿（滚动容器放开裁剪时防跳位）', () => {
    it('展开：data-panel-open 置位、负 margin 补回 scrollLeft、窗外项隐藏、窗内项保留', async () => {
        const { container } = strip()
        const root = container.firstElementChild as HTMLElement
        setScrollBox(root, 400, 200)
        root.scrollLeft = 80
        // 两项都在窗外：A 在窗左缘外（offsetLeft 0+宽 < 80），B 需造一项在窗内
        const inner = document.createElement('span')
        inner.innerHTML = '<button role="combobox" aria-expanded="false">M</button>'
        Object.defineProperty(inner, 'offsetLeft', { configurable: true, value: 100 })
        Object.defineProperty(inner, 'offsetWidth', { configurable: true, value: 40 })
        root.querySelector('div')!.appendChild(inner)

        await act(async () => {
            inner.querySelector('button')!.setAttribute('aria-expanded', 'true')
            await Promise.resolve()
        })
        expect(root.getAttribute('data-panel-open')).toBe('true')
        expect((root.querySelector('div') as HTMLElement).style.marginLeft).toBe('-80px')
        expect((screen.getByText('A').parentElement as HTMLElement).style.visibility).toBe('hidden')
        expect(inner.style.visibility).toBe('')
    })

    it('收起：恢复 margin 与隐藏项，并把滚动位还原到展开前的 scrollLeft', async () => {
        const { container } = strip()
        const root = container.firstElementChild as HTMLElement
        setScrollBox(root, 400, 200)
        root.scrollLeft = 80
        const button = screen.getByText('A')

        await act(async () => {
            button.setAttribute('aria-expanded', 'true')
            await Promise.resolve()
        })
        await act(async () => {
            button.setAttribute('aria-expanded', 'false')
            await Promise.resolve()
        })
        expect(root.getAttribute('data-panel-open')).toBeNull()
        expect((root.querySelector('div') as HTMLElement).style.marginLeft).toBe('')
        expect(button.parentElement!.style.visibility).toBe('')
        expect(root.scrollLeft).toBe(80)
    })
})
