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
 * TabStrip 行为契约（自建件，无上游）：
 * - 受控 + 键盘（Arrow/Home/End，自动激活）+ a11y 串联（tab ↔ tabpanel）
 * - 关闭语义：关闭非活动 tab 不改选中；关闭活动 tab 焦点落到顶上的那一项
 * - 面板挂载：默认切走即卸载；keepMounted 首次激活后常驻且非活动 display:none
 * - extra 槽在 tablist 外侧（不在任何 role="tab" 内）——dropdown 触发器落 tab 内会当场关菜单
 */

import { describe, it, expect, vi, afterEach } from 'vitest'
import { useState } from 'react'
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { TabStrip, TabStripList, TabStripTab, TabStripPanel } from '@/ui/base/interactive/tabStrip'

// vitest 未开 globals：渲染型测试必须显式 cleanup，否则 DOM 累积致 getBy* 多元素报错
afterEach(cleanup)

// tab 的可访问名称含标签文字，带关闭按钮时后者的 aria-label 也会算进去——只锚定开头
const tab = (label: string) => screen.getByRole('tab', { name: new RegExp(`^${label}`) })

describe('TabStrip 受控与键盘', () => {
    it('受控：点击只上报 onValueChange，选中态不自己改（无内部状态）', () => {
        const onChange = vi.fn()
        render(
            <TabStrip value="a" onValueChange={onChange}>
                <TabStripList ariaLabel="面板页签">
                    <TabStripTab value="a">A</TabStripTab>
                    <TabStripTab value="b">B</TabStripTab>
                </TabStripList>
            </TabStrip>,
        )

        fireEvent.click(tab('B'))
        expect(onChange).toHaveBeenCalledWith('b')
        expect(tab('A')).toHaveAttribute('aria-selected', 'true')
    })

    it('消费方回填 value 后选中态随之翻转', () => {
        function Harness() {
            const [value, setValue] = useState('a')
            return (
                <TabStrip value={value} onValueChange={setValue}>
                    <TabStripList ariaLabel="面板页签">
                        <TabStripTab value="a">A</TabStripTab>
                        <TabStripTab value="b">B</TabStripTab>
                    </TabStripList>
                </TabStrip>
            )
        }
        render(<Harness />)

        fireEvent.click(tab('B'))
        expect(tab('B')).toHaveAttribute('aria-selected', 'true')
        expect(tab('A')).toHaveAttribute('aria-selected', 'false')
    })

    it('ArrowRight 移动焦点与选中（自动激活）；端点不循环', () => {
        function Harness() {
            const [value, setValue] = useState('a')
            return (
                <TabStrip value={value} onValueChange={setValue}>
                    <TabStripList ariaLabel="面板页签">
                        <TabStripTab value="a">A</TabStripTab>
                        <TabStripTab value="b">B</TabStripTab>
                        <TabStripTab value="c">C</TabStripTab>
                    </TabStripList>
                </TabStrip>
            )
        }
        render(<Harness />)

        tab('A').focus()
        fireEvent.keyDown(tab('A'), { key: 'ArrowRight' })
        expect(document.activeElement).toBe(tab('B'))
        expect(tab('B')).toHaveAttribute('aria-selected', 'true')

        fireEvent.keyDown(tab('B'), { key: 'ArrowRight' })
        fireEvent.keyDown(tab('C'), { key: 'ArrowRight' })
        expect(document.activeElement).toBe(tab('C'))

        fireEvent.keyDown(tab('C'), { key: 'Home' })
        expect(document.activeElement).toBe(tab('A'))
    })

    it('disabled 的 tab 被方向键跳过', () => {
        function Harness() {
            const [value, setValue] = useState('a')
            return (
                <TabStrip value={value} onValueChange={setValue}>
                    <TabStripList ariaLabel="面板页签">
                        <TabStripTab value="a">A</TabStripTab>
                        <TabStripTab value="b" disabled>B</TabStripTab>
                        <TabStripTab value="c">C</TabStripTab>
                    </TabStripList>
                </TabStrip>
            )
        }
        render(<Harness />)

        tab('A').focus()
        fireEvent.keyDown(tab('A'), { key: 'ArrowRight' })
        expect(document.activeElement).toBe(tab('C'))
        expect(tab('B')).toHaveAttribute('aria-disabled', 'true')
    })

    it('tab 与面板通过 aria-controls / aria-labelledby 串联', () => {
        render(
            <TabStrip value="a" onValueChange={() => {}}>
                <TabStripList ariaLabel="面板页签">
                    <TabStripTab value="a">A</TabStripTab>
                </TabStripList>
                <TabStripPanel value="a">内容 A</TabStripPanel>
            </TabStrip>,
        )

        const t = tab('A')
        const panel = screen.getByRole('tabpanel')
        expect(panel.id).toBeTruthy()
        expect(t).toHaveAttribute('aria-controls', panel.id)
        expect(panel).toHaveAttribute('aria-labelledby', t.id)
    })
})

