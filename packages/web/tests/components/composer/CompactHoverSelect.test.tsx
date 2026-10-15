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
 * ② composer 固定形态——direction 恒 up（贴屏幕底）；
 * ③ loading 一并禁用触发器；
 * ④ effort-popover 全局样式注入（单点收口，首渲染即注入一次）。
 * 面板宽度参数化（mobileFullWidth → panelWidth 9999）是纯数值透传，
 * jsdom 无真实布局测不出满宽效果，归真机验收（票 03）。
 */

import { describe, it, expect, vi, afterEach } from 'vitest'
import '@testing-library/jest-dom/vitest'
import { render, cleanup, fireEvent, screen } from '@testing-library/react'
import type { AnimationPlaybackControls, MotionValue } from 'motion/react'
import { CompactHoverSelect, type CompactHoverSelectOption } from '@/features/composer/CompactHoverSelect'

/** jsdom 无 matchMedia：reduced 恒 false；animate 打桩成立即达（尺寸 spring 不必真跑） */
vi.mock('motion/react', async (importOriginal) => {
    const actual = await importOriginal<typeof import('motion/react')>()
    const animateStub = (value: MotionValue<number>, target: number): AnimationPlaybackControls => {
        value.set(target)
        const promise = new Promise<void>((resolve) => { setTimeout(resolve, 0) })
        return { stop() {}, then: (resolve, reject) => promise.then(resolve, reject) } as AnimationPlaybackControls
    }
    return { ...actual, animate: animateStub, useReducedMotion: () => false }
})

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

    it('composer 固定向上展开：root 恒带 data-direction="up"', () => {
        const { container } = render(<Harness />)
        expect(container.querySelector('[data-direction]')).toHaveAttribute('data-direction', 'up')
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
