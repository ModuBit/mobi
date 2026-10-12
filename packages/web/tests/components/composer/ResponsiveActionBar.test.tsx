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
 * 溢出面板的行点击代理：动作长在项自带按钮上（不在菜单项里写第二份），
 * 行空白点击代理到那个按钮，**点在按钮上时不再代理**（否则执行两遍）。
 *
 * jsdom 无布局：容器宽度用 ResizeObserver 桩喂，项宽用 getBoundingClientRect 桩给，
 * 这样才能把项挤进「更多」面板。
 */

import { describe, it, expect, vi, beforeEach, afterEach, beforeAll } from 'vitest'
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react'
import { ResponsiveActionBar } from '@/features/composer/ResponsiveActionBar'

const CONTAINER_WIDTH = 100
const ITEM_WIDTH = 60

beforeAll(() => {
    // 回调同步触发一次，等价于「挂载时量到容器宽度」
    vi.stubGlobal(
        'ResizeObserver',
        class {
            private cb: ResizeObserverCallback
            constructor(cb: ResizeObserverCallback) {
                this.cb = cb
            }
            observe() {
                this.cb([{ contentRect: { width: CONTAINER_WIDTH } } as ResizeObserverEntry], this as unknown as ResizeObserver)
            }
            unobserve() {}
            disconnect() {}
        }
    )
})

beforeEach(() => {
    // 项宽 60 + 容器 100 → 只有第一项留在栏上，第二项进「更多」面板（suffix 不在场）
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
        const width = this.getAttribute('data-role') === 'suffix' ? 0 : ITEM_WIDTH
        return { width, height: 24, top: 0, left: 0, right: width, bottom: 24, x: 0, y: 0, toJSON: () => ({}) } as DOMRect
    })
})

afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
})

/** 溢出的那一项：按钮自持动作，行点击代理到它 */
function renderOverflowing() {
    const first = vi.fn()
    const second = vi.fn()
    render(
        <ResponsiveActionBar
            items={[
                { key: 'a', label: '甲', render: () => <button type="button" data-testid="btn-a" onClick={first}>A</button> },
                { key: 'b', label: '乙', render: () => <button type="button" data-testid="btn-b" onClick={second}>B</button> },
            ]}
        />
    )
    return { first, second }
}

/** 打开「更多」面板并取回溢出项那一行 */
function openOverflow() {
    fireEvent.pointerDown(screen.getByLabelText('common.more'), { button: 0 })
    return within(screen.getByRole('menu'))
}

describe('ResponsiveActionBar 溢出面板的行点击代理', () => {
    it('点行空白：代理到项自带的按钮，动作执行一次', () => {
        const { second } = renderOverflowing()
        const menu = openOverflow()

        // 行空白 = 菜单项里除按钮之外的那团内容（这里点文案）
        fireEvent.click(menu.getByText('乙'))

        expect(second).toHaveBeenCalledTimes(1)
    })

    it('点按钮本身：只有按钮自己那一次，不叠加代理', () => {
        const { second } = renderOverflowing()
        const menu = openOverflow()

        fireEvent.click(menu.getByTestId('btn-b'))

        expect(second).toHaveBeenCalledTimes(1)
    })
})