describe('TabStrip 关闭语义', () => {
    it('关闭非活动 tab：不改选中（click 不冒泡到 tab）', () => {
        const onChange = vi.fn()
        const onClose = vi.fn()
        render(
            <TabStrip value="a" onValueChange={onChange}>
                <TabStripList ariaLabel="面板页签">
                    <TabStripTab value="a">A</TabStripTab>
                    <TabStripTab value="b" onClose={onClose} closeLabel="关闭 B">B</TabStripTab>
                </TabStripList>
            </TabStrip>,
        )

        fireEvent.click(screen.getByLabelText('关闭 B'))
        expect(onClose).toHaveBeenCalledTimes(1)
        expect(onChange).not.toHaveBeenCalled()
    })

    it('关闭活动 tab：消费方换选中后，焦点落到顶上的那一项', () => {
        function Harness() {
            const [value, setValue] = useState('a')
            const [values, setValues] = useState(['a', 'b', 'c'])
            return (
                <TabStrip value={value} onValueChange={setValue}>
                    <TabStripList ariaLabel="面板页签">
                        {values.map((v) => (
                            <TabStripTab
                                key={v}
                                value={v}
                                closeLabel={`关闭 ${v.toUpperCase()}`}
                                onClose={() => {
                                    setValues((prev) => prev.filter((x) => x !== v))
                                    if (value === v) {
                                        const i = values.indexOf(v)
                                        setValue(values[i + 1] ?? values[i - 1])
                                    }
                                }}
                            >
                                {v.toUpperCase()}
                            </TabStripTab>
                        ))}
                    </TabStripList>
                </TabStrip>
            )
        }
        render(<Harness />)

        fireEvent.click(screen.getByLabelText('关闭 A'))
        expect(document.activeElement).toBe(tab('B'))
    })

    it('消费方未改选中（value 指向已关的 tab）时，焦点按落点规则兜底', () => {
        function Harness() {
            const [values, setValues] = useState(['a', 'b', 'c'])
            return (
                <TabStrip value="a" onValueChange={() => {}}>
                    <TabStripList ariaLabel="面板页签">
                        {values.map((v) => (
                            <TabStripTab
                                key={v}
                                value={v}
                                closeLabel={`关闭 ${v.toUpperCase()}`}
                                onClose={() => setValues((prev) => prev.filter((x) => x !== v))}
                            >
                                {v.toUpperCase()}
                            </TabStripTab>
                        ))}
                    </TabStripList>
                </TabStrip>
            )
        }
        render(<Harness />)

        fireEvent.click(screen.getByLabelText('关闭 A'))
        expect(document.activeElement).toBe(tab('B'))
    })

    it('关闭被消费方拦下（tab 还在）时不抢焦点：待办就地作废', () => {
        // 未保存文件的确认框就长这样：点了 × 但页签没被删掉
        function Harness() {
            const [, setBump] = useState(0)
            return (
                <div>
                    <button type="button" data-testid="outside">
                        别处
                    </button>
                    <button type="button" data-testid="bump" onClick={() => setBump((n) => n + 1)}>
                        重渲染
                    </button>
                    <TabStrip value="a" onValueChange={() => {}}>
                        <TabStripList ariaLabel="面板页签">
                            <TabStripTab value="a" closeLabel="关闭 A" onClose={() => {}}>
                                A
                            </TabStripTab>
                        </TabStripList>
                    </TabStrip>
                </div>
            )
        }
        const { getByTestId } = render(<Harness />)
        getByTestId('outside').focus()
        fireEvent.click(screen.getByLabelText('关闭 A'))

        // 任何后续渲染都不该把焦点抢到页签上（消费方没删 tab = 这次关闭没成交）
        const before = document.activeElement
        fireEvent.click(getByTestId('bump'))
        expect(document.activeElement).toBe(before)
    })
})

