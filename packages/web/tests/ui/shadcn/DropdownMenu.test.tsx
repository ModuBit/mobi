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
 * uiarc dropdown-menu 的 mobi 本地修改守卫（试点：会话行 kebab）：
 * - Root 走 modal={false}——Radix 默认 modal 会把 body 置 pointer-events:none，
 *   开着一个菜单时整页指针事件失效，与 antd Dropdown（非模态、点别的触发器即切换）不一致；
 * - 多个实例互斥：开第二个会关掉第一个（外点关闭链路）。
 */

import { describe, it, expect, vi, afterEach, beforeAll } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { DropdownMenu } from '@/ui/shadcn/dropdown-menu/dropdown-menu'

// jsdom 无 ResizeObserver（组件内 TriggerLabel 依赖）
beforeAll(() => {
    vi.stubGlobal('ResizeObserver', class {
        observe() {}
        unobserve() {}
        disconnect() {}
    })
})

// vitest 未开 globals：渲染型测试必须显式 cleanup，否则 DOM 累积致 getBy* 多元素报错
afterEach(cleanup)

const items = [{ label: '移至最近' }, { label: '删除', destructive: true }]

/** 两个独立实例，模拟侧边栏里两行各自的 kebab */
function renderTwo() {
    render(
        <div>
            <DropdownMenu trigger={<button type="button">甲行</button>} items={items} />
            <DropdownMenu trigger={<button type="button">乙行</button>} items={items} />
        </div>
    )
    return { first: screen.getByText('甲行'), second: screen.getByText('乙行') }
}

/** Radix 在 pointerdown 上展开，非 click */
const openMenu = (el: HTMLElement) => fireEvent.pointerDown(el, { button: 0 })

describe('DropdownMenu 的 mobi 本地修改', () => {
    it('非模态：展开菜单不会把 body 置为 pointer-events:none', () => {
        const { first } = renderTwo()
        openMenu(first)

        expect(screen.getAllByRole('menuitem')).toHaveLength(2)
        // modal={true} 时 Radix 会写 body.style.pointerEvents='none'，整页点不动
        expect(document.body.style.pointerEvents).not.toBe('none')
    })

    it('开第二个菜单会关掉第一个（不并存）', () => {
        const { first, second } = renderTwo()

        openMenu(first)
        expect(first).toHaveAttribute('data-state', 'open')
        expect(screen.getAllByRole('menu')).toHaveLength(1)

        openMenu(second)
        expect(second).toHaveAttribute('data-state', 'open')
        expect(first).toHaveAttribute('data-state', 'closed')
        expect(screen.getAllByRole('menu')).toHaveLength(1)
    })
})

/**
 * 弹层内容结构重写（本地修改 2）：items 从「扁平字符串」扩到递归树 + 非菜单项内容。
 * 这些能力是迁移 antd Dropdown 站点（审查范围档的提交子菜单、提交列表滚动哨兵）的前提。
 */
