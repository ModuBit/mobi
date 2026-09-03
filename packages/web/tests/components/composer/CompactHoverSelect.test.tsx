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
 * CompactHoverSelect 移动端宽度参数化规格。
 *
 * 两种形态的由来（收编时保留差异、不静默回退任一侧）：
 * - 默认钉左（right:auto）：ChatComposer 形态
 * - mobileFullWidth 满宽（left+right 双钉 12px）：NewSessionPage 在 698493a5
 *   有意调整的形态，经 prop 参数化后继续生效
 *
 * jsdom 不做真实 CSS 布局，断言落在两点：注入的全局样式文本（两条规则共存、
 * 满宽规则书写在钉左之后——同元素双 class 时靠同表内顺序决胜）、下拉根 class
 * 的有无（antd v6：fireEvent.mouseDown(`.ant-select`) 展开，选项 portal 到 body）。
 */

import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest'
import { render, fireEvent, cleanup } from '@testing-library/react'
import { theme } from 'antd'
import '@testing-library/jest-dom/vitest'
import {
    CompactHoverSelect,
    COMPACT_DROPDOWN_CLASS,
    MODEL_DROPDOWN_FULLWIDTH_CLASS,
} from '@/components/composer/CompactHoverSelect'

// jsdom 无 ResizeObserver / matchMedia，antd Select 弹层路径依赖——最小 stub
class ResizeObserverStub {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
}
const origResizeObserver = globalThis.ResizeObserver
const origMatchMedia = globalThis.matchMedia
beforeAll(() => {
    globalThis.ResizeObserver = ResizeObserverStub as unknown as typeof ResizeObserver
    globalThis.matchMedia = ((query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: () => {},
        removeListener: () => {},
        addEventListener: () => {},
        removeEventListener: () => {},
        dispatchEvent: () => false,
    })) as unknown as typeof matchMedia
})
afterAll(() => {
    globalThis.ResizeObserver = origResizeObserver
    globalThis.matchMedia = origMatchMedia
})
// vitest 未开 globals，渲染型测试必须显式 cleanup
afterEach(() => cleanup())

/** $token 从 styled 必填 prop 中取（真实 token，经 useToken） */
function Harness(props: { mobileFullWidth?: boolean }) {
    const { token } = theme.useToken()
    return (
        <CompactHoverSelect
            $token={token}
            value="a"
            options={[{ value: 'a', label: 'A' }]}
            virtual={false}
            {...props}
        />
    )
}

/** 组件渲染后注入的全局样式文本（首渲染即注入一次） */
function injectedStyleText(): string {
    const styles = Array.from(document.querySelectorAll('style'))
        .map(el => el.textContent ?? '')
    return styles.find(text => text.includes(COMPACT_DROPDOWN_CLASS)) ?? ''
}

/** 展开下拉后取最新一份 dropdown 根节点 */
function openDropdown(): HTMLElement {
    fireEvent.mouseDown(document.querySelector('.ant-select')!)
    const dropdowns = document.querySelectorAll('.ant-select-dropdown')
    const dropdown = dropdowns[dropdowns.length - 1]
    if (!(dropdown instanceof HTMLElement)) throw new Error('dropdown not found')
    return dropdown
}

describe('CompactHoverSelect 移动端宽度参数化', () => {
    it('全局样式同时含钉左（默认）与满宽（变体）两条移动端规则，且满宽在后', () => {
        render(<Harness />)
        const text = injectedStyleText()
        const pinLeft = text.indexOf('right: auto !important; left: 12px')
        const fullWidth = text.indexOf('left: 12px !important; right: 12px')
        expect(pinLeft).toBeGreaterThanOrEqual(0)
        expect(fullWidth).toBeGreaterThan(pinLeft)
    })

    it('mobileFullWidth：下拉根带满宽 class；不传则不带（默认钉左，行为不变）', () => {
        const { unmount } = render(<Harness mobileFullWidth />)
        expect(openDropdown()).toHaveClass(MODEL_DROPDOWN_FULLWIDTH_CLASS)
        unmount()
        cleanup()

        render(<Harness />)
        expect(openDropdown()).not.toHaveClass(MODEL_DROPDOWN_FULLWIDTH_CLASS)
    })
})
