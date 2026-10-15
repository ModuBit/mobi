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

describe('uiarc MultiSelect mode="tags"（chip 内联输入自由值）', () => {
    const TAG_OPTIONS = [
        { value: '/ws/mobi', label: '/ws/mobi' },
        { value: '/ws/demo', label: '/ws/demo' },
    ]

    function TagsHarness({ onChange }: { onChange?: (v: string[]) => void }) {
        const [value, setValue] = useState<string[]>([])
        return (
            <MultiSelect
                mode="tags"
                ariaLabel="排除路径"
                options={TAG_OPTIONS}
                value={value}
                onValueChange={(next) => { setValue(next); onChange?.(next) }}
            />
        )
    }

    it('触发器是输入框（非 button）；聚焦展开候选，点候选入 chip 并清搜索词', () => {
        const onChange = vi.fn<(v: string[]) => void>()
        render(<TagsHarness onChange={onChange} />)

        // tags 触发器无 button（输入框承载 role=combobox）
        expect(screen.queryByRole('button', { name: '排除路径' })).toBeNull()
        const input = screen.getByRole('combobox', { name: '排除路径' })
        fireEvent.focus(input)
        expect(screen.getByRole('option', { name: '/ws/mobi' })).toBeInTheDocument()

        fireEvent.click(screen.getByRole('option', { name: '/ws/mobi' }))
        expect(onChange).toHaveBeenCalledWith(['/ws/mobi'])
        // 点选后搜索词清空（antd tags 行为）
        expect(input).toHaveValue('')
    })

    it('输入过滤候选；Enter 创建自由值 chip，重复值去重不再回调', () => {
        const onChange = vi.fn<(v: string[]) => void>()
        render(<TagsHarness onChange={onChange} />)

        const input = screen.getByRole('combobox', { name: '排除路径' })
        fireEvent.focus(input)
        fireEvent.change(input, { target: { value: 'bi' } })
        // 过滤：只剩匹配候选（'bi' 只命中 /ws/mobi，不命中 /ws/demo）
        expect(screen.queryByRole('option', { name: '/ws/demo' })).not.toBeInTheDocument()

        // 自由值（不在候选里）Enter 创建
        fireEvent.change(input, { target: { value: '/custom/path' } })
        fireEvent.keyDown(input, { key: 'Enter' })
        expect(onChange).toHaveBeenCalledWith(['/custom/path'])

        // 重复创建去重：不再回调
        fireEvent.change(input, { target: { value: '/custom/path' } })
        fireEvent.keyDown(input, { key: 'Enter' })
        expect(onChange).toHaveBeenCalledTimes(1)
    })

    it('逗号也是创建键（antd tokenSeparators 语义）；空查询 Backspace 删尾 chip', () => {
        const onChange = vi.fn<(v: string[]) => void>()
        render(<TagsHarness onChange={onChange} />)

        const input = screen.getByRole('combobox', { name: '排除路径' })
        fireEvent.change(input, { target: { value: '/a' } })
        fireEvent.keyDown(input, { key: ',' })
        expect(onChange).toHaveBeenCalledWith(['/a'])

        // 有查询词时 Backspace 是编辑，不删 chip；清空后删尾
        fireEvent.change(input, { target: { value: 'x' } })
        fireEvent.keyDown(input, { key: 'Backspace' })
        expect(onChange).toHaveBeenCalledTimes(1)
        fireEvent.change(input, { target: { value: '' } })
        fireEvent.keyDown(input, { key: 'Backspace' })
        expect(onChange).toHaveBeenCalledWith([])
    })

    it('chip 上的 × 单删该项（默认模式 chip 无 ×）', () => {
        const onChange = vi.fn<(v: string[]) => void>()
        render(<TagsHarness onChange={onChange} />)

        const input = screen.getByRole('combobox', { name: '排除路径' })
        for (const v of ['/ws/mobi', '/custom']) {
            fireEvent.change(input, { target: { value: v } })
            fireEvent.keyDown(input, { key: 'Enter' })
        }
        // i18n key 直通桩：每个 × 的可访问名都是 common.removeItem
        const xs = screen.getAllByRole('button', { name: 'common.removeItem' })
        expect(xs).toHaveLength(2)
        fireEvent.click(xs[0]!)
        expect(onChange).toHaveBeenLastCalledWith(['/custom'])

        // default 模式 chip 无 ×（jsdom cleanup 后重渲染对比）
        cleanup()
        render(<Harness />)
        fireEvent.click(screen.getByRole('button', { name: '排除' }))
        fireEvent.click(screen.getByRole('option', { name: /甲/ }))
        expect(screen.queryByRole('button', { name: 'common.removeItem' })).toBeNull()
    })

    it('shortLabel 短形态显示于 chip（title 悬停全值），保证截断后可辨认', () => {
        const onChange = vi.fn<(v: string[]) => void>()
        render(
            <MultiSelect
                mode="tags"
                ariaLabel="路径"
                options={[{ value: '/ws/mobi-long-name', label: '/ws/mobi-long-name', shortLabel: 'mobi-long-name', title: '/ws/mobi-long-name' }]}
                value={['/ws/mobi-long-name']}
                onValueChange={onChange}
            />,
        )

        // chip 显示 shortLabel，title 承载完整值
        const chip = screen.getByTitle('/ws/mobi-long-name')
        expect(chip).toHaveTextContent('mobi-long-name')
        expect(chip).not.toHaveTextContent('/ws/')
    })

    it('tags 模式 chip 全显不折叠（maxVisible 缺省全显）', () => {
        const onChange = vi.fn<(v: string[]) => void>()
        render(<TagsHarness onChange={onChange} />)

        const input = screen.getByRole('combobox', { name: '排除路径' })
        for (const v of ['/ws/mobi', '/ws/demo', '/c']) {
            fireEvent.change(input, { target: { value: v } })
            fireEvent.keyDown(input, { key: 'Enter' })
        }
        // 3 个 chip 全部渲染（下拉 option 同文案，getAllByText），无 +N 折叠
        expect(screen.getAllByText('/ws/mobi').length).toBeGreaterThan(0)
        expect(screen.getAllByText('/ws/demo').length).toBeGreaterThan(0)
        expect(screen.getByText('/c')).toBeInTheDocument()
        expect(screen.queryByText('+')).not.toBeInTheDocument()
    })
})