describe('DropdownMenu 的 items 结构', () => {
    it('children 非空 → 子菜单：触发器带 aria-haspopup，展开后是第二个 role=menu', () => {
        render(
            <DropdownMenu
                trigger={<button type="button">触发</button>}
                items={[
                    { label: '甲' },
                    { label: '提交', children: [{ label: 'c1', onSelect: vi.fn() }, { label: 'c2' }] },
                ]}
            />
        )
        openMenu(screen.getByText('触发'))

        const subTrigger = screen.getByText('提交').closest('[role="menuitem"]')!
        expect(subTrigger).toHaveAttribute('aria-haspopup', 'menu')
        expect(screen.getAllByRole('menu')).toHaveLength(1)

        fireEvent.click(subTrigger)
        expect(screen.getAllByRole('menu')).toHaveLength(2)
        expect(screen.getByText('c1')).toBeInTheDocument()
    })

    it('content 项渲染但不占菜单项位（占位/哨兵不该进键盘漫游）', () => {
        render(
            <DropdownMenu
                trigger={<button type="button">触发</button>}
                items={[
                    { label: '甲' },
                    { content: <span data-testid="sentinel">…</span>, key: 'sentinel' },
                ]}
            />
        )
        openMenu(screen.getByText('触发'))

        expect(screen.getByTestId('sentinel')).toBeInTheDocument()
        expect(screen.getAllByRole('menuitem')).toHaveLength(1)
    })

    it('selected / title / disabled / separatorBefore 落到 DOM 契约上', () => {
        render(
            <DropdownMenu
                trigger={<button type="button">触发</button>}
                items={[
                    { label: '选中项', selected: true, title: '完整文案' },
                    { label: '分隔后', separatorBefore: true },
                    { label: '禁用项', disabled: true },
                ]}
            />
        )
        openMenu(screen.getByText('触发'))

        const selected = screen.getByText('选中项').closest('[role="menuitem"]')!
        expect(selected).toHaveAttribute('data-selected')
        expect(selected).toHaveAttribute('title', '完整文案')
        // 分隔线插在「分隔后」之前（线与其同属一个 Fragment，紧邻前一项之后）
        expect(selected.nextElementSibling).toHaveAttribute('role', 'separator')
        expect(screen.getByText('禁用项').closest('[role="menuitem"]')).toHaveAttribute('data-disabled')
    })

    it('子菜单项聚焦不让本级高亮跟着走（子菜单面板是本级的 DOM 后代，focusin 会冒上来）', () => {
        render(
            <DropdownMenu
                trigger={<button type="button">触发</button>}
                items={[
                    { label: '提交', children: [{ label: 'c1' }, { label: '删提交', destructive: true }] },
                ]}
            />
        )
        openMenu(screen.getByText('触发'))
        fireEvent.click(screen.getByText('提交').closest('[role="menuitem"]')!)

        // 危险色调只能落在子菜单那一级的高亮上（高亮是唯一带 data-tone 的 span；弹层 portal
        // 到 body，所以要查 document 而不是 render 容器）。本级若不按面板归属过滤，会把
        // 子菜单项的 offsetTop/tone 认成自己的——真机表现就是面板下方漂着第二个背景色。
        fireEvent.focusIn(screen.getByText('删提交').closest('[role="menuitem"]')!)

        expect(document.querySelectorAll('span[data-tone="danger"]')).toHaveLength(1)
    })

    it('side / align 透到弹层的 data-side / data-align（CSS 的入场位移与原点据此分档）', () => {
        render(
            <DropdownMenu
                trigger={<button type="button">触发</button>}
                items={[{ label: '甲' }]}
                side="top"
                align="start"
            />
        )
        openMenu(screen.getByText('触发'))

        const menu = screen.getByRole('menu')
        expect(menu).toHaveAttribute('data-side', 'top')
        expect(menu).toHaveAttribute('data-align', 'start')
    })

    it('onSelect 只在可选项上触发；点击项不回退到整行（Content 停冒泡）', () => {
        const onSelect = vi.fn()
        const onRowClick = vi.fn()
        render(
            <div onClick={onRowClick}>
                <DropdownMenu trigger={<button type="button">触发</button>} items={[{ label: '甲', onSelect }]} />
            </div>
        )
        openMenu(screen.getByText('触发'))

        fireEvent.click(screen.getByText('甲'))
        expect(onSelect).toHaveBeenCalledTimes(1)
        // 菜单挂在可点击的行内时，选中项不该连带触发行自身的 onClick
        expect(onRowClick).not.toHaveBeenCalled()
    })
})