describe('TabStrip 面板挂载', () => {
    const renderPanels = (keepMounted?: boolean) => {
        function Harness() {
            const [value, setValue] = useState('a')
            return (
                <TabStrip value={value} onValueChange={setValue}>
                    <TabStripList ariaLabel="面板页签">
                        <TabStripTab value="a">A</TabStripTab>
                        <TabStripTab value="b">B</TabStripTab>
                    </TabStripList>
                    <TabStripPanel value="a" keepMounted={keepMounted}>
                        <div data-testid="panel-a">A 内容</div>
                    </TabStripPanel>
                    <TabStripPanel value="b" keepMounted={keepMounted}>
                        <div data-testid="panel-b">B 内容</div>
                    </TabStripPanel>
                </TabStrip>
            )
        }
        return render(<Harness />)
    }

    it('默认：未激活的面板不在 DOM 里', () => {
        renderPanels()
        expect(screen.queryByTestId('panel-b')).toBeNull()
    })

    it.each([undefined, true])('每个页签的 aria-controls 都有落点（keepMounted=%s）', (keepMounted) => {
        // 面板懒挂载：未激活的那些必须仍渲染外壳，否则 aria-controls 指向不存在的 id
        // （axe 的 aria-valid-attr-value 会据此报错）
        renderPanels(keepMounted)
        for (const t of screen.getAllByRole('tab')) {
            const id = t.getAttribute('aria-controls')
            expect(id).toBeTruthy()
            expect(document.getElementById(id as string)).not.toBeNull()
        }
    })

    it('keepMounted：切走不卸载（同一 DOM 节点），且被 display:none 隐藏', () => {
        renderPanels(true)
        const node = screen.getByTestId('panel-a')
        expect(node.parentElement).not.toHaveStyle({ display: 'none' })

        fireEvent.click(tab('B'))
        expect(screen.getByTestId('panel-a')).toBe(node)
        expect(node.parentElement).toHaveStyle({ display: 'none' })
        expect(screen.getByTestId('panel-b').parentElement).not.toHaveStyle({ display: 'none' })

        fireEvent.click(tab('A'))
        expect(screen.getByTestId('panel-a')).toBe(node)
    })
})

