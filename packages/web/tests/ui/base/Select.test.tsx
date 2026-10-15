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
import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
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

    it('gliding highlight 色块在首个当前项上落下（data-on 标记）', () => {
        render(<Select ariaLabel="档位" options={[...OPTIONS]} value="normal" />)
        openMenu(screen.getByRole('combobox', { name: '档位' }))
        // Radix 打开后聚焦当前项 → focusin 驱动色块定位（RTL 的 focusIn 直发 focusin 事件）
        fireEvent.focusIn(screen.getByRole('option', { name: /独立记忆/ }))
        const viewport = screen.getByRole('option', { name: /独立记忆/ }).parentElement
        expect(viewport).not.toBeNull()
        expect(viewport!.querySelector('[data-on]')).not.toBeNull()
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

/**
 * portal 变量映射守卫：菜单是 Radix Portal 挂 body，CSS 变量不走组件树——
 * 设计变量→mobi token 映射块若只挂 .field，.content 的 surface 系解析不到、背景退化透明
 * （2026-10-15 真机实踩）。守卫：映射块的选择器必须同时含 .field 与 .content。
 */
describe('uiarc Select 的 portal 变量映射', () => {
    it('映射块同时挂在 .field 与 .content（portal 侧自带映射）', () => {
        const css = readFileSync(
            resolve(dirname(fileURLToPath(import.meta.url)), '../../../src/ui/base/interactive/select/select.module.css'),
            'utf8',
        )
        // 取首个含 --surface-raised 声明的规则的选择器段
        const mappingRule = css.match(/([^{}]*?)\{[^{}]*--surface-raised:/)
        expect(mappingRule).not.toBeNull()
        expect(mappingRule![1]).toContain('.field')
        expect(mappingRule![1]).toContain('.content')
    })
})