/**
 * 子菜单的窄屏两条不变量（2026-10-13 真机回归：审查范围「已提交」在 390px 屏上顶出右缘 150px、
 * 且列表滚动后上下贴边）。jsdom 无布局，故：
 * - 结构按其 DOM 契约断言（滚动容器 / 面板标记）；
 * - 贴边位移用桩矩形 + 桩 innerWidth，靠 window resize 触发重算——真机上首次重算由 ResizeObserver
 *   的首次回调（观察即回调）与 Radix 写定位时的 MutationObserver 触发，两者在 jsdom 里都不发信号。
 */
describe('子菜单的窄屏贴边与滚动留白', () => {
    const INITIAL_INNER_WIDTH = window.innerWidth

    afterEach(() => {
        vi.restoreAllMocks()
        Object.defineProperty(window, 'innerWidth', { value: INITIAL_INNER_WIDTH, writable: true, configurable: true })
    })

    /** 打开二级子菜单，返回子菜单面板（面板 = 带 data-dropdown-panel 的 role=menu） */
    function openSubmenu(): HTMLElement {
        render(
            <DropdownMenu
                trigger={<button type="button">触发</button>}
                items={[{ label: '提交', children: [{ label: 'c1' }, { label: 'c2' }] }]}
            />
        )
        openMenu(screen.getByText('触发'))
        fireEvent.click(screen.getByText('提交').closest('[role="menuitem"]')!)

        const panels = [...document.querySelectorAll<HTMLElement>('[data-dropdown-panel]')]
        expect(panels).toHaveLength(2)
        return panels[1]!
    }

    /** 只桩子菜单的定位层（面板的父元素）：别的元素保持 jsdom 的零矩形，免得干扰 Radix 自己的定位 */
    function stubSubWrapperRect(sub: HTMLElement, rect: { x: number; right: number; width: number }) {
        vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
            const box = this === sub.parentElement
                ? { left: rect.x, right: rect.right, width: rect.width }
                : { left: 0, right: 0, width: 0 }
            return { ...box, top: 0, bottom: 0, height: 0, x: box.left, y: 0, toJSON: () => ({}) } as DOMRect
        })
    }

    it('条目收在自带滚动标记的容器里，面板另带层级标记（两标记各司其职）', () => {
        const sub = openSubmenu()

        // 面板标记：判焦点是否从子菜单冒上来（子菜单面板是本级的 DOM 后代）
        expect(sub).toHaveAttribute('data-dropdown-panel')
        // 滚动标记：面板的直接子元素才是滚动容器（子项里的哨兵拿它当 IO root），条目都在它下面
        const container = sub.querySelector<HTMLElement>(':scope > [data-dropdown-scroll-root]')
        expect(container).not.toBeNull()
        expect(container!.querySelectorAll('[role="menuitem"]')).toHaveLength(2)
        // 面板自身不再挂滚动标记：否则哨兵会把不滚动的面板当 root，翻页判定失效
        expect(sub).not.toHaveAttribute('data-dropdown-scroll-root')
    })

    it('子菜单右缘越屏时整体左移贴回屏内（Radix 的 shift 挪不动横向）', () => {
        const sub = openSubmenu()
        Object.defineProperty(window, 'innerWidth', { value: 390, writable: true, configurable: true })
        // 390px 屏里的实测值：面板 340 宽、落在 x=200，右缘 540
        stubSubWrapperRect(sub, { x: 200, right: 540, width: 340 })

        window.dispatchEvent(new Event('resize'))

        // 右缘收到 390 - 12（边缘留白），即左移 540 - 378 = 162
        expect(sub.style.getPropertyValue('--submenu-shift-x')).toBe('-162px')
    })

    it('装得下时不补位移（宽屏右翻或右侧有余量，都不该被推走）', () => {
        const sub = openSubmenu()
        Object.defineProperty(window, 'innerWidth', { value: 1280, writable: true, configurable: true })
        stubSubWrapperRect(sub, { x: 900, right: 1240, width: 340 })

        window.dispatchEvent(new Event('resize'))

        expect(sub.style.getPropertyValue('--submenu-shift-x')).toBe('')
    })
})