describe('TabStrip 拖拽滚动', () => {
    // jsdom 没有 PointerEvent：造个普通 Event 把字段挂上去——React 是按属性名从原生事件上取值的
    const pointer = (type: string, props: Record<string, unknown>) => Object.assign(new Event(type, { bubbles: true, cancelable: true }), props)

    const renderStrip = (onChange = vi.fn()) => {
        const { container } = render(
            <TabStrip value="a" onValueChange={onChange}>
                <TabStripList ariaLabel="面板页签">
                    <TabStripTab value="a">A</TabStripTab>
                    <TabStripTab value="b">B</TabStripTab>
                </TabStripList>
            </TabStrip>,
        )
        return { container, onChange, viewport: container.querySelector('[data-dragging]') as HTMLElement }
    }
    const drag = (viewport: HTMLElement, from: number, to: number) => {
        viewport.dispatchEvent(pointer('pointerdown', { pointerId: 1, pointerType: 'mouse', button: 0, buttons: 1, clientX: from }))
        viewport.dispatchEvent(pointer('pointermove', { pointerId: 1, pointerType: 'mouse', buttons: 1, clientX: to }))
        viewport.dispatchEvent(pointer('pointerup', { pointerId: 1, pointerType: 'mouse', button: 0, buttons: 0, clientX: to }))
    }

    it('拖过阈值：随后那一下 click 被吞掉（松手不切页签）', () => {
        const { viewport, onChange } = renderStrip()
        drag(viewport, 200, 140)

        fireEvent.click(tab('B'))
        expect(onChange).not.toHaveBeenCalled()
    })

    it('拖过阈值后，下一次正常的点击照常生效（吞噬只针对紧跟拖动的那一下）', () => {
        const { viewport, onChange } = renderStrip()
        drag(viewport, 200, 140)
        fireEvent.click(tab('B'))
        fireEvent.click(tab('B'))

        expect(onChange).toHaveBeenCalledTimes(1)
        expect(onChange).toHaveBeenCalledWith('b')
    })

    it('位移小于阈值当作点击（手抖不吞 click，也不进拖动态）', () => {
        const { viewport, onChange } = renderStrip()
        drag(viewport, 200, 198)

        expect(viewport).toHaveAttribute('data-dragging', 'false')
        fireEvent.click(tab('B'))
        expect(onChange).toHaveBeenCalledWith('b')
    })

    it('拖动期间打上 data-dragging（抓手光标由它命中），松手复位', () => {
        const { viewport } = renderStrip()
        // 裸 dispatchEvent 不进 act：拖动态是 React state，得手动冲一下才看得到 DOM 更新
        act(() => {
            viewport.dispatchEvent(pointer('pointerdown', { pointerId: 1, pointerType: 'mouse', button: 0, clientX: 200 }))
            viewport.dispatchEvent(pointer('pointermove', { pointerId: 1, pointerType: 'mouse', clientX: 140 }))
        })
        expect(viewport).toHaveAttribute('data-dragging', 'true')

        act(() => {
            viewport.dispatchEvent(pointer('pointerup', { pointerId: 1, pointerType: 'mouse', clientX: 140 }))
        })
        expect(viewport).toHaveAttribute('data-dragging', 'false')
    })

    it('触摸不走自建拖拽（交给浏览器原生滚动），页面照常切页签', () => {
        const { viewport, onChange } = renderStrip()
        viewport.dispatchEvent(pointer('pointerdown', { pointerId: 2, pointerType: 'touch', button: 0, buttons: 1, clientX: 200 }))
        viewport.dispatchEvent(pointer('pointermove', { pointerId: 2, pointerType: 'touch', buttons: 1, clientX: 100 }))
        expect(viewport).toHaveAttribute('data-dragging', 'false')
        viewport.dispatchEvent(pointer('pointerup', { pointerId: 2, pointerType: 'touch', button: 0, buttons: 0, clientX: 100 }))

        fireEvent.click(tab('B'))
        expect(onChange).toHaveBeenCalledWith('b')
    })

    it('阈值内按下、在视口外松开后：无按键划过不会变成拖动（幽灵拖拽）', () => {
        const { viewport } = renderStrip()
        // 没超阈值就不抓指针 → 松手落在视口外时 pointerup 收不到，这条 drag 会留在 ref 里
        viewport.dispatchEvent(pointer('pointerdown', { pointerId: 1, pointerType: 'mouse', button: 0, buttons: 1, clientX: 200 }))
        viewport.dispatchEvent(pointer('pointermove', { pointerId: 1, pointerType: 'mouse', buttons: 1, clientX: 202 }))
        document.body.dispatchEvent(pointer('pointerup', { pointerId: 1, pointerType: 'mouse', button: 0, buttons: 0, clientX: 400 }))

        // 之后只是把鼠标划过页签条（没有按键）——不该滚、也不该进拖动态
        act(() => {
            viewport.dispatchEvent(pointer('pointermove', { pointerId: 1, pointerType: 'mouse', buttons: 0, clientX: 320 }))
        })
        expect(viewport.scrollLeft).toBe(0)
        expect(viewport).toHaveAttribute('data-dragging', 'false')
    })
})

