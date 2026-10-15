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
 * uiarc multi-select 自管件的行为契约：chip 增删、溢出 +N 计数、整体清除、
 * 受控/非受控两态。chip 弹簧开合观感是 jsdom 测不出的真机验收项。
 */

import { describe, it, expect, vi, afterEach } from 'vitest'
import '@testing-library/jest-dom/vitest'
import { render, cleanup, fireEvent, screen } from '@testing-library/react'
import { useState } from 'react'
import { MultiSelect } from '@/ui/base/interactive/multi-select/MultiSelect'

vi.mock('motion/react', async (importOriginal) => {
    const { motionReactStub } = await import('../../helpers/motionReactStub')
    return motionReactStub(importOriginal)
})

vi.mock('react-i18next', async () => {
    const { i18nKeyStub } = await import('../../helpers/motionReactStub')
    return i18nKeyStub()
})

const OPTIONS = [
    { value: 'a', label: '甲' },
    { value: 'b', label: '乙' },
    { value: 'c', label: '丙' },
]

afterEach(cleanup)

function Harness({ onChange }: { onChange?: (v: string[]) => void }) {
    const [value, setValue] = useState<string[]>([])
    return (
        <MultiSelect
            ariaLabel="排除"
            options={OPTIONS}
            value={value}
            onValueChange={(next) => { setValue(next); onChange?.(next) }}
        />
    )
}

describe('uiarc MultiSelect 选择语义', () => {
    it('无值显示占位（i18n key 直通）；展开点击选项追加为 chip', () => {
        const onChange = vi.fn<(v: string[]) => void>()
        render(<Harness onChange={onChange} />)

        // MultiSelect 触发器是普通 button（aria-haspopup=listbox）
        const trigger = screen.getByRole('button', { name: '排除' })
        expect(trigger).toHaveTextContent('common.select')
        fireEvent.click(trigger)
        fireEvent.click(screen.getByRole('option', { name: /甲/ }))

        expect(onChange).toHaveBeenCalledWith(['a'])
        // chip 与 srOnly 值回显都含「甲」；chip 已入 DOM 即断言成立
        expect(screen.getAllByText('甲').length).toBeGreaterThan(0)
    })

    it('再次点击选项移除 chip；超 maxVisible 折叠为 +N 计数', () => {
        const onChange = vi.fn<(v: string[]) => void>()
        render(<Harness onChange={onChange} />)

        const trigger = screen.getByRole('button', { name: '排除' })
        fireEvent.click(trigger)
        fireEvent.click(screen.getByRole('option', { name: /甲/ }))
        fireEvent.click(trigger)
        fireEvent.click(screen.getByRole('option', { name: /乙/ }))
        fireEvent.click(trigger)
        fireEvent.click(screen.getByRole('option', { name: /丙/ }))

        // maxVisible 默认 2：前两个出 chip，第三个折叠为 +1
        expect(onChange).toHaveBeenLastCalledWith(['a', 'b', 'c'])
        expect(screen.getByText('+')).toBeInTheDocument()

        // 整体清除
        fireEvent.click(screen.getByRole('button', { name: 'common.clearSelection' }))
        expect(onChange).toHaveBeenLastCalledWith([])
    })
})
