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
 * CompactHoverSelect（morph-select 壳）行为契约：
 * ① onChange 单参归一（morph 的 (value, option) 双参在壳内吞掉）；
 * ② 展开方向/视口钳制交 morph auto 决策（展开内容恒在视窗内），壳不干预；
 * ③ loading 一并禁用触发器；
 * ④ effort-popover 全局样式注入（单点收口，首渲染即注入一次）；
 * ⑤ mobileFullWidth 仅移动端生效（PC 传了不放大面板，防撑出屏幕）。
 */

import { describe, it, expect, vi, afterEach } from 'vitest'
import '@testing-library/jest-dom/vitest'
import { render, cleanup, fireEvent, screen } from '@testing-library/react'
import { CompactHoverSelect, type CompactHoverSelectOption } from '@/features/composer/CompactHoverSelect'

// jsdom 无 matchMedia：morph 动效打桩成立即达（尺寸 spring 不必真跑）
vi.mock('motion/react', async (importOriginal) => {
    const { motionReactStub } = await import('../../helpers/motionReactStub')
    return motionReactStub(importOriginal)
})

vi.mock('react-i18next', async () => {
    const { i18nKeyStub } = await import('../../helpers/motionReactStub')
    return i18nKeyStub()
})

// useIsMobile 可控桩（mobileFullWidth 收窄语义的断言面）
const { isMobileMock, setIsMobile } = vi.hoisted(() => {
    const isMobileMock = { value: false }
    return { isMobileMock, setIsMobile: (v: boolean) => { isMobileMock.value = v } }
})
vi.mock('@/core/data/hooks/useMediaQuery', () => ({
    useIsMobile: () => isMobileMock.value,
    useHasFinePointer: () => true,
}))

const OPTIONS: CompactHoverSelectOption[] = [
    { value: 'default', label: '默认', description: '跟随 CC 设置' },
    { value: 'acceptEdits', label: '接受编辑' },
]

function Harness(props: Partial<Parameters<typeof CompactHoverSelect>[0]> = {}) {
    return (
        <CompactHoverSelect
            label="权限模式"
            value="default"
            options={OPTIONS}
            {...props}
        />
    )
}

describe('CompactHoverSelect 壳行为', () => {
    afterEach(cleanup)

    it('点击选项回调单参 onChange(value)——morph 的 (value, option) 双参被壳吞掉', () => {
        const onChange = vi.fn()
        render(<Harness onChange={onChange} />)
        fireEvent.click(screen.getByRole('combobox'))
        fireEvent.click(screen.getByRole('option', { name: /接受编辑/ }))
        expect(onChange).toHaveBeenCalledTimes(1)
        expect(onChange).toHaveBeenCalledWith('acceptEdits')
    })

    it('展开方向交 morph auto 决策：jsdom 视口空间充足 → down（壳不再硬编码 up）', () => {
        const { container } = render(<Harness />)
        expect(container.querySelector('[data-direction]')).toHaveAttribute('data-direction', 'down')
    })

    it('mobileFullWidth 仅移动端生效：PC 面板宽保持默认 272，移动端走 morph 满宽槽位（视口减 2rem）', () => {
        setIsMobile(false)
        const { container } = render(<Harness mobileFullWidth />)
        expect(container.querySelector('[data-direction]')?.getAttribute('style')).toContain('--ms-panel-w: 272px')
        cleanup()

        setIsMobile(true)
        const { container: mobileContainer } = render(<Harness mobileFullWidth />)
        expect(mobileContainer.querySelector('[data-direction]')?.getAttribute('style')).toContain('--ms-panel-w: calc(100vw - 2rem)')
    })

    it('disabled 与 loading 都禁用触发器', () => {
        const { rerender } = render(<Harness disabled />)
        expect(screen.getByRole('combobox')).toBeDisabled()
        rerender(<Harness loading />)
        expect(screen.getByRole('combobox')).toBeDisabled()
    })

    it('effort-popover 全局样式首渲染即注入，且重复挂载只注入一次', () => {
        render(<Harness />)
        const injected = () => Array.from(document.querySelectorAll('style'))
            .map(el => el.textContent ?? '')
            .filter(text => text.includes('.effort-popover'))
        expect(injected()).toHaveLength(1)
        cleanup()
        render(<Harness />)
        expect(injected()).toHaveLength(1)
    })
})
