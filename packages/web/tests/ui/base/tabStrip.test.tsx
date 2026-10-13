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
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { TabStrip, TabStripList, TabStripTab, TabStripPanel } from '@/ui/base/interactive/tabStrip'

// vitest 未开 globals：渲染型测试必须显式 cleanup，否则 DOM 累积致 getBy* 多元素报错
afterEach(cleanup)

// tab 的可访问名称含标签文字，带关闭按钮时后者的 aria-label 也会算进去——只锚定开头
const tab = (label: string) => screen.getByRole('tab', { name: new RegExp(`^${label}`) })

// 溢出时两端滚动按钮的名称（真机上才有值，这里只是把它从必填项里解放出来）
const SCROLL_LABELS = { left: '向左滚动页签', right: '向右滚动页签' }

describe('TabStrip 受控与键盘', () => {
    it('受控：点击只上报 onValueChange，选中态不自己改（无内部状态）', () => {
        const onChange = vi.fn()
        render(
            <TabStrip value="a" onValueChange={onChange}>
                <TabStripList ariaLabel="面板页签" scrollButtonLabels={SCROLL_LABELS}>
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
                    <TabStripList ariaLabel="面板页签" scrollButtonLabels={SCROLL_LABELS}>
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
                    <TabStripList ariaLabel="面板页签" scrollButtonLabels={SCROLL_LABELS}>
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
                    <TabStripList ariaLabel="面板页签" scrollButtonLabels={SCROLL_LABELS}>
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
                <TabStripList ariaLabel="面板页签" scrollButtonLabels={SCROLL_LABELS}>
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
                <TabStripList ariaLabel="面板页签" scrollButtonLabels={SCROLL_LABELS}>
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
                    <TabStripList ariaLabel="面板页签" scrollButtonLabels={SCROLL_LABELS}>
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
                    <TabStripList ariaLabel="面板页签" scrollButtonLabels={SCROLL_LABELS}>
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
})

describe('TabStrip 面板挂载', () => {
    const renderPanels = (keepMounted?: boolean) => {
        function Harness() {
            const [value, setValue] = useState('a')
            return (
                <TabStrip value={value} onValueChange={setValue}>
                    <TabStripList ariaLabel="面板页签" scrollButtonLabels={SCROLL_LABELS}>
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

describe('TabStrip 结构契约', () => {
    it('extra 在 tablist 之外，不是任何 role="tab" 的后代', () => {
        render(
            <TabStrip value="a" onValueChange={() => {}}>
                <TabStripList ariaLabel="面板页签" scrollButtonLabels={SCROLL_LABELS} extra={<button type="button">新建</button>}>
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
                <TabStripList ariaLabel="面板页签" scrollButtonLabels={SCROLL_LABELS}>
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
                    <TabStripList ariaLabel="面板页签" scrollButtonLabels={SCROLL_LABELS}>
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

    it('溢出才渲染两端滚动按钮，且起点只有向右可用', () => {
        // jsdom 不做布局（clientWidth/scrollWidth 恒 0），量不到溢出——临时桩成溢出态。
        // 两个属性定义在 Element.prototype 上，故在 HTMLElement.prototype 上影子覆盖，用完删除还原
        const origClient = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientWidth')
        const origScroll = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollWidth')
        Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => 100 })
        Object.defineProperty(HTMLElement.prototype, 'scrollWidth', { configurable: true, get: () => 300 })
        try {
            render(
                <TabStrip value="a" onValueChange={() => {}}>
                    <TabStripList ariaLabel="面板页签" scrollButtonLabels={SCROLL_LABELS}>
                        <TabStripTab value="a">A</TabStripTab>
                    </TabStripList>
                </TabStrip>,
            )
            expect(screen.getByLabelText('向右滚动页签')).toBeEnabled()
            // 滚在最左，左边没内容可回——按钮在但不可用
            expect(screen.getByLabelText('向左滚动页签')).toBeDisabled()
        } finally {
            if (origClient) Object.defineProperty(HTMLElement.prototype, 'clientWidth', origClient)
            else delete (HTMLElement.prototype as unknown as Record<string, unknown>).clientWidth
            if (origScroll) Object.defineProperty(HTMLElement.prototype, 'scrollWidth', origScroll)
            else delete (HTMLElement.prototype as unknown as Record<string, unknown>).scrollWidth
        }
    })

    it('未溢出时不渲染滚动按钮（无谓的控件不进 DOM）', () => {
        render(
            <TabStrip value="a" onValueChange={() => {}}>
                <TabStripList ariaLabel="面板页签" scrollButtonLabels={SCROLL_LABELS}>
                    <TabStripTab value="a">A</TabStripTab>
                </TabStripList>
            </TabStrip>,
        )
        expect(screen.queryByLabelText('向右滚动页签')).toBeNull()
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
                    <TabStripList ariaLabel="面板页签" scrollButtonLabels={SCROLL_LABELS}>
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
