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
 * uiarc select 自管件的本地修改守卫（见 Select.tsx 头注 ①-⑦）：
 * label 可选、i18n 占位、allowClear 清除（"" 哨兵）、受控清空判定、泛型字面量回调、
 * option title 透传。动效观感与双档主题是 jsdom 测不出的真机验收项。
 */

import { describe, it, expect, vi, afterEach } from 'vitest'
import '@testing-library/jest-dom/vitest'
import { render, cleanup, fireEvent, screen } from '@testing-library/react'
import { Select } from '@/ui/base/interactive/select/Select'

vi.mock('motion/react', async (importOriginal) => {
    const { motionReactStub } = await import('../../helpers/motionReactStub')
    return motionReactStub(importOriginal)
})

vi.mock('react-i18next', async () => {
    const { i18nKeyStub } = await import('../../helpers/motionReactStub')
    return i18nKeyStub()
})

const OPTIONS = [
    { value: 'normal', label: '独立记忆', title: '完整文案' },
    { value: 'open', label: '完全共享' },
] as const

afterEach(cleanup)

/** jsdom 无 PointerEvent 布局：Radix trigger 只认 pointerType=mouse 的 pointerdown 展开 */
const openMenu = (el: HTMLElement) => fireEvent.pointerDown(el, { button: 0, pointerType: 'mouse' })

describe('uiarc Select 基础开合', () => {
    it('无值显示占位（i18n key 直通桩 → common.select）；展开后点击选项回调字面量值', () => {
        const onValueChange = vi.fn<(v: 'normal' | 'open' | '') => void>()
        render(<Select ariaLabel="档位" options={[...OPTIONS]} value="" onValueChange={onValueChange} />)

        expect(screen.getByRole('combobox', { name: '档位' })).toHaveTextContent('common.select')
        openMenu(screen.getByRole('combobox', { name: '档位' }))
        // option title 透传（antd 迁移站点能力保留）
        expect(screen.getByText('独立记忆').closest('[role="option"]')).toHaveAttribute('title', '完整文案')

        fireEvent.click(screen.getByText('完全共享'))
        expect(onValueChange).toHaveBeenCalledWith('open')
    })

    it('allowClear：有值渲染清除钮（chevron 隐藏），点击回调 "" 且不开菜单', () => {
        const onValueChange = vi.fn<(v: 'normal' | 'open' | '') => void>()
        render(<Select ariaLabel="档位" options={[...OPTIONS]} value="normal" allowClear onValueChange={onValueChange} />)

        const clear = screen.getByRole('button', { name: 'common.clearSelection' })
        expect(clear).toBeInTheDocument()
        // 清除钮在触发器外（button 不嵌套）
        expect(clear.closest('[role="combobox"]')).toBeNull()

        fireEvent.click(clear)
        expect(onValueChange).toHaveBeenCalledWith('')
    })

    it('无 allowClear 或无值时不渲染清除钮；清除后受控 value="" 回占位', () => {
        const { rerender } = render(
            <Select ariaLabel="档位" options={[...OPTIONS]} value="normal" onValueChange={() => {}} />,
        )
        expect(screen.queryByRole('button', { name: 'common.clearSelection' })).toBeNull()

        rerender(<Select ariaLabel="档位" options={[...OPTIONS]} value="" allowClear onValueChange={() => {}} />)
        expect(screen.queryByRole('button', { name: 'common.clearSelection' })).toBeNull()
        // 受控清空（value 从有值改回 ""）回占位，不回显旧值
        expect(screen.getByRole('combobox', { name: '档位' })).toHaveTextContent('common.select')
    })
})