describe('TabStrip 结构契约', () => {
    it('extra 在 tablist 之外，不是任何 role="tab" 的后代', () => {
        render(
            <TabStrip value="a" onValueChange={() => {}}>
                <TabStripList ariaLabel="面板页签" extra={<button type="button">新建</button>}>
                    <TabStripTab value="a">A</TabStripTab>
                </TabStripList>
            </TabStrip>,
        )

        const list = screen.getByRole('tablist')
        const extra = screen.getByRole('button', { name: '新建' })
        // tablist 现在被 Viewport（滚动视口）包着，与 extra 不再直接相邻——找共同的那一行
        const row = list.closest('[data-tab-strip-row]')
        expect(row).not.toBeNull()
        expect(list.contains(extra)).toBe(false)
        expect(row?.contains(extra)).toBe(true)
        expect(tab('A').contains(extra)).toBe(false)
    })

    it('页签有可读下限（min-width 不为 0）：否则收缩压力传到底、tablist 永不溢出，横向滚动成死代码', () => {
        render(
            <TabStrip value="a" onValueChange={() => {}}>
                <TabStripList ariaLabel="面板页签">
                    <TabStripTab value="a">A</TabStripTab>
                </TabStripList>
            </TabStrip>,
        )

        const minWidth = parseFloat(getComputedStyle(tab('A')).minWidth)
        expect(minWidth).toBeGreaterThan(0)
    })

    it('选中块是垫在文字下的一块浮起面，且全程只有一份（滑移动效的前提）', () => {
        function Harness() {
            const [value, setValue] = useState('a')
            return (
                <TabStrip value={value} onValueChange={setValue}>
                    <TabStripList ariaLabel="面板页签">
                        <TabStripTab value="a">A</TabStripTab>
                        <TabStripTab value="b">B</TabStripTab>
                    </TabStripList>
                </TabStrip>
            )
        }
        render(<Harness />)

        const selected = tab('A').querySelector('[data-tab-selection]') as HTMLElement
        expect(selected).not.toBeNull()
        // z-index:-1 + 绝对定位 = 垫在标签文字之下的一块独立面，而不是页签自己的底色
        expect(getComputedStyle(selected).zIndex).toBe('-1')
        expect(getComputedStyle(selected).position).toBe('absolute')

        fireEvent.click(tab('B'))
        expect(document.querySelectorAll('[data-tab-selection]')).toHaveLength(1)
        expect(tab('B').contains(document.querySelector('[data-tab-selection]'))).toBe(true)
    })

    it('两端渐隐由 data-left / data-right 驱动：溢出时右端标真、滚到最左时左端标假', () => {
        // jsdom 不做布局（clientWidth/scrollWidth 恒 0），量不到溢出——临时桩成「内容 300 / 视口 100」。
        // 两个属性定义在 Element.prototype 上，故在 HTMLElement.prototype 上影子覆盖，用完删除还原
        const origClient = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientWidth')
        const origScroll = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollWidth')
        Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => 100 })
        Object.defineProperty(HTMLElement.prototype, 'scrollWidth', { configurable: true, get: () => 300 })
        try {
            const { container } = render(
                <TabStrip value="a" onValueChange={() => {}}>
                    <TabStripList ariaLabel="面板页签">
                        <TabStripTab value="a">A</TabStripTab>
                    </TabStripList>
                </TabStrip>,
            )
            const shell = container.querySelector('[data-tab-strip-row] > div') as HTMLElement
            expect(shell).toHaveAttribute('data-right', 'true')
            // scrollLeft 0：左边没有可回的内容，左端不该渐隐
            expect(shell).toHaveAttribute('data-left', 'false')
        } finally {
            if (origClient) Object.defineProperty(HTMLElement.prototype, 'clientWidth', origClient)
            else delete (HTMLElement.prototype as unknown as Record<string, unknown>).clientWidth
            if (origScroll) Object.defineProperty(HTMLElement.prototype, 'scrollWidth', origScroll)
            else delete (HTMLElement.prototype as unknown as Record<string, unknown>).scrollWidth
        }
    })

    it('未溢出时两端都不渐隐（内容全在视口里，没有「那边还有」可暗示）', () => {
        const { container } = render(
            <TabStrip value="a" onValueChange={() => {}}>
                <TabStripList ariaLabel="面板页签">
                    <TabStripTab value="a">A</TabStripTab>
                </TabStripList>
            </TabStrip>,
        )
        const shell = container.querySelector('[data-tab-strip-row] > div') as HTMLElement
        expect(shell).toHaveAttribute('data-left', 'false')
        expect(shell).toHaveAttribute('data-right', 'false')
    })

    it('prefers-reduced-motion 下渲染不抛错', () => {
        const original = window.matchMedia
        window.matchMedia = ((query: string) => ({
            matches: query.includes('prefers-reduced-motion'),
            media: query,
            onchange: null,
            addEventListener: () => {},
            removeEventListener: () => {},
            addListener: () => {},
            removeListener: () => {},
            dispatchEvent: () => false,
        })) as unknown as typeof window.matchMedia

        try {
            render(
                <TabStrip value="a" onValueChange={() => {}}>
                    <TabStripList ariaLabel="面板页签">
                        <TabStripTab value="a">A</TabStripTab>
                    </TabStripList>
                    <TabStripPanel value="a">内容</TabStripPanel>
                </TabStrip>,
            )
            expect(screen.getByRole('tabpanel')).toBeInTheDocument()
        } finally {
            window.matchMedia = original
        }
    })
})
