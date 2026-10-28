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
 * ③ loading 一并禁用触发器。
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
    const { i18nKeyStub } = await import('../../helpers/i18nStub')
    return i18nKeyStub()
})

// 视口恒 PC（morph 的展开方向判定需要）
vi.mock('@/core/data/hooks/useMediaQuery', () => ({
    useIsMobile: () => false,
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

    it('disabled 与 loading 都禁用触发器', () => {
        const { rerender } = render(<Harness disabled />)
        expect(screen.getByRole('combobox')).toBeDisabled()
        rerender(<Harness loading />)
        expect(screen.getByRole('combobox')).toBeDisabled()
    })
})
